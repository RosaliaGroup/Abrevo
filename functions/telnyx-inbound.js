'use strict';
/**
 * Telnyx inbound-message webhook. Verifies Ed25519 signature over the RAW body,
 * then persists the inbound message once and applies STOP/START/HELP. Never
 * sends a live SMS here (compliance auto-reply is intentionally not wired in
 * Phase 2 — see COMPLIANCE below).
 */

const { verifyTelnyxSignature } = require('./_lib/telnyxSignature');
const { createCommContext } = require('./_lib/commContext');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
function reply(statusCode, obj) { return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) }; }

function header(event, name) {
  const h = event.headers || {};
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || null;
}

exports.handler = async (event) => {
  const raw = event.body || '';
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
  try { ctx = createCommContext(); } catch (e) { return reply(500, { ok: false, error: { code: 'server_misconfigured' } }); }

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
    return reply(200, { ok: true, stored: !res.deduped, deduped: Boolean(res.deduped),
      compliance: res.compliance ? res.compliance.action : null });
  } catch (e) {
    return reply(500, { ok: false, error: { code: 'internal_error' } });
  }
};
