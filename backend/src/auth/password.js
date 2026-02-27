import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

function safeTimingEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export async function hashPassword(password) {
  const pw = String(password || "");
  if (pw.length < 6) throw new Error("Password must be at least 6 characters.");
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(pw, salt, 64);
  const saltB64 = salt.toString("base64");
  const hashB64 = Buffer.from(derived).toString("base64");
  return `scrypt:${saltB64}:${hashB64}`;
}

export async function verifyPassword(password, stored) {
  const pw = String(password || "");
  const raw = String(stored || "");
  const [algo, saltB64, hashB64] = raw.split(":");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }

  const derived = await scryptAsync(pw, salt, expected.length);
  return safeTimingEqual(derived, expected);
}

