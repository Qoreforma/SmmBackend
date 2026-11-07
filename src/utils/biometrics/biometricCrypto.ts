import crypto from "crypto";
import logger from "@/logger";

// Constant ASN.1 SubjectPublicKeyInfo header for NIST P-256 (secp256r1) EC public key
// 30 59: SEQUENCE of 89 bytes
// 30 13: SEQUENCE (AlgorithmIdentifier) of 19 bytes
//   06 07 2A 86 48 CE 3D 02 01 (id-ecPublicKey)
//   06 08 2A 86 48 CE 3D 03 01 07 (secp256r1 / prime256v1)
// 03 42 00: BIT STRING of 66 bytes (0 unused bits + 65-byte uncompressed point)
const EC_P256_SPKI_PREFIX = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex",
);

export class BiometricCrypto {
  /**
   * Generates a cryptographically secure, URL-safe random challenge.
   */
  static generateChallenge(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  /**
   * Parses and standardizes an incoming public key string from the client into
   * a Node.js KeyObject and a clean standard PEM string.
   *
   * Accepts:
   * 1. Standard PEM string (-----BEGIN PUBLIC KEY----- ...)
   * 2. Raw Base64 or Base64URL string of DER SPKI
   * 3. Raw 65-byte uncompressed EC P-256 public key (starting with 0x04) in Base64
   */
  static parsePublicKey(rawKey: string): {
    keyObject: crypto.KeyObject;
    pem: string;
  } {
    if (!rawKey || typeof rawKey !== "string") {
      throw new Error("Public key must be a non-empty string");
    }

    const trimmed = rawKey.trim();

    // 1. Try standard PEM
    if (trimmed.includes("-----BEGIN PUBLIC KEY-----")) {
      try {
        const keyObject = crypto.createPublicKey(trimmed);
        const pem = keyObject.export({ type: "spki", format: "pem" }).toString();
        return { keyObject, pem };
      } catch (err) {
        logger.debug("[BiometricCrypto] Failed to parse as literal PEM, trying alternative encodings:", err);
      }
    }

    // Clean any whitespace/newlines and try decoding base64
    const base64Clean = trimmed.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    let keyBuffer: Buffer;
    try {
      keyBuffer = Buffer.from(base64Clean, "base64");
    } catch {
      throw new Error("Public key is not valid Base64 or PEM");
    }

    // 2. Check if this is a raw 65-byte uncompressed EC P-256 point (0x04 || X (32) || Y (32))
    if (keyBuffer.length === 65 && keyBuffer[0] === 0x04) {
      try {
        const fullSpkiDer = Buffer.concat([EC_P256_SPKI_PREFIX, keyBuffer]);
        const keyObject = crypto.createPublicKey({
          key: fullSpkiDer,
          format: "der",
          type: "spki",
        });
        const pem = keyObject.export({ type: "spki", format: "pem" }).toString();
        return { keyObject, pem };
      } catch (err) {
        logger.warn("[BiometricCrypto] Failed to wrap raw EC P-256 point:", err);
      }
    }

    // 3. Try parsing buffer directly as DER SPKI
    try {
      const keyObject = crypto.createPublicKey({
        key: keyBuffer,
        format: "der",
        type: "spki",
      });
      const pem = keyObject.export({ type: "spki", format: "pem" }).toString();
      return { keyObject, pem };
    } catch {
      // 4. Try formatting as PEM with standard 64-char wrapping
      try {
        const wrapped = `-----BEGIN PUBLIC KEY-----\n${base64Clean.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;
        const keyObject = crypto.createPublicKey(wrapped);
        const pem = keyObject.export({ type: "spki", format: "pem" }).toString();
        return { keyObject, pem };
      } catch (finalErr) {
        throw new Error(
          `Unable to parse public key format. Supported formats: SPKI PEM, Base64 DER SPKI, or raw P-256 EC point. Error: ${finalErr}`,
        );
      }
    }
  }

  /**
   * Verifies an asymmetric digital signature over a challenge string.
   *
   * Automatically handles:
   * - Algorithm: ECDSA with SHA-256 (ES256) or RSA with SHA-256 (RS256)
   * - Signature encodings: ASN.1 DER and IEEE P1363 (raw 64-byte r||s)
   * - Challenge encodings: String as UTF-8 bytes and decoded base64url bytes
   *
   * @param challenge The challenge string issued by the server
   * @param signatureRaw The signature from the client (Base64 or Base64URL)
   * @param publicKeyPem The PEM public key
   * @param algorithm The signature algorithm ('ES256' | 'RS256')
   */
  static verifySignature(
    challenge: string,
    signatureRaw: string,
    publicKeyPem: string,
    algorithm: "ES256" | "RS256" = "ES256",
  ): boolean {
    try {
      if (!challenge || !signatureRaw || !publicKeyPem) {
        return false;
      }

      // Clean signature string
      const sigBase64 = signatureRaw
        .trim()
        .replace(/\s+/g, "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");

      let sigBuffer: Buffer;
      try {
        sigBuffer = Buffer.from(sigBase64, "base64");
      } catch {
        return false;
      }

      const { keyObject } = this.parsePublicKey(publicKeyPem);
      const hashAlg = "SHA256";

      // Candidates for challenge buffer:
      // A) The challenge string encoded as UTF-8 (standard for string signing)
      // B) The challenge string decoded as base64url bytes (if mobile SDK signed raw challenge bytes)
      const challengeCandidates: Buffer[] = [Buffer.from(challenge, "utf8")];
      try {
        const decodedBytes = Buffer.from(challenge, "base64url");
        if (decodedBytes.length > 0) {
          challengeCandidates.push(decodedBytes);
        }
      } catch {
        // ignore
      }

      // If algorithm is ES256 (ECDSA), test both ASN.1 DER and IEEE P1363 signature encodings
      if (algorithm === "ES256") {
        for (const challengeBuf of challengeCandidates) {
          // 1. Try DER encoding
          try {
            const ok = crypto.verify(
              hashAlg,
              challengeBuf,
              { key: keyObject, dsaEncoding: "der" },
              sigBuffer,
            );
            if (ok) return true;
          } catch {
            // DER decoding error, proceed to try ieee-p1363
          }

          // 2. Try IEEE P1363 encoding (raw 64-byte r || s)
          try {
            const ok = crypto.verify(
              hashAlg,
              challengeBuf,
              { key: keyObject, dsaEncoding: "ieee-p1363" },
              sigBuffer,
            );
            if (ok) return true;
          } catch {
            // ignore
          }
        }
      } else {
        // RSA / RS256
        for (const challengeBuf of challengeCandidates) {
          try {
            const ok = crypto.verify(hashAlg, challengeBuf, keyObject, sigBuffer);
            if (ok) return true;
          } catch {
            // ignore
          }
        }
      }

      return false;
    } catch (error) {
      logger.error("[BiometricCrypto] Signature verification error:", error);
      return false;
    }
  }
}
