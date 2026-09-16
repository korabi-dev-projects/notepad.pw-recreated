import { isBannedSlug } from "./bannedwords";
import noteModel from "../models/noteModel";
import crypto from "crypto";

const newNoteLength = process.env.NEW_NOTE_LENGTH
  ? parseInt(process.env.NEW_NOTE_LENGTH, 10)
  : 8;

if (isNaN(newNoteLength) || newNoteLength < 8) {
  throw new Error("Invalid NEW_NOTE_LENGTH environment variable");
}

const CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateRandomId(length: number): string {
  let result = "";
  const charactersLength = CHARACTERS.length;

  // Use modern Web Crypto API available natively in Node.js
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);

  for (const randomValue of randomValues) {
    // Using modulo here is safe because 62 is far smaller than 2^32
    result += CHARACTERS.charAt(randomValue % charactersLength);
  }
  return result;
}

export default async function findNewNoteId(): Promise<string> {
  // If the loop runs too many times, something is wrong (prevent infinite loops)
  let attempts = 0;
  const maxAttempts = 500; // its a high number but each iteration is computationally cheap, and we want to be sure we can find a unique id

  while (attempts < maxAttempts) {
    attempts++;
    const newId = generateRandomId(newNoteLength);

    if (isBannedSlug(newId)) {
      continue;
    }

    // Performance optimization: select only the 'id' field to minimize DB load
    const existingNote = await noteModel
      .findOne({ id: newId })
      .select("id")
      .lean()
      .exec();
    if (!existingNote) {
     const newNote = new noteModel({ id: newId, content: "" });
      await newNote.save();
      return newId;
    }
  }

  throw new Error(
    "Failed to generate a unique note ID after maximum attempts.",
  );
}
