import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function encryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("GA4_KEY_INVALID");
  return key;
}

export function sealToken(token: string, encodedKey: string, binding: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(encodedKey), iv);
  cipher.setAAD(Buffer.from(binding));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function openToken(envelope: string, encodedKey: string, binding: string): string {
  const [version, iv, encrypted, tag, extra] = envelope.split(".");
  if (version !== "v1" || !iv || !encrypted || !tag || extra) throw new Error("GA4_CREDENTIAL_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(encodedKey), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
