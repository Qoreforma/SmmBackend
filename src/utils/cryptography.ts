import bcrypt from "bcrypt";
import crypto from "crypto";

const getSecretEncryptionKey = (): Buffer => {
  const key = process.env.API_SECRET_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      "API_SECRET_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)",
    );
  }
  return Buffer.from(key, "hex");
};

// One-way, deterministic hash for API key LOOKUP (not a password —
// it's a random 32-byte token, so a fast hash is appropriate here).
export const hashApiKey = (apiKey: string): string => {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
};

// Reversible encryption for the API SECRET, which must be recoverable
// to verify HMAC signatures (unlike a password, it can't be one-way hashed).
export const encryptApiSecret = (plainSecret: string): string => {
  const key = getSecretEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainSecret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
};

export const decryptApiSecret = (encryptedPayload: string): string => {
  const key = getSecretEncryptionKey();
  const [ivHex, authTagHex, dataHex] = encryptedPayload.split(":");
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error("Malformed encrypted API secret payload");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(12);
  return await bcrypt.hash(password, salt);
};

export const comparePassword = async (
  password: string,
  hashedPassword: string,
): Promise<boolean> => {
  const convertedHash = hashedPassword.replace(/^\$2y\$/, "$2a$");

  const result = await bcrypt.compare(String(password), convertedHash);

  return result;
};

export const generateOTP = (length: number = 6): string => {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
};

export const isPasswordInHistory = async (
  newPassword: string,
  passwordHistory: string[],
): Promise<boolean> => {
  for (const hashedPassword of passwordHistory) {
    if (await comparePassword(newPassword, hashedPassword)) {
      return true;
    }
  }
  return false;
};

export function updatePasswordHistory(
  passwordHistory: string[],
  newPasswordHash: string,
  maxHistory: number = 5,
): string[] {
  const updatedHistory = [newPasswordHash, ...passwordHistory];
  return updatedHistory.slice(0, maxHistory);
}
