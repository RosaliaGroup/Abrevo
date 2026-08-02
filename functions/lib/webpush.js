// functions/lib/webpush.js
//
// Send a Web Push notification. Implements RFC 8291 (payload encryption) and
// RFC 8292 (VAPID) directly with node:crypto, rather than adding the `web-push`
// package — the repo has four dependencies and no lockfile, so a new one is a
// meaningful change to the deploy surface for something that is ~120 lines.
//
// Env:
//   VAPID_PUBLIC_KEY   base64url, uncompressed P-256 point (65 bytes)
//   VAPID_PRIVATE_KEY  base64 PKCS8
//   VAPID_SUBJECT      mailto: or https: identifying the sender

const crypto = require('crypto');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:inquiries@rosaliagroup.com';

const b64u = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** ECDH shared secret between our ephemeral key and the browser's public key. */
function sharedSecret(privateKeyObj, clientPublicRaw) {
  const spki = Buffer.concat([
    Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
    clientPublicRaw,
  ]);
  const clientKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  return crypto.diffieHellman({ privateKey: privateKeyObj, publicKey: clientKey });
}

function hkdf(salt, ikm, info, length) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

/** RFC 8291 aes128gcm encryption of the payload. */
function encrypt(payload, clientPublicRaw, authSecret) {
  const salt = crypto.randomBytes(16);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const asPublicRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);

  const ecdh = sharedSecret(privateKey, clientPublicRaw);

  const authInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), clientPublicRaw, asPublicRaw,
  ]);
  const ikm = hkdf(authSecret, ecdh, authInfo, 32);

  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // The record must be padded with a 0x02 delimiter before the GCM tag.
  const body = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])]);
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(65, 20);

  return Buffer.concat([header, asPublicRaw, ciphertext]);
}

/** VAPID JWT proving we own the public key the browser was subscribed with. */
function vapidHeaders(endpoint) {
  const url = new URL(endpoint);
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({
    aud: `${url.protocol}//${url.host}`,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: SUBJECT,
  }));
  const unsigned = `${header}.${claims}`;

  const key = crypto.createPrivateKey({
    key: Buffer.from(PRIVATE_KEY, 'base64'), format: 'der', type: 'pkcs8',
  });
  // Node emits DER; JWS wants the raw r||s pair.
  const der = crypto.sign('sha256', Buffer.from(unsigned), key);
  const sig = derToJose(der);

  return {
    Authorization: `vapid t=${unsigned}.${b64u(sig)}, k=${PUBLIC_KEY}`,
    'Content-Encoding': 'aes128gcm',
    TTL: '86400',
    Urgency: 'high',
  };
}

function derToJose(der) {
  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f;
  const rLen = der[offset + 1];
  let r = der.subarray(offset + 2, offset + 2 + rLen);
  const sStart = offset + 2 + rLen;
  const sLen = der[sStart + 1];
  let s = der.subarray(sStart + 2, sStart + 2 + sLen);
  const pad = (b) => (b.length > 32 ? b.subarray(b.length - 32)
    : Buffer.concat([Buffer.alloc(32 - b.length), b]));
  return Buffer.concat([pad(r), pad(s)]);
}

/**
 * @returns {Promise<{ok:boolean, status?:number, gone?:boolean}>}
 *   gone=true means the subscription is dead and should be deleted.
 */
async function sendPush(subscription, payloadObj) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return { ok: false, reason: 'vapid_not_configured' };
  try {
    const clientPublic = fromB64u(subscription.p256dh);
    const authSecret = fromB64u(subscription.auth);
    const body = encrypt(JSON.stringify(payloadObj), clientPublic, authSecret);

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: Object.assign(vapidHeaders(subscription.endpoint), {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
      }),
      body,
    });
    // 404/410 mean the browser dropped the subscription — prune it.
    if (res.status === 404 || res.status === 410) return { ok: false, status: res.status, gone: true };
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.warn(`[webpush] ${res.status}: ${t.slice(0, 120)}`);
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.warn('[webpush] send failed:', err.message);
    return { ok: false, reason: 'error' };
  }
}

module.exports = { sendPush };
