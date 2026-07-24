/**
 * functions/lib/sms.js
 *
 * Single outbound SMS sender for the Abrevo platform (Telnyx).
 * Replaces the per-file Textbelt implementations.
 *
 * Required env vars (Netlify):
 *   TELNYX_API_KEY               — API key from Mission Control
 *   TELNYX_FROM_ROSALIA          — +12014269354
 *   TELNYX_MESSAGING_PROFILE_ID  — profile the number is assigned to
 * Optional:
 *   SMS_DRY_RUN=true             — log instead of send (staging / testing)
 *   TELNYX_STATUS_WEBHOOK        — delivery receipt callback URL
 *
 * Return shape is intentionally { success, ... } so existing call sites that
 * read `result.success` keep working without edits.
 */

const TELNYX_MESSAGES_URL = 'https://api.telnyx.com/v2/messages';

const API_KEY = process.env.TELNYX_API_KEY;
const FROM_ROSALIA = process.env.TELNYX_FROM_ROSALIA;
const PROFILE_ID = process.env.TELNYX_MESSAGING_PROFILE_ID;
const STATUS_WEBHOOK = process.env.TELNYX_STATUS_WEBHOOK || null;
const DRY_RUN = String(process.env.SMS_DRY_RUN || '').toLowerCase() === 'true';

/**
 * Normalize to E.164. Returns null if the input can't be trusted.
 *
 * NOTE: the old inline helpers did `phone.replace(/\D/g,'')` and then
 * `if (!p.startsWith('+')) p = '+1' + p`. After stripping non-digits the
 * string NEVER starts with '+', so an 11-digit number like 12014970225
 * became +112014970225 and silently failed to deliver. Fixed here.
 */
function toE164(raw) {
  if (raw === null || raw === undefined) return null;
  const original = String(raw).trim();
  const digits = original.replace(/\D/g, '');

  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  // Non-US numbers only if the caller was explicit about the country code.
  if (original.startsWith('+') && digits.length >= 11 && digits.length <= 15) {
    return '+' + digits;
  }
  return null;
}

/** Mask for logs — never write full numbers to Netlify function logs. */
function mask(e164) {
  if (!e164) return 'unknown';
  return e164.slice(0, 2) + '*'.repeat(Math.max(0, e164.length - 6)) + e164.slice(-4);
}

/** Append opt-out language if it isn't already present. */
function withOptOut(text) {
  if (!text) return text;
  return /reply stop|text stop|stop to (unsubscribe|opt)/i.test(text)
    ? text
    : `${text.trim()} Reply STOP to unsubscribe.`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one SMS.
 *
 * @param {string} to      destination number, any format
 * @param {string} text    message body
 * @param {object} options { from?: string, optOut?: boolean, profileId?: string, retries?: number }
 * @returns {Promise<{success:boolean,id:string|null,to:string|null,error:string|null,status:number|null,dryRun?:boolean}>}
 */
async function sendSMS(to, text, options = {}) {
  const result = {
    success: false,
    id: null,
    to: null,
    from: null,
    error: null,
    status: null,
    provider: 'telnyx',
  };

  const dest = toE164(to);
  if (!dest) {
    result.error = 'invalid_phone';
    console.warn('[sms] invalid destination, not sent:', String(to).slice(0, 4) + '…');
    return result;
  }
  result.to = dest;

  let body = text === null || text === undefined ? '' : String(text).trim();
  if (!body) {
    result.error = 'empty_message';
    return result;
  }
  if (options.optOut) body = withOptOut(body);

  // Default sender is Rosalia's number. Deliberately does NOT fall back to
  // TELNYX_FROM_NUMBER — that var holds another tenant's number, and a missed
  // `from` must never send Rosalia traffic from someone else's 10DLC campaign.
  const from = toE164(options.from || FROM_ROSALIA);
  if (!API_KEY || !from) {
    result.error = 'missing_config';
    console.error('[sms] TELNYX_API_KEY missing, or sender number missing/invalid — nothing sent');
    return result;
  }
  result.from = from;

  if (DRY_RUN) {
    console.log(`[sms][DRY RUN] -> ${mask(dest)} (${body.length} chars): ${body.slice(0, 80)}`);
    return { ...result, success: true, id: 'dry-run', dryRun: true };
  }

  const payload = { from, to: dest, text: body };
  const profile = options.profileId || PROFILE_ID;
  if (profile) payload.messaging_profile_id = profile;
  if (STATUS_WEBHOOK) payload.webhook_url = STATUS_WEBHOOK;

  const maxAttempts = Math.max(1, (options.retries ?? 1) + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(TELNYX_MESSAGES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      result.status = res.status;
      const json = await res.json().catch(() => ({}));

      if (res.ok) {
        result.success = true;
        result.id = json?.data?.id || null;
        console.log(`[sms] sent -> ${mask(dest)} id=${result.id}`);
        return result;
      }

      const detail =
        json?.errors?.[0]?.detail || json?.errors?.[0]?.title || `HTTP ${res.status}`;
      result.error = detail;

      // Retry only on rate limit / transient server errors.
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        console.error(`[sms] failed -> ${mask(dest)} (${res.status}): ${detail}`);
        return result;
      }
      await sleep(500 * attempt);
    } catch (err) {
      result.error = err.message;
      if (attempt === maxAttempts) {
        console.error(`[sms] error -> ${mask(dest)}: ${err.message}`);
        return result;
      }
      await sleep(500 * attempt);
    }
  }

  return result;
}

/**
 * Send to many recipients with pacing. Use for campaigns and bulk follow-ups.
 * A newly registered number has no reputation — keep this slow at first.
 *
 * @param {Array<{to:string,text:string}>} messages
 * @param {object} options { delayMs?: number, optOut?: boolean }
 */
async function sendBulk(messages, options = {}) {
  const delayMs = options.delayMs ?? 1000;
  const results = [];
  for (const msg of messages) {
    results.push(await sendSMS(msg.to, msg.text, options));
    if (delayMs) await sleep(delayMs);
  }
  const sent = results.filter((r) => r.success).length;
  console.log(`[sms] bulk complete: ${sent}/${results.length} sent`);
  return results;
}

module.exports = { sendSMS, sendBulk, toE164, withOptOut, mask };
