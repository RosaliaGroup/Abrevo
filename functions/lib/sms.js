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

// Communications thread logging. Best-effort and never throws — see
// _lib/threadLog.js. Loaded defensively so a bundling problem in the
// Communications module can never take down platform SMS.
let threadLog = null;
try {
  threadLog = require('../_lib/threadLog');
} catch (err) {
  console.warn('[sms] thread logging unavailable:', err.message);
}

// Window for the duplicate guard. Long enough to catch overlapping scheduled
// runs, short enough that a genuine re-send an hour later still goes out.
const DEDUPE_MINUTES = 10;

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

  // North American Numbering Plan: both the area code and the exchange are NXX,
  // where N is 2-9. Without this check a bad 10-digit source value like
  // "1347418501" became "+11347418501" (area code 134) and was handed to Telnyx
  // as a real send — it can never deliver. Rejecting here fails fast instead.
  const validNanp = (ten) => /^[2-9]\d{2}[2-9]\d{6}$/.test(ten);

  if (digits.length === 10) return validNanp(digits) ? '+1' + digits : null;
  if (digits.length === 11 && digits.startsWith('1')) {
    const ten = digits.slice(1);
    return validNanp(ten) ? '+' + digits : null;
  }
  // Non-US numbers only if the caller was explicit about the country code.
  // NANP rules don't apply, so these pass through on length alone as before.
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
async function sendViaTelnyx(to, text, options = {}) {
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
 * Public sender. Same signature and same `{ success, ... }` return shape as
 * before, so all existing call sites keep working untouched.
 *
 * Adds two things around the raw Telnyx call:
 *
 *   1. OPT-OUT ENFORCEMENT. Previously only the (unused) Communications path
 *      checked opt-out, so every one of the platform's senders could text a
 *      person who had replied STOP. Now a confirmed opt-out blocks the send and
 *      is recorded on the thread. Fail-open: if the check itself errors, the
 *      message is sent (a DB hiccup must not stop booking confirmations).
 *
 *   2. THREAD LOGGING. The outbound message is written to conversations/messages
 *      so it appears in the Communications inbox and can be replied to. This is
 *      best-effort and never blocks or fails a send.
 *
 * New optional options (all backwards compatible):
 *   options.links      [{ type:'lead'|'booking', id }] — CRM linkage
 *   options.leadId     shorthand for links:[{type:'lead',id}]
 *   options.bookingId  shorthand for links:[{type:'booking',id}]
 *   options.createdBy  origin tag for the conversation, e.g. 'book'
 *   options.noThread   true to skip thread logging entirely
 */
async function sendSMS(to, text, options = {}) {
  const links = Array.isArray(options.links) ? options.links.slice() : [];
  if (options.leadId) links.push({ type: 'lead', id: options.leadId });
  if (options.bookingId) links.push({ type: 'booking', id: options.bookingId });

  const dest = toE164(to);

  // 1. Opt-out gate (skipped when thread logging is unavailable or suppressed).
  if (threadLog && dest && !options.noThread) {
    const optedOut = await threadLog.isOptedOut(dest);
    if (optedOut) {
      console.log(`[sms] blocked, recipient opted out -> ${mask(dest)}`);
      return {
        success: false,
        id: null,
        to: dest,
        from: null,
        error: 'opted_out',
        status: null,
        provider: 'telnyx',
        blocked: true,
      };
    }
  }

  // 2. Duplicate guard — ALWAYS ON. The exact same text to the same number
  //    within a few minutes is never intentional; it means two overlapping runs
  //    of a scheduled function both picked up the same lead before the first
  //    marked it done. This happened in production: one lead received identical
  //    texts one second apart.
  if (threadLog && dest && !options.noThread) {
    const recent = await threadLog.recentOutbound(dest, DEDUPE_MINUTES);
    const body = options.optOut ? withOptOut(String(text || '').trim()) : String(text || '').trim();
    if (recent.some((m) => (m.body || '').trim() === body)) {
      console.log(`[sms] suppressed duplicate -> ${mask(dest)} (identical text within ${DEDUPE_MINUTES}m)`);
      return {
        success: false, id: null, to: dest, from: null,
        error: 'duplicate_suppressed', status: null, provider: 'telnyx', suppressed: true,
      };
    }

    // 3. Cooldown — OPT-IN via options.cooldownHours. Deliberately not the
    //    default: a booking confirmation or appointment reminder must never be
    //    withheld because a marketing text happened to go out earlier. Only
    //    follow-up senders opt in.
    if (options.cooldownHours > 0) {
      const inCooldown = await threadLog.recentOutbound(dest, options.cooldownHours * 60);
      if (inCooldown.length) {
        console.log(`[sms] held by ${options.cooldownHours}h cooldown -> ${mask(dest)}`);
        return {
          success: false, id: null, to: dest, from: null,
          error: 'cooldown', status: null, provider: 'telnyx', suppressed: true,
        };
      }
    }
  }

  // 4. Actual send (unchanged behaviour).
  const result = await sendViaTelnyx(to, text, options);

  // 5. Thread log. Uses the body as actually sent, including opt-out language.
  if (threadLog && !options.noThread && result.to) {
    let body = text === null || text === undefined ? '' : String(text).trim();
    if (options.optOut) body = withOptOut(body);
    await threadLog.logOutbound({
      to: result.to,
      body,
      result,
      links,
      createdBy: options.createdBy || 'outbound',
    });
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
