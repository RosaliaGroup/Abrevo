'use strict';
/**
 * Telnyx delivery-status webhook. Verifies Ed25519 signature over the RAW body,
 * finds the outbound message by provider message id, and updates its status
 * idempotently. Unmatched events are logged, never turned into fake messages.
 */

const { verifyTelnyxSignature } = require('./_lib/telnyxSignature');
const { createCommContext } = require('./_lib/commContext');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
function reply(statusCode, obj) { return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) }; }
function header(event, name) {
  const h = event.headers || {};
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || null;
}

const DELIVERY_EVENTS = new Set(['message.sent', 'message.finalized', 'message.delivery_failed']);

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

  const et = parsed && parsed.data && parsed.data.event_type;
  if (!DELIVERY_EVENTS.has(et)) return reply(200, { ok: true, ignored: true, event_type: et || null });

  let ctx;
  try { ctx = createCommContext(); } catch (e) { return reply(500, { ok: false, error: { code: 'server_misconfigured' } }); }

  try {
    const res = await ctx.webhook.processDeliveryStatus(parsed);
    if (res.ok && res.matched === false) {
      console.warn('[telnyx-status] unmatched provider message id — ignored');
      return reply(200, { ok: true, matched: false });
    }
    return reply(200, res);
  } catch (e) {
    return reply(500, { ok: false, error: { code: 'internal_error' } });
  }
};
