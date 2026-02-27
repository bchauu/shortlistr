import crypto from "node:crypto";

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(s) {
  const str = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str + pad, "base64");
}

function signHs256(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

export function signJwt({ secret, payload, expiresInSeconds = 60 * 60 * 24 * 30 }) {
  if (!secret) throw new Error("JWT secret missing.");

  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + Number(expiresInSeconds || 0)
  };

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(body)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = base64UrlEncode(signHs256(signingInput, secret));
  return `${signingInput}.${sig}`;
}

export function verifyJwt({ secret, token }) {
  if (!secret) throw new Error("JWT secret missing.");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid token format.");

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = base64UrlEncode(signHs256(signingInput, secret));

  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  if (a.length !== b.length) throw new Error("Invalid token signature.");
  if (!crypto.timingSafeEqual(a, b)) throw new Error("Invalid token signature.");

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new Error("Invalid token payload.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload?.exp === "number" && now >= payload.exp) throw new Error("Token expired.");

  return payload;
}

