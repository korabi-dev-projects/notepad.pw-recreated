import { createCipheriv, randomBytes } from "crypto";

export default async function encryptNoteContent(
  content: string,
  password: string,
): Promise<string> {
  // simple symmetric encryption using AES-256-GCM, using plaintext password as key
  const key = password;
  // use same iv for everything
  const iv = Buffer.from("0000000000000000", "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = await cipher.update(content, "utf8", "hex");
  encrypted += await cipher.final("hex");
  return encrypted;
}
