'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyTelnyxSignature } = require('../telnyxSignature');

// Build an Ed25519 keypair and expose the public key the way Telnyx does:
// base64 of the raw 32 public-key bytes.
function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' }); // 12-byte prefix + 32 raw
  const rawB64 = Buffer.from(der.subarray(der.length - 32)).toString('base64');
  return { publicKeyB64: rawB64, privateKey };
}
function sign(privateKey, timestamp, payload) {
  return crypto.sign(null, Buffer.from(`${timestamp}|${payload}`, 'utf8'), privateKey).toString('base64');
}

test('valid signature verifies', () => {
  const { publicKeyB64, privateKey } = keypair();
  const ts = '1000000000';
  const payload = JSON.stringify({ data: { event_type: 'message.received' } });
  const signature = sign(privateKey, ts, payload);
  const r = verifyTelnyxSignature({ publicKey: publicKeyB64, signature, timestamp: ts, payload, nowSeconds: 1000000000 });
  assert.equal(r.valid, true);
});

test('tampered payload fails', () => {
  const { publicKeyB64, privateKey } = keypair();
  const ts = '1000000000';
  const signature = sign(privateKey, ts, 'original');
  const r = verifyTelnyxSignature({ publicKey: publicKeyB64, signature, timestamp: ts, payload: 'tampered', nowSeconds: 1000000000 });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'signature_mismatch');
});

test('wrong key fails', () => {
  const a = keypair(); const b = keypair();
  const ts = '1000000000';
  const signature = sign(a.privateKey, ts, 'p');
  const r = verifyTelnyxSignature({ publicKey: b.publicKeyB64, signature, timestamp: ts, payload: 'p', nowSeconds: 1000000000 });
  assert.equal(r.valid, false);
});

test('stale timestamp rejected (replay guard)', () => {
  const { publicKeyB64, privateKey } = keypair();
  const ts = '1000000000';
  const signature = sign(privateKey, ts, 'p');
  const r = verifyTelnyxSignature({ publicKey: publicKeyB64, signature, timestamp: ts, payload: 'p', nowSeconds: 1000000000 + 999 });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'timestamp_out_of_tolerance');
});

test('missing inputs rejected explicitly', () => {
  assert.equal(verifyTelnyxSignature({}).valid, false);
  assert.equal(verifyTelnyxSignature({ publicKey: 'x' }).valid, false);
});
