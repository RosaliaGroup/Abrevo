/**
 * Shared operator-auth library (server-side only, no dependencies).
 *
 * Provides: scrypt password verification (constant-time), stateless HMAC-signed
 * session tokens, session cookie helpers, and session-bound CSRF tokens.
 *
 * SECURITY: never log passwords, hashes, session tokens, or CSRF tokens.
 * All secret comparisons use crypto.timingSafeEqual.
 */
const crypto = require("crypto");

const SESSION_COOKIE = "__session";
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8-hour absolute session TTL

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBuf(str) {
  let s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function timingEqualStr(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ---- Password: format  scrypt$N$r$p$<saltB64>$<hashB64> ----
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

// Offline/test helper to MINT a hash (never stores anything). Operator runs this
// once and pastes the result into OPERATOR_PASSWORD_HASH; the plaintext is discarded.
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${dk.toString("base64")}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
  if (!N || !r || !p) return false;
  let salt, expected, derived;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
    derived = crypto.scryptSync(password, salt, expected.length, { N, r, p, maxmem: 128 * 1024 * 1024 });
  } catch { return false; }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

// ---- Stateless HMAC-signed session token: b64url(payload).b64url(sig) ----
function signSession(sub, secret, ttlMs = DEFAULT_TTL_MS, now = Date.now()) {
  const payload = { sub, iat: Math.floor(now / 1000), exp: Math.floor((now + ttlMs) / 1000) };
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(p).digest());
  return `${p}.${sig}`;
}
function verifySession(token, secret, now = Date.now()) {
  if (!token || typeof token !== "string") return { ok: false };
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false };
  const p = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = b64url(crypto.createHmac("sha256", secret).update(p).digest());
  if (!timingEqualStr(sig, expect)) return { ok: false };
  let payload;
  try { payload = JSON.parse(b64urlToBuf(p).toString("utf8")); } catch { return { ok: false }; }
  if (!payload || !payload.exp || payload.exp * 1000 <= now) return { ok: false, expired: true };
  return { ok: true, sub: payload.sub, exp: payload.exp };
}

// ---- Session-bound CSRF token (derived from the session payload + secret) ----
function csrfToken(sessionToken, secret) {
  const p = String(sessionToken).split(".")[0];
  return b64url(crypto.createHmac("sha256", secret).update(`csrf:${p}`).digest());
}
function verifyCsrf(sessionToken, provided, secret) {
  if (!sessionToken || !provided) return false;
  return timingEqualStr(provided, csrfToken(sessionToken, secret));
}

// ---- Booking confirm token: b64url(HMAC-SHA256(id, secret)) truncated to 16 ----
// Used by the day-before reminder (mint) and functions/confirm.js (verify).
function confirmToken(id, secret) {
  return b64url(crypto.createHmac("sha256", secret).update(String(id)).digest()).slice(0, 16);
}

// ---- Cookies ----
function parseCookies(header) {
  const out = {};
  String(header || "").split(/;\s*/).forEach((kv) => {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  });
  return out;
}
function sessionSetCookie(token, maxAgeSec) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}
function sessionClearCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
function sessionTokenFromEvent(event) {
  const h = (event && event.headers) || {};
  return parseCookies(h.cookie || h.Cookie)[SESSION_COOKIE] || null;
}
function getClientIp(event) {
  const h = (event && event.headers) || {};
  return (
    h["x-nf-client-connection-ip"] ||
    String(h["x-forwarded-for"] || "").split(",")[0].trim() ||
    "unknown"
  );
}
function header(event, name) {
  const h = (event && event.headers) || {};
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || null;
}

module.exports = {
  SESSION_COOKIE, DEFAULT_TTL_MS,
  hashPassword, verifyPassword,
  signSession, verifySession,
  csrfToken, verifyCsrf,
  confirmToken,
  b64url, timingEqualStr,
  parseCookies, sessionSetCookie, sessionClearCookie, sessionTokenFromEvent, getClientIp, header,
};
