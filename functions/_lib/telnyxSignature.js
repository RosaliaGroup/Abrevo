'use strict';
/**
 * Telnyx webhook authenticity verification (Ed25519).
 *
 * Telnyx signs each webhook with Ed25519 over `${timestamp}|${rawBody}` and
 * sends:
 *   header  telnyx-signature-ed25519  -> base64 signature
 *   header  telnyx-timestamp          -> unix seconds
 * The verifying key is the account's Ed25519 public key (base64, 32 raw bytes),
 * provided via env TELNYX_PUBLIC_KEY.
 *
 * We wrap the 32 raw public-key bytes in the standard SPKI/DER prefix so Node's
 * crypto can build a KeyObject, then verify with the null (Ed25519) algorithm.
 * A timestamp tolerance guards against replay.
 *
 * Verification uses the RAW request body — callers must pass the exact bytes
 * Telnyx sent, not a re-serialized object.
 */

const crypto = require('crypto');

// DER SubjectPublicKeyInfo prefix for an Ed25519 public key (12 bytes).
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function publicKeyFromRaw(base64Key) {
  const raw = Buffer.from(base64Key, 'base64');
  if (raw.length !== 32) throw new Error('TELNYX_PUBLIC_KEY must decode to 32 bytes');
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/**
 * @param {object} args
 * @param {string} args.publicKey   base64 Ed25519 public key (env TELNYX_PUBLIC_KEY)
 * @param {string} args.signature   base64 signature (telnyx-signature-ed25519)
 * @param {string} args.timestamp   unix seconds (telnyx-timestamp)
 * @param {string} args.payload     RAW request body string
 * @param {number} [args.toleranceSeconds=300]
 * @param {number} [args.nowSeconds] injectable clock for tests
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyTelnyxSignature({ publicKey, signature, timestamp, payload, toleranceSeconds = 300, nowSeconds } = {}) {
  if (!publicKey) return { valid: false, reason: 'no_public_key' };
  if (!signature) return { valid: false, reason: 'no_signature' };
  if (!timestamp) return { valid: false, reason: 'no_timestamp' };

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { valid: false, reason: 'bad_timestamp' };
  const now = Number.isFinite(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return { valid: false, reason: 'timestamp_out_of_tolerance' };

  let key;
  try { key = publicKeyFromRaw(publicKey); }
  catch (e) { return { valid: false, reason: 'bad_public_key' }; }

  const signed = Buffer.from(`${timestamp}|${payload}`, 'utf8');
  let sig;
  try { sig = Buffer.from(signature, 'base64'); }
  catch (e) { return { valid: false, reason: 'bad_signature_encoding' }; }

  let ok = false;
  try { ok = crypto.verify(null, signed, key, sig); }
  catch (e) { return { valid: false, reason: 'verify_error' }; }

  return ok ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}

module.exports = { verifyTelnyxSignature, publicKeyFromRaw, ED25519_SPKI_PREFIX };
