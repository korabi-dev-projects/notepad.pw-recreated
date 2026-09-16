import ensureEnv from "./utils/ensureEnv";
ensureEnv();

import { Elysia } from "elysia";
import { readFileSync } from "fs";
import { join } from "path";
import db from "./modules/db";
import noteModel from "./models/noteModel";
import getIp from "./utils/getIp";
import argon2 from "argon2";
import { isBannedSlug } from "./utils/bannedwords";
import { z } from "zod";
import { createLimiter } from "./utils/ratelimit";
import findNewNoteId from "./utils/findNewNoteId";
import checkNotePassword from "./utils/checkNotePassword";
import {
  register,
  unregister,
  removeAll,
  revokeAllExcept,
} from "./utils/wsRegistry";

const pageDir = join(import.meta.dir, "assets", "page.html");
const file = readFileSync(pageDir, "utf-8");

if (!file) {
  throw new Error("page.html not found in assets directory");
}

await db.connectDB();

const app = new Elysia();

const passwordLimiter = createLimiter({ capacity: 5, refillPerSec: 0.1 }); // ~5 burst, 1 per 10s
const subscribeLimiter = createLimiter({ capacity: 20, refillPerSec: 1 });
const updateLimiter = createLimiter({ capacity: 10, refillPerSec: 2 });
const globalLimiter = createLimiter({ capacity: 100, refillPerSec: 20 }); // ~100 burst, 20 per second
const updatePasswordLimiter = createLimiter({ capacity: 5, refillPerSec: 0.1 }); // ~5 burst, 1 per 10s

function devLog(...message: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[dev]", ...message);
  }
}

function sendWsError(
  ws: { send: (message: string) => void },
  code: string,
  message: string,
  noteId?: string,
) {
  ws.send(JSON.stringify({ type: "error", code, message, ...(noteId ? { noteId } : {}) }));
}

app.onError(({ request, error }) => {
  devLog("HTTP error", {
    method: request.method,
    url: request.url,
    error,
  });
});

// app.onRequest(({ request }) => {
//   devLog("HTTP request", {
//     method: request.method,
//     url: request.url,
//   });
// });

// app.onAfterHandle(({ request, response }) => {
//   devLog("HTTP response", {
//     method: request.method,
//     url: request.url,
//     status: response instanceof Response ? response.status : 200,
//   });
// });

app.onBeforeHandle(async (context) => {
  // ratelimit middleware for all requests, not including websockets, we will use the ip address of the client as the key for the limiter
  if (!context.server) {
    devLog("HTTP request rejected: server unavailable", {
      method: context.request.method,
      url: context.request.url,
    });
    return context.status(503);
  }
  const ip = getIp(context.request, context.server);
  if (!ip) {
    devLog("HTTP request rejected: client IP unavailable", {
      method: context.request.method,
      url: context.request.url,
    });
    return context.status(503);
  }
  if (!globalLimiter(ip)) {
    devLog("Global request rate limit exceeded", { ip, method: context.request.method });
    return context.status(429);
  }
});

// Strict schema: every field that ends up in a Mongo query or a channel
// string must be constrained to a primitive type, never "any JSON value".
const passwordSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^(?=.*[a-z])(?=.*[A-Z])[a-zA-Z0-9]+$/);

const wsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    noteId: z.string().min(1).max(256),
    password: passwordSchema.optional(),
  }),
  z.object({
    type: z.literal("unsubscribe"),
    noteId: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("update"),
    noteId: z.string().min(1).max(256),
    content: z.string().max(5 * 1024 * 1024),
    password: passwordSchema.optional(),
  }),
  z.object({
    type: z.literal("update_password"),
    noteId: z.string().min(1).max(256),
    password: passwordSchema.optional(),
    newPassword: passwordSchema.nullable(),
  }),
]);

