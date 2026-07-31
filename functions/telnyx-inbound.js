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
      }

      return reply(200, { ok: true, stored: !res.deduped, deduped: Boolean(res.deduped),
        compliance: res.compliance ? res.compliance.action : null });
    } catch (e) {
      return reply(500, { ok: false, error: { code: 'internal_error' } });
    }
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
