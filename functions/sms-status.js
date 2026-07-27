// functions/sms-status.js
// Telnyx delivery-receipt webhook. lib/sms.js attaches webhook_url when
// TELNYX_STATUS_WEBHOOK is set; this is the receiving end. Upserts the latest
// delivery status per message into sms_log (keyed on telnyx_id).
//
// ALWAYS returns 200 (except on a bad signature) — a non-200 makes Telnyx retry.

const crypto = require('crypto');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TELNYX_PUBLIC_KEY = process.env.TELNYX_PUBLIC_KEY;
const MAX_TIMESTAMP_AGE_SEC = 300; // reject signed requests older than 5 min (replay guard)

// Verify a Telnyx Ed25519 webhook signature over `${timestamp}|${rawBody}`.
// Telnyx gives the public key as base64-encoded raw 32 bytes; wrap it in a DER
// SPKI header so Node's crypto can build the key object.
function verifyTelnyxSignature(publicKeyB64, signatureB64, timestamp, rawBody) {
  try {
    const raw = Buffer.from(publicKeyB64, 'base64');
    if (raw.length !== 32) return false;
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    const keyObj = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    const message = Buffer.from(`${timestamp}|${rawBody}`);
    const signature = Buffer.from(signatureB64, 'base64');
    return crypto.verify(null, message, keyObj, signature);
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  const ok = { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: 'ok' };

  const h = event.headers || {};
  const sig = h['telnyx-signature-ed25519'] || h['Telnyx-Signature-Ed25519'];
  const ts = h['telnyx-timestamp'] || h['Telnyx-Timestamp'];
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  // Signature check: enforce only when the public key is configured. When enforced,
  // a MISSING signature/timestamp is rejected just like an invalid one — an unsigned
  // POST must never be accepted. A validly-signed but stale request is a replay.
  if (TELNYX_PUBLIC_KEY) {
    let reason = null;
    if (!sig || !ts) {
      reason = 'missing signature headers';
    } else if (!verifyTelnyxSignature(TELNYX_PUBLIC_KEY, sig, ts, rawBody)) {
      reason = 'invalid signature';
    } else {
      const tsNum = parseInt(ts, 10);
      const ageSec = Math.floor(Date.now() / 1000) - tsNum;
      if (!Number.isFinite(tsNum) || ageSec > MAX_TIMESTAMP_AGE_SEC) {
        reason = 'stale timestamp';
      }
    }
    if (reason) {
      console.log('SMS status rejected:', reason);
      return { statusCode: 403, headers: { 'Content-Type': 'text/plain' }, body: 'forbidden' };
    }
  } else {
    console.warn('SMS status: TELNYX_PUBLIC_KEY unset — accepting webhook unverified');
  }

  // Parse. Any parse failure still returns 200 so Telnyx does not retry.
  let id, phone, status, errorCode;
  try {
    const payload = (JSON.parse(rawBody || '{}').data || {}).payload || {};
    id = payload.id;
    const to0 = Array.isArray(payload.to) ? payload.to[0] : null;
    phone = to0 && to0.phone_number;
    status = to0 && to0.status;
    errorCode = payload.errors && payload.errors[0] && payload.errors[0].code;
  } catch (e) {
    console.error('SMS status: unparseable payload:', e.message);
    return ok;
  }

  if (!id) {
    console.log('SMS status: no message id in payload — ignoring');
    return ok;
  }

  console.log('SMS status:', id, status, errorCode || '');

  // Upsert latest status per message on telnyx_id.
  try {
    if (SUPABASE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/sms_log?on_conflict=telnyx_id`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          telnyx_id: id,
          to_number: phone || null,
          status: status || null,
          error_code: errorCode || null,
          updated_at: new Date().toISOString(),
        }),
      });
    }
  } catch (e) {
    console.error('SMS status: sms_log upsert failed:', e.message);
  }

  return ok;
};