app.ws("/socket/ws", {
  async message(ws, rawMessage) {
    const ip =
      process.env.TRUST_PROXY === "true"
        ? ws.data.server
          ? getIp(ws.data.request, ws.data.server)
          : null
        : ws.remoteAddress;
    if (!ip) {
      devLog("WebSocket message rejected: client IP unavailable", {
        trustProxy: process.env.TRUST_PROXY === "true",
      });
      return;
    }
    let msg;
    try {
      const parsedJson =
        typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
      const result = wsMessageSchema.safeParse(parsedJson);
      if (!result.success) {
        devLog("Rejected invalid WebSocket message", {
          ip,
          issues: result.error.issues,
        });
        const hasPasswordIssue = result.error.issues.some((issue) =>
          issue.path.includes("password") || issue.path.includes("newPassword"),
        );
        sendWsError(
          ws,
          hasPasswordIssue ? "invalid_password_format" : "invalid_request",
          hasPasswordIssue
            ? "Password must be 8-64 characters with at least one uppercase and one lowercase letter."
            : "The request was invalid.",
        );
        return;
      }
      msg = result.data;
      devLog("WebSocket request", {
        ip,
        type: msg.type,
        noteId: msg.noteId,
        ...(msg.type === "update" ? { contentLength: msg.content.length } : {}),
      });
    } catch (err) {
      devLog("Error parsing WebSocket message", { ip, error: err });
      sendWsError(ws, "invalid_request", "The request was not valid JSON.");
      return;
    }

    try {
      if (msg.type === "subscribe") {
        if (!subscribeLimiter(`sub:${ip}`)) {
          devLog("Subscription rate limit exceeded", { ip, noteId: msg.noteId });
          sendWsError(ws, "rate_limited", "Too many requests. Try again shortly.", msg.noteId);
          return;
        }
        // fetch the note and make sure its not password protected before subscribing
        const note = await noteModel.findOne({ id: msg.noteId }).lean();
        if (note) {
          if (note.password && !msg.password) {
            devLog("Subscription denied: password required", { ip, noteId: msg.noteId });
            sendWsError(ws, "password_required", "A password is required for this note.", msg.noteId);
            return;
          }
          if (note.password && msg.password) {
            const passwordCheck = await checkNotePassword(
              note,
              msg.password,
              `pw:${ip}:${msg.noteId}`,
              passwordLimiter,
            );
            if (passwordCheck !== "ok") {
              devLog("Subscription denied", {
                ip,
                noteId: msg.noteId,
                reason: passwordCheck,
              });
              sendWsError(ws, "invalid_password", "That password did not work.", msg.noteId);
              return;
            }
          }
        }
        ws.subscribe(`note:${msg.noteId}`);
        register(msg.noteId, ws);
        devLog("Subscribed to note", { ip, noteId: msg.noteId });
      }

      if (msg.type === "unsubscribe") {
        if (!subscribeLimiter(`sub:${ip}`)) {
          devLog("Unsubscription rate limit exceeded", { ip, noteId: msg.noteId });
          sendWsError(ws, "rate_limited", "Too many requests. Try again shortly.", msg.noteId);
          return;
        }
        ws.unsubscribe(`note:${msg.noteId}`);
        unregister(msg.noteId, ws);
        devLog("Unsubscribed from note", { ip, noteId: msg.noteId });
      }

      if (msg.type === "update") {
        if (isBannedSlug(msg.noteId)) {
          devLog("Update rejected: banned note ID", { ip, noteId: msg.noteId });
          sendWsError(ws, "invalid_note", "This note ID cannot be updated.", msg.noteId);
          return;
        }
        if (!updateLimiter(`upd:${ip}`)) {
          devLog("Update rate limit exceeded", { ip, noteId: msg.noteId });
          sendWsError(ws, "rate_limited", "Too many updates. Try again shortly.", msg.noteId);
          return;
        }
        // fetch the note and make sure its not password protected before updating
        let note = await noteModel.findOne({ id: msg.noteId }).exec();
        let noteExisted = true;
        if (!note) {
          noteExisted = false;
          devLog("Creating new note", { ip, noteId: msg.noteId });
          const noteOptions = {
            content: msg.content || "",
            id: msg.noteId,
            password: msg.password
              ? await argon2.hash(msg.password)
              : undefined,
          };
          note = new noteModel(noteOptions);
        }
        if (noteExisted) {
          if (note.password && !msg.password) {
            devLog("Update denied: password required", { ip, noteId: msg.noteId });
            sendWsError(ws, "password_required", "A password is required for this note.", msg.noteId);
            return;
          }
          if (note.password && msg.password) {
            const passwordCheck = await checkNotePassword(
              note,
              msg.password,
              `pw:${ip}:${msg.noteId}`,
              passwordLimiter,
            );
            if (passwordCheck !== "ok") {
              devLog("Update denied", {
                ip,
                noteId: msg.noteId,
                reason: passwordCheck,
              });
              sendWsError(ws, "invalid_password", "That password did not work.", msg.noteId);
              return;
            }
          }
        }

        note.content = msg.content;
        await note.save();
        devLog(noteExisted ? "Note updated" : "Note created", {
          ip,
          noteId: msg.noteId,
          contentLength: msg.content.length,
        });
        ws.publish(
          `note:${msg.noteId}`,
          JSON.stringify({
            type: "update",
            noteId: msg.noteId,
            content: msg.content,
          }),
        );
      }
      if (msg.type == "update_password") {
        if (isBannedSlug(msg.noteId)) {
          devLog("Password update rejected: banned note ID", { ip, noteId: msg.noteId });
          sendWsError(ws, "invalid_note", "This note ID cannot be updated.", msg.noteId);
          return;
        }
        if (!updatePasswordLimiter(`updpw:${ip}`)) {
          sendWsError(ws, "rate_limited", "Too many password changes. Try again shortly.", msg.noteId);
          return;
        }
        // fetch the note and make sure its not password protected before updating
        let note = await noteModel.findOne({ id: msg.noteId }).exec();
        if (!note) {
          devLog("Password update ignored: note not found", { ip, noteId: msg.noteId });
          return;
        }
        if (note.password && !msg.password) {
          devLog("Password update denied: password required", { ip, noteId: msg.noteId });
          sendWsError(ws, "password_required", "The current password is required.", msg.noteId);
          return;
        }
        if (note.password && msg.password) {
          const passwordCheck = await checkNotePassword(
            note,
            msg.password,
            `pw:${ip}:${msg.noteId}`,
            passwordLimiter,
          );
          if (passwordCheck !== "ok") {
            devLog("Password update denied", {
              ip,
              noteId: msg.noteId,
              reason: passwordCheck,
            });
            sendWsError(ws, "invalid_password", "That password did not work.", msg.noteId);
            return;
          }
        }
        note.password = msg.newPassword
          ? await argon2.hash(msg.newPassword)
          : undefined;
        await note.save();
        devLog(msg.newPassword ? "Note password updated" : "Note password removed", {
          ip,
          noteId: msg.noteId,
        });
        ws.send(
          JSON.stringify({
            type: "password_updated",
            noteId: msg.noteId,
          }),
        );
        ws.publish(
          `note:${msg.noteId}`,
          JSON.stringify({
            type: "update_password",
            noteId: msg.noteId,
          }),
        );
        revokeAllExcept(msg.noteId, `note:${msg.noteId}`, ws);
      }
    } catch (err) {
      devLog("Error handling WebSocket message", { ip, error: err });
      sendWsError(ws, "server_error", "The server could not complete that request.");
    }
  },
  close(ws) {
    removeAll(ws);
  },
});

