import crypto from "crypto";

/**
 * Derives a consistent 32-byte key from the PROVIDER_SECRET.
 * If not set, falls back to a default string so dev mode doesn't crash.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.PROVIDER_SECRET || "default_local_secret_12345";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a URL using AES-256-CBC.
 * Returns a hex string in the format "iv:encryptedData".
 */
export function encryptUrl(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getEncryptionKey(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a URL previously encrypted by encryptUrl.
 * Returns the decrypted string, or null if invalid.
 */
export function decryptUrl(text: string): string | null {
  try {
    const parts = text.split(":");
    if (parts.length !== 2) return null;
    
    const iv = Buffer.from(parts[0], "hex");
    const encryptedText = parts[1];
    
    const decipher = crypto.createDecipheriv("aes-256-cbc", getEncryptionKey(), iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (err) {
    return null; // Invalid format, wrong key, etc.
  }
}
