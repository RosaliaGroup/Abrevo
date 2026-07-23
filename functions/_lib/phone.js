'use strict';
/**
 * Canonical, server-side phone normalization for the internal Communications
 * system. This is the SINGLE source of truth for turning arbitrary phone input
 * into E.164 for conversation matching. Do not re-implement normalization
 * elsewhere — import this.
 *
 * Rules (NANP only, matching the existing Abrevo convention):
 *   - Strip all non-digit characters.
 *   - 10 digits            -> prepend "+1"      (e.g. 5551234567  -> +15551234567)
 *   - 11 digits, leading 1 -> prepend "+"       (e.g. 15551234567 -> +15551234567)
 *   - anything else        -> INVALID (rejected explicitly)
 *   - empty / null / undefined -> MISSING (rejected explicitly)
 *
 * Non-throwing: returns a result object so callers can branch on it and return
 * a clean "no-phone / invalid-phone" result without try/catch. A conversation
 * must NOT be created for a missing or invalid number.
 *
 * @param {unknown} input
 * @returns {{ ok: true, e164: string, digits: string }
 *          | { ok: false, reason: 'missing' | 'invalid', input: string }}
 */
function normalizePhone(input) {
  if (input === null || input === undefined) {
    return { ok: false, reason: 'missing', input: '' };
  }
  const raw = String(input);
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 0) {
    return { ok: false, reason: 'missing', input: raw };
  }
  if (digits.length === 10) {
    return { ok: true, e164: '+1' + digits, digits: '1' + digits };
  }
  if (digits.length === 11 && digits[0] === '1') {
    return { ok: true, e164: '+' + digits, digits };
  }
  return { ok: false, reason: 'invalid', input: raw };
}

/**
 * Convenience wrapper that returns the E.164 string or null. Prefer
 * normalizePhone() when you need the reason for rejection.
 * @param {unknown} input
 * @returns {string | null}
 */
function toE164OrNull(input) {
  const r = normalizePhone(input);
  return r.ok ? r.e164 : null;
}

module.exports = { normalizePhone, toE164OrNull };
