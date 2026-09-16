import argon2 from "argon2";

export default async function checkNotePassword(
  note: { password?: string },
  providedPassword: string | undefined,
  rateLimitKey: string,
  passwordLimiter: (key: string) => boolean,
): Promise<"ok" | "denied" | "rate_limited"> {
  if (!note.password) return "ok";
  if (!providedPassword) return "denied";
  if (!passwordLimiter(rateLimitKey)) return "rate_limited";
  const isMatch = await argon2.verify(note.password, providedPassword);
  return isMatch ? "ok" : "denied";
}
