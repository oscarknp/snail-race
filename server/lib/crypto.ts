import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { config } from "../config.ts";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptAsync(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scryptAsync(password, Buffer.from(saltB64, "base64"), +N, +r, +p, expected.length);
  return timingSafeEqual(key, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---- Encryption at rest for third-party tokens (AES-256-GCM) ----

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  let b64 = config.tokenEncryptionKey;
  if (!b64) {
    if (config.isProd) throw new Error("TOKEN_ENCRYPTION_KEY must be set in production");
    // Development convenience: generate a key once and keep it next to the database.
    const path = `${config.dataDir}/dev-secrets.json`;
    try {
      b64 = JSON.parse(Deno.readTextFileSync(path)).tokenEncryptionKey;
    } catch {
      b64 = randomBytes(32).toString("base64");
      Deno.mkdirSync(config.dataDir, { recursive: true });
      Deno.writeTextFileSync(path, JSON.stringify({ tokenEncryptionKey: b64 }), { mode: 0o600 });
      console.warn(`[crypto] TOKEN_ENCRYPTION_KEY not set; generated a development key in ${path}`);
    }
  }
  cachedKey = keyFromSetting(b64!);
  return cachedKey;
}

/**
 * Accepts either 32 random bytes in base64 (`openssl rand -base64 32`) or any long passphrase,
 * e.g. from a password manager, which is stretched to 32 bytes with SHA-256.
 */
function keyFromSetting(value: string): Buffer {
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    const raw = Buffer.from(value, "base64");
    if (raw.length === 32) return raw;
  }
  if (value.length < 32) throw new Error("TOKEN_ENCRYPTION_KEY must be at least 32 characters long");
  return createHash("sha256").update(value, "utf8").digest();
}

/** Fail fast at startup if the configured key is unusable. */
export function validateEncryptionKey() {
  encryptionKey();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [v, ivB64, tagB64, dataB64] = stored.split(":");
  if (v !== "v1") throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
