'use strict';
/**
 * Telnyx inbound-message webhook. Verifies Ed25519 signature over the RAW body,
 * then persists the inbound message once and applies STOP/START/HELP. Never
 * sends a live SMS here (compliance auto-reply is intentionally not wired in
 * Phase 2 — see COMPLIANCE below).
 *
 * AUTH: this is a PUBLIC provider webhook — it does NOT require a Rosalia
 * operator session. Its authenticity gate is the Telnyx Ed25519 signature
 * (with timestamp/replay tolerance inside verifyTelnyxSignature). It also
 * enforces POST-only and a bounded request size.
 */

const { verifyTelnyxSignature } = require('./_lib/telnyxSignature');
const { recordInboundOnLead } = require('./lib/leadStage');
const { detectIntent, intentReply } = require('./lib/inboundIntent');
const { sendPush } = require('./lib/webpush');
const { sendSMS } = require('./lib/sms');
const { createCommContext } = require('./_lib/commContext');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX_BODY = 256 * 1024; // bounded webhook size (MMS payloads carry media URLs, still small)
function reply(statusCode, obj) { return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) }; }

function header(event, name) {
  const h = (event && event.headers) || {};
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || null;
}

// Factory so tests can inject a fake context (no real Supabase/Telnyx). The real
// Ed25519 signature gate is always exercised (not injected).
function makeHandler(deps = {}) {
  const makeContext = deps.makeContext || createCommContext;

  return async (event) => {
    const method = String((event && event.httpMethod) || 'POST').toUpperCase();
    if (method !== 'POST') return reply(405, { ok: false, error: { code: 'method_not_allowed', message: 'POST only' } });

    const raw = (event && event.body) || '';
    if (raw.length > MAX_BODY) return reply(413, { ok: false, error: { code: 'payload_too_large' } });

    const verdict = verifyTelnyxSignature({
      publicKey: process.env.TELNYX_PUBLIC_KEY,
      signature: header(event, 'telnyx-signature-ed25519'),
      timestamp: header(event, 'telnyx-timestamp'),
      payload: raw,
    });
    if (!verdict.valid) return reply(401, { ok: false, error: { code: 'invalid_signature', message: verdict.reason } });

    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return reply(400, { ok: false, error: { code: 'bad_json' } }); }

    // Only handle inbound message events here.
    const et = parsed && parsed.data && parsed.data.event_type;
    if (et !== 'message.received') return reply(200, { ok: true, ignored: true, event_type: et || null });

    let ctx;
    try { ctx = makeContext(); } catch (e) { return reply(500, { ok: false, error: { code: 'server_misconfigured' } }); }

    try {
      const res = await ctx.webhook.processInbound(parsed);
      if (!res.ok) {
        // e.g. invalid sender phone — acknowledge (2xx) so Telnyx does not retry a
        // permanently-unprocessable event, but record nothing.
        console.warn('[telnyx-inbound] unprocessable:', res.reason);
        return reply(200, { ok: true, stored: false, reason: res.reason });
      }
      // COMPLIANCE: state (opt-out/opt-in) is applied inside processInbound. An
      // approved auto-reply (res.compliance.reply) is NOT sent in Phase 2 — wiring
      // an outbound compliance reply is deferred to production enablement (post
      // 10DLC). We only acknowledge here.

      // Mirror the reply onto the lead: record what they said and advance the
      // stage to 'contacted'. Skipped for a duplicate delivery (Telnyx retry) so
      // a redelivered message can't restamp last_inbound_at. Best-effort by
      // design — recordInboundOnLead never throws, because failing here would
      // return a non-2xx and make Telnyx retry the whole message.
      if (!res.deduped) {
        const p = (parsed && parsed.data && parsed.data.payload) || {};
        const from = p.from && p.from.phone_number;
        const text = p.text != null ? p.text : '';
        await recordInboundOnLead(from, text);

        // Answer a reschedule or cancellation request. A lead asking "can we do
        // 3:30?" previously got silence — the message was stored and shown in the
        // CRM, but nothing replied, so a direct question sat unanswered.
        //
        // This sends the booking link rather than moving the appointment: only
        // the form knows real availability, and a misparsed time means someone
        // arrives at an empty building.
        try {
          const intent = detectIntent(text);
          if (intent) await replyToIntent(from, text, intent);
        } catch (e) {
          console.warn('[telnyx-inbound] intent reply failed:', e.message);
        }

        // Push a notification to every registered device. This is what makes an
        // alert useful — it arrives whether or not the CRM is open.
        try { await pushInboundAlert(from, text); }
        catch (e) { console.warn('[telnyx-inbound] push failed:', e.message); }
      }

      return reply(200, { ok: true, stored: !res.deduped, deduped: Boolean(res.deduped),
        compliance: res.compliance ? res.compliance.action : null });
    } catch (e) {
      return reply(500, { ok: false, error: { code: 'internal_error' } });
    }
  };
}

/**
 * Reply to a detected intent with the lead's own reschedule link.
 *
 * Best-effort: the webhook's job is to acknowledge Telnyx, so a failure here
 * must never produce a non-2xx (which would make Telnyx retry the message).
 */
async function replyToIntent(phone, text, intent) {
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_KEY) return;

  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!digits) return;

  // Their most recent upcoming booking supplies the short code, so the link
  // opens on the right appointment.
  let booking = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?phone=ilike.*${digits}*&select=full_name,short_code,client,starts_at&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) booking = rows[0];
  } catch (e) {
    console.warn('[telnyx-inbound] booking lookup failed:', e.message);
  }

  const first = String((booking && booking.full_name) || '').trim().split(/\s+/)[0] || '';
  const isIron65 = /iron\s*-?\s*65/i.test(String((booking && booking.client) || ''));
  const body = intentReply(intent, first, booking && booking.short_code, isIron65);
  if (!body) return;

  // cooldownHours guards against a back-and-forth turning into repeated links.
  const res = await sendSMS(phone, body, { optOut: true, cooldownHours: 1, createdBy: 'intent:' + intent });
  console.log(`[telnyx-inbound] intent=${intent} replied=${res && res.success}`);
}

/**
 * Notify every registered device that a lead has texted.
 *
 * Best-effort throughout: this runs inside the Telnyx webhook, and a push
 * failure must never produce a non-2xx (Telnyx would retry the message).
 */
async function pushInboundAlert(phone, text) {
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  const H = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  // Name the sender when we know them — "New message from Flavia" beats a number.
  let who = phone;
  try {
    const d = String(phone || '').replace(/\D/g, '').slice(-10);
    if (d) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${d}*&select=name&limit=1`, { headers: H });
      const rows = await r.json();
      if (Array.isArray(rows) && rows[0] && rows[0].name) who = rows[0].name;
    }
  } catch (e) { /* fall back to the number */ }

  const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth&failures=lt.5`, { headers: H });
  const subs = await subsRes.json();
  if (!Array.isArray(subs) || !subs.length) return;

  const payload = {
    title: `New message from ${who}`,
    body: String(text || '').slice(0, 140),
    tag: 'rosalia-' + String(phone || '').slice(-10),
    url: '/crm?phone=' + encodeURIComponent(String(phone || '').replace(/\D/g, '').slice(-10)),
  };

  for (const sub of subs) {
    const res = await sendPush(sub, payload);
    if (res.gone) {
      // The browser dropped this subscription — remove it rather than retrying
      // forever.
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${sub.id}`, { method: 'DELETE', headers: H });
    } else if (!res.ok) {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${sub.id}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ failures: 1 }),
      });
    }
  }
  console.log(`[telnyx-inbound] pushed to ${subs.length} device(s)`);
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
