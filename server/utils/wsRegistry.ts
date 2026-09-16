// utils/wsRegistry.ts
//
// Elysia/Bun's pub-sub (ws.subscribe / ws.unsubscribe / ws.publish) has no
// built-in way to enumerate a topic's subscribers or force-unsubscribe a
// socket other than itself. This registry fills that gap: it tracks which
// sockets are subscribed to which noteId so we can revoke access (e.g. when
// a note is claimed/re-passworded) without waiting for the client to behave.

type WsLike = {
  unsubscribe: (channel: string) => void;
};

// noteId -> set of sockets currently subscribed to that note
const registry = new Map<string, Set<WsLike>>();

// Every socket's own set of noteIds, so `removeAll` doesn't need to scan
// the whole registry on every disconnect.
const reverseIndex = new Map<WsLike, Set<string>>();

/**
 * Record that `ws` is now subscribed to `noteId`. Call this right after
 * ws.subscribe(`note:${noteId}`) succeeds.
 */
export function register(noteId: string, ws: WsLike): void {
  let sockets = registry.get(noteId);
  if (!sockets) {
    sockets = new Set();
    registry.set(noteId, sockets);
  }
  sockets.add(ws);

  let notes = reverseIndex.get(ws);
  if (!notes) {
    notes = new Set();
    reverseIndex.set(ws, notes);
  }
  notes.add(noteId);
}

/**
 * Record that `ws` is no longer subscribed to `noteId`. Call this right
 * after ws.unsubscribe(`note:${noteId}`), including when triggered by an
 * explicit client "unsubscribe" message.
 */
export function unregister(noteId: string, ws: WsLike): void {
  const sockets = registry.get(noteId);
  if (sockets) {
    sockets.delete(ws);
    if (sockets.size === 0) registry.delete(noteId);
  }

  const notes = reverseIndex.get(ws);
  if (notes) {
    notes.delete(noteId);
    if (notes.size === 0) reverseIndex.delete(ws);
  }
}

/**
 * Remove `ws` from every note it was tracked against. Call this from the
 * WS `close` handler so a disconnected client doesn't leak in the registry
 * forever.
 */
export function removeAll(ws: WsLike): void {
  const notes = reverseIndex.get(ws);
  if (!notes) return;

  for (const noteId of notes) {
    const sockets = registry.get(noteId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) registry.delete(noteId);
    }
  }

  reverseIndex.delete(ws);
}

/**
 * Force-unsubscribe every socket currently registered for `noteId` from
 * `channel` (the pub/sub topic string, e.g. `note:${noteId}`), except
 * `exceptWs` if given (typically the socket that just performed the
 * claim/password-change).
 *
 * This calls the real Bun-backed ws.unsubscribe() on each socket, so it
 * actually removes them from the topic — they will not receive further
 * publishes to it until they subscribe again (which requires the new
 * password, per the existing subscribe-handler logic).
 */
export function revokeAllExcept(
  noteId: string,
  channel: string,
  exceptWs?: WsLike,
): void {
  const sockets = registry.get(noteId);
  if (!sockets) return;

  for (const ws of sockets) {
    if (ws === exceptWs) continue;
    ws.unsubscribe(channel);
    unregister(noteId, ws);
  }
}

/**
 * Number of sockets currently tracked as subscribed to `noteId`.
 * Useful for diagnostics/tests; not required for the revoke flow itself.
 */
export function subscriberCount(noteId: string): number {
  return registry.get(noteId)?.size ?? 0;
}