app.get("/", async (context) => {
  const newId = await findNewNoteId();
  return context.redirect(`/${newId}`); // redirect to a new note with a unique id when the user visits the home page
});

app.get("/:id/raw", async (context) => {
  const { id } = context.params;
  if (!context.server) {
    devLog("Raw note request rejected: server unavailable", { noteId: id });
    return context.status(503);
  }
  const ip = getIp(context.request, context.server);
  if (!ip) {
    devLog("Raw note request rejected: client IP unavailable", { noteId: id });
    return context.status(503);
  }
  if (isBannedSlug(id)) {
    devLog("Raw note request rejected: banned note ID", { ip, noteId: id });
    context.set.headers = { "Content-Type": "application/json" };
    return { error: "Note ID is banned" };
  }
  const note = await noteModel.findOne({ id }).lean();
  if (!note) {
    devLog("Raw note request returned empty note", { ip, noteId: id });
    context.set.headers = { "Content-Type": "text/plain" };
    return ""; // return empty string
  }
  if (note.password) {
    const providedPassword = context.query?.password;
    if (!providedPassword) {
      devLog("Raw note request denied: password required", { ip, noteId: id });
      context.set.headers = { "Content-Type": "application/json" };
      return { error: "Password required to access this note" };
    }
    if (!passwordLimiter(`pw:${ip}:${id}`)) {
      devLog("Raw note request rate limited", { ip, noteId: id });
      return context.status(429);
    }
    const isPasswordValid = await argon2.verify(
      note.password,
      providedPassword,
    );
    if (!isPasswordValid) {
      devLog("Raw note request denied: invalid password", { ip, noteId: id });
      context.set.headers = { "Content-Type": "application/json" };
      return { error: "Invalid password" };
    }
  }
  devLog("Raw note request served", {
    ip,
    noteId: id,
    contentLength: note.content?.length ?? 0,
  });
  context.set.headers = { "Content-Type": "text/plain" };
  return note.content;
});

app.get("/:id", async (context) => {
  const { id } = context.params;
  if (isBannedSlug(id)) {
    const newId = await findNewNoteId();
    return context.redirect(`/${newId}`); // redirect to a new note with a unique id when the user visits a banned note id
  }
  // we deliver page.html here, that will do the rest of the work, including fetching the note content via the /:id/raw endpoint, and subscribing to the websocket channel for updates etc
  context.set.headers = { "Content-Type": "text/html" };
  return file;
});

const port = Number(process.env.PORT);

app.listen(port);

console.log(`Listening on ${app.server?.url}`);
