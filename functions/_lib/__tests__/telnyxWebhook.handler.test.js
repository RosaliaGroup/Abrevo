'use strict';
/**
 * Handler-level tests for the public Telnyx webhooks (telnyx-inbound.js,
 * telnyx-status.js) and the protected diagnostic (telnyx-health.js).
 *
 * Webhooks authenticate via the REAL Ed25519 signature gate (a per-test keypair
 * is generated and set as TELNYX_PUBLIC_KEY); the persistence layer is stubbed
 * via an injected context factory. No Rosalia session is required for a validly
 * signed webhook. telnyx-health requires an operator session. No real network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const auth = require('../../lib/auth');
const { makeHandler: inbound } = require('../../telnyx-inbound');
const { makeHandler: status } = require('../../telnyx-status');
const { makeHandler: health } = require('../../telnyx-health');

// --- Ed25519 helpers (Telnyx exposes the raw 32 public-key bytes, base64) ---
function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return { publicKeyB64: Buffer.from(der.subarray(der.length - 32)).toString('base64'), privateKey };
}
function sign(privateKey, ts, payload) {
  return crypto.sign(null, Buffer.from(`${ts}|${payload}`, 'utf8'), privateKey).toString('base64');
}
function nowTs() { return String(Math.floor(Date.now() / 1000)); }

function inboundCtx() {
  const state = { built: 0, processed: 0 };
  const makeContext = () => { state.built++; return { webhook: { processInbound: async () => { state.processed++; return { ok: true, deduped: false, compliance: null }; } } }; };
  return { state, makeContext };
}
function statusCtx() {
  const state = { built: 0, processed: 0 };
  const makeContext = () => { state.built++; return { webhook: { processDeliveryStatus: async () => { state.processed++; return { ok: true, matched: true, status: 'delivered' }; } } }; };
  return { state, makeContext };
}
const INBOUND_BODY = JSON.stringify({ data: { event_type: 'message.received', payload: { from: { phone_number: '+15551230000' }, text: 'hi', id: 'prov-1' } } });
const STATUS_BODY = JSON.stringify({ data: { event_type: 'message.finalized', payload: { id: 'prov-1', to: [{ status: 'delivered' }] } } });

// B1 + B8: correctly signed inbound accepted, NO session/cookie present.
test('B1/B8 correctly signed inbound accepted (no session required)', async () => {
  const kp = keypair(); process.env.TELNYX_PUBLIC_KEY = kp.publicKeyB64;
  const ts = nowTs(); const sig = sign(kp.privateKey, ts, INBOUND_BODY);
  const c = inboundCtx();
  const res = await inbound({ makeContext: c.makeContext })({ httpMethod: 'POST', headers: { 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': ts }, body: INBOUND_BODY });
  assert.equal(res.statusCode, 200);
  assert.equal(c.state.processed, 1);
});

// B2: wrong signature rejected, nothing processed.
test('B2 incorrect signature -> 401, no processing', async () => {
  const kp = keypair(); process.env.TELNYX_PUBLIC_KEY = kp.publicKeyB64;
  const ts = nowTs();
  const c = inboundCtx();
  const res = await inbound({ makeContext: c.makeContext })({ httpMethod: 'POST', headers: { 'telnyx-signature-ed25519': 'AAAA', 'telnyx-timestamp': ts }, body: INBOUND_BODY });
  assert.equal(res.statusCode, 401);
  assert.equal(c.state.built, 0);
});

// B3: missing signature rejected.
test('B3 missing signature -> 401', async () => {
  const kp = keypair(); process.env.TELNYX_PUBLIC_KEY = kp.publicKeyB64;
  const c = inboundCtx();
  const res = await inbound({ makeContext: c.makeContext })({ httpMethod: 'POST', headers: { 'telnyx-timestamp': nowTs() }, body: INBOUND_BODY });
  assert.equal(res.statusCode, 401);
  assert.equal(c.state.built, 0);
});

// B4: stale timestamp rejected even with an otherwise valid signature.
test('B4 stale timestamp -> 401 (replay guard)', async () => {
  const kp = keypair(); process.env.TELNYX_PUBLIC_KEY = kp.publicKeyB64;
  const staleTs = '1000000000'; // year 2001, far outside the 300s tolerance
  const sig = sign(kp.privateKey, staleTs, INBOUND_BODY);
  const c = inboundCtx();
  const res = await inbound({ makeContext: c.makeContext })({ httpMethod: 'POST', headers: { 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': staleTs }, body: INBOUND_BODY });
  assert.equal(res.statusCode, 401);
  assert.equal(c.state.built, 0);
});

// B5: a duplicate (deduped) event is acknowledged 200 without error.
test('B5 duplicate inbound acknowledged without error', async () => {
  const kp = keypair(); process.env.TELNYX_PUBLIC_KEY = kp.publicKeyB64;
  const ts = nowTs(); const sig = sign(kp.privateKey, ts, INBOUND_BODY);
  const makeContext = () => ({ webhook: { processInbound: async () => ({ ok: true, deduped: true, compliance: null }) } });
  const res = await inbound({ makeContext })({ httpMethod: 'POST', headers: { 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': ts }, body: INBOUND_BODY });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"deduped":true/);
});

// Method + size guards on the webhook.
test('inbound rejects non-POST (405) and oversized body (413)', async () => {
  const kp = keypair(); process.env.TELNYX_PUBLIC_KEY = kp.publicKeyB64;
  const g = await inbound({ makeContext: () => ({}) })({ httpMethod: 'GET', headers: {}, body: '' });
  assert.equal(g.statusCode, 405);
  const big = await inbound({ makeContext: () => ({}) })({ httpMethod: 'POST', headers: {}, body: 'x'.repeat(256 * 1024 + 1) });
  assert.equal(big.statusCode, 413);
});

// B6: correctly signed status accepted (no session).
test('B6 correctly signed delivery-status accepted', async () => {
  const kp = keypair(); process.env.TELNYX_PUBLIC_KEY = kp.publicKeyB64;
  const ts = nowTs(); const sig = sign(kp.privateKey, ts, STATUS_BODY);
  const c = statusCtx();
  const res = await status({ makeContext: c.makeContext })({ httpMethod: 'POST', headers: { 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': ts }, body: STATUS_BODY });
  assert.equal(res.statusCode, 200);
  assert.equal(c.state.processed, 1);
});

// B7: bad status signature rejected.
test('B7 bad delivery-status signature -> 401', async () => {
  const kp = keypair(); process.env.TELNYX_PUBLIC_KEY = kp.publicKeyB64;
  const c = statusCtx();
  const res = await status({ makeContext: c.makeContext })({ httpMethod: 'POST', headers: { 'telnyx-signature-ed25519': 'AAAA', 'telnyx-timestamp': nowTs() }, body: STATUS_BODY });
  assert.equal(res.statusCode, 401);
  assert.equal(c.state.built, 0);
});

// --- Health (C) ---
const HSECRET = 'test-operator-secret';
function hSession() { return auth.signSession('operator', HSECRET); }
const okClient = () => ({ configCheck: () => ({ ok: true, provider: 'telnyx', apiKeyPresent: true, fromNumberPresent: true, fromNumberValid: true }) });

// C2: unauthenticated diagnostic reveals NO configuration details.
test('C2 telnyx-health unauthenticated -> 401 with no config disclosure', async () => {
  process.env.OPERATOR_SESSION_SECRET = HSECRET;
  const res = await health({ makeClient: okClient })({ httpMethod: 'GET', headers: {} });
  assert.equal(res.statusCode, 401);
  assert.doesNotMatch(res.body, /apiKeyPresent|fromNumber|provider|TELNYX/);
});

// C1/authed: operator session reaches the diagnostic.
test('C1 telnyx-health with valid session returns config booleans', async () => {
  process.env.OPERATOR_SESSION_SECRET = HSECRET;
  const res = await health({ makeClient: okClient })({ httpMethod: 'GET', headers: { cookie: `__session=${hSession()}` } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"apiKeyPresent":true/);
});

test('telnyx-health rejects non-GET (405)', async () => {
  process.env.OPERATOR_SESSION_SECRET = HSECRET;
  const res = await health({ makeClient: okClient })({ httpMethod: 'POST', headers: { cookie: `__session=${hSession()}` } });
  assert.equal(res.statusCode, 405);
});
