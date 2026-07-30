'use strict';
/**
 * threadLog.js — makes outbound SMS visible in the Communications inbox.
 *
 * WHY THIS EXISTS
 * Every outbound text in the platform goes through functions/lib/sms.js, which
 * posts straight to Telnyx and records nothing readable (sms_log holds only a
 * provider id + delivery status, no body). Meanwhile the Communications inbox
 * reads conversations/messages, which until now only ever received INBOUND
 * messages from telnyx-inbound.js. Result: the inbox showed one side of every
 * conversation. This module writes the outbound side.
 *
 * DESIGN RULES
 * 1. NEVER throw and NEVER block a send. Logging is strictly best-effort: if
 *    Supabase is down, the text still goes out. Every entry point is wrapped.
 * 2. Reuse the existing services (supabaseRepo + conversations) rather than
 *    re-implementing get-or-create. Race-safety comes from the DB unique index
 *    on conversations.normalized_phone, already handled in conversations.js.
 * 3. Internal/team numbers are excluded. Ana's cell and our own business lines
 *    receive dozens of operational alerts a day; threading those would bury
 *    real lead conversations at the top of the inbox.
 *
 * Env: SUPABASE_URL (falls back to the known project URL, matching the
 * convention in social-auth.js), SUPABASE_SERVICE_KEY.
 */

const { createSupabaseRepo } = require('./supabaseRepo');
const { createConversationService } = require('./conversations');

const DEFAULT_SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const PREVIEW_CHARS = 140;

/**
 * Our own numbers — alerts to these are operational, not conversations.
 * Kept local rather than importing lib/skipNumbers.js to avoid a require cycle
 * (skipNumbers requires lib/sms.js, which requires this module).
 */
const INTERNAL_NUMBERS = new Set(
  [
    '+16462269189', // Ana's cell
    '+12014970225', // team notify line
    '+15512499795', // Rosalia Group (551) 249-9795
    '+18623331681', // Iron 65 (862) 333-1681
    '+16404009681', // Rosalia account business line
    '+12014269354', // Rosalia Telnyx sender
  ].filter(Boolean)
);

function isInternalNumber(e164) {
  if (!e164) return false;
  if (INTERNAL_NUMBERS.has(e164)) return true;
  // Also treat the configured sender as internal, whatever it is set to.
  const from = String(process.env.TELNYX_FROM_ROSALIA || '').replace(/[^\d+]/g, '');
  return Boolean(from) && from === e164;
}

let cached = null;
function services() {
  if (cached) return cached;
  const repo = createSupabaseRepo({
    url: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  });
  cached = { repo, conversations: createConversationService({ repo }) };
  return cached;
}

/**
 * Has this number opted out?
 *
 * FAIL-OPEN BY DESIGN: returns false on any error or when the number has no
 * conversation yet. A database hiccup must not silently stop booking
 * confirmations and appointment reminders from going out. Only a positively
 * confirmed opted_out_at blocks a send.
 *
 * @returns {Promise<boolean>} true only if confirmed opted out
 */
async function isOptedOut(e164) {
  try {
    if (!e164 || isInternalNumber(e164)) return false;
    const { repo } = services();
    const conv = await repo.getConversationByPhone(e164);
    return Boolean(conv && conv.opted_out_at);
  } catch (err) {
    console.warn('[threadLog] opt-out check unavailable, allowing send:', err.message);
    return false;
  }
}

/**
 * Record an outbound message on the recipient's thread.
 *
 * @param {object} args
 * @param {string}  args.to        destination in E.164 (already normalized by sms.js)
 * @param {string}  args.body      message text as sent
 * @param {object}  args.result    the sendSMS result ({ success, id, error, dryRun })
 * @param {Array}   [args.links]   [{ type:'lead'|'booking', id }] CRM linkage
 * @param {string}  [args.createdBy] origin tag, e.g. 'book', 'reminder'
 * @returns {Promise<{logged:boolean, reason?:string, messageId?:string, conversationId?:string}>}
 */
async function logOutbound({ to, body, result, links = [], createdBy } = {}) {
  try {
    if (!to) return { logged: false, reason: 'no_destination' };
    if (isInternalNumber(to)) return { logged: false, reason: 'internal_number' };
    if (!body) return { logged: false, reason: 'empty_body' };

    const { repo, conversations } = services();

    const conv = await conversations.getOrCreateConversation({
      phone: to,
      links: Array.isArray(links) ? links : [],
      createdBy: createdBy || 'outbound',
    });
    if (!conv.ok) return { logged: false, reason: conv.reason };

    const now = new Date().toISOString();
    const sent = Boolean(result && result.success);

    // Only persist a real provider id. 'dry-run' is a sentinel, and the unique
    // partial index on (provider, provider_message_id) would reject repeats.
    const providerId =
      result && result.id && result.id !== 'dry-run' ? String(result.id) : null;

    const message = await repo.insertMessage({
      conversation_id: conv.conversation.id,
      direction: 'outbound',
      body: String(body),
      status: sent ? 'sent' : 'failed',
      provider: (result && result.provider) || 'telnyx',
      provider_message_id: providerId,
      error_code: sent ? null : (result && result.error) || 'send_failed',
      error_message: sent ? null : (result && result.error) || null,
      sent_at: sent ? now : null,
      created_at: now,
    });

    // Keeps the inbox list ordered and previewable without an N+1 query.
    await repo.touchConversation(conv.conversation.id, {
      last_message_at: now,
      last_message_preview: String(body).slice(0, PREVIEW_CHARS),
      last_message_direction: 'outbound',
    });

    return {
      logged: true,
      messageId: message && message.id,
      conversationId: conv.conversation.id,
    };
  } catch (err) {
    // Swallow deliberately — the text was already sent; losing the log entry is
    // strictly better than throwing inside a booking or reminder handler.
    console.warn('[threadLog] could not log outbound message:', err.message);
    return { logged: false, reason: 'error' };
  }
}

/**
 * Recent outbound history for a number, newest first.
 *
 * Powers two guards in lib/sms.js: the duplicate check and the cooldown. Both
 * FAIL OPEN — on any error this returns an empty list, so a database problem
 * lets messages through rather than silently blocking booking confirmations.
 *
 * @param {string} e164
 * @param {number} withinMinutes how far back to look
 * @returns {Promise<Array<{body:string, created_at:string}>>}
 */
async function recentOutbound(e164, withinMinutes) {
  try {
    if (!e164) return [];
    const { repo } = services();
    const conv = await repo.getConversationByPhone(e164);
    if (!conv) return [];

    const cutoff = Date.now() - withinMinutes * 60 * 1000;
    // listMessages returns oldest-first, so take the tail and reverse it.
    const all = await repo.listMessages(conv.id, { limit: 100 });
    return all
      .filter((m) => m.direction === 'outbound' && Date.parse(m.created_at) >= cutoff)
      .reverse();
  } catch (err) {
    console.warn('[threadLog] recent-send lookup unavailable, allowing send:', err.message);
    return [];
  }
}

module.exports = { logOutbound, isOptedOut, isInternalNumber, recentOutbound, INTERNAL_NUMBERS };
