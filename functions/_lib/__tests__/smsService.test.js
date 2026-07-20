'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRepo } = require('./fakeRepo');
const { createConversationService } = require('../conversations');
const { createSmsService } = require('../smsService');

// A mock Telnyx client (never touches the network). Records sends.
function mockTelnyx({ succeed = true, providerMessageId = 'pmid_1', errorCode = 'boom' } = {}) {
  const sends = [];
  return {
    sends,
    async sendSms({ to, text }) {
      sends.push({ to, text });
      return succeed
        ? { success: true, status: 'sent', providerMessageId }
        : { success: false, status: 'provider_error', providerMessageId: null, errorCode, errorMessage: 'nope' };
    },
  };
}

function wire(telnyx) {
  const repo = createFakeRepo();
  const conversationService = createConversationService({ repo });
  const svc = createSmsService({ conversationService, repo, telnyx, clock: () => 'T' });
  return { repo, svc };
}

test('successful send persists a sent message and bumps last_message_at', async () => {
  const telnyx = mockTelnyx({ succeed: true, providerMessageId: 'pmid_ok' });
  const { repo, svc } = wire(telnyx);
  const r = await svc.sendMessage({ phone: '5551234567', body: 'hi', links: [{ type: 'lead', id: 5 }] });
  assert.equal(r.ok, true);
  assert.equal(telnyx.sends.length, 1);
  assert.equal(telnyx.sends[0].to, '+15551234567');
  assert.equal(r.message.status, 'sent');
  assert.equal(r.message.provider_message_id, 'pmid_ok');
  assert.equal(repo._state.conversations.get('c1').last_message_at, 'T');
  assert.equal(repo._state.links.length, 1); // linkage flowed through
});

test('opt-out blocks the send and persists a blocked message', async () => {
  const telnyx = mockTelnyx({ succeed: true });
  const { repo, svc } = wire(telnyx);
  // create conversation, then opt it out
  const conv = await repo.insertConversation({ normalized_phone: '+15551234567' });
  await repo.touchConversation(conv.id, { opted_out_at: 'T' });
  const r = await svc.sendMessage({ conversationId: conv.id, body: 'promo' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'opted_out');
  assert.equal(telnyx.sends.length, 0);              // never sent
  assert.equal(r.message.status, 'blocked');          // audited
});

test('idempotency: same key does not send twice', async () => {
  const telnyx = mockTelnyx({ succeed: true, providerMessageId: 'pmid_x' });
  const { repo, svc } = wire(telnyx);
  const a = await svc.sendMessage({ phone: '5551234567', body: 'once', idempotencyKey: 'k-1' });
  const b = await svc.sendMessage({ phone: '5551234567', body: 'once', idempotencyKey: 'k-1' });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.deduped, true);
  assert.equal(telnyx.sends.length, 1);               // exactly one real send
  assert.equal(repo._state.messages.length, 1);
});

test('concurrent same-key sends collapse to one message (race-safe)', async () => {
  const telnyx = mockTelnyx({ succeed: true });
  const { repo, svc } = wire(telnyx);
  const [a, b] = await Promise.all([
    svc.sendMessage({ phone: '5551234567', body: 'x', idempotencyKey: 'k-2' }),
    svc.sendMessage({ phone: '5551234567', body: 'x', idempotencyKey: 'k-2' }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(repo._state.messages.length, 1);
  assert.equal(telnyx.sends.length, 1);
});

test('provider failure is persisted as failed (message row survives)', async () => {
  const telnyx = mockTelnyx({ succeed: false, errorCode: '10015' });
  const { repo, svc } = wire(telnyx);
  const r = await svc.sendMessage({ phone: '5551234567', body: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.message.status, 'failed');
  assert.equal(r.message.error_code, '10015');
  assert.equal(repo._state.messages.length, 1);
});

test('invalid phone sends nothing and creates nothing', async () => {
  const telnyx = mockTelnyx({ succeed: true });
  const { repo, svc } = wire(telnyx);
  const r = await svc.sendMessage({ phone: '12345', body: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid_phone');
  assert.equal(telnyx.sends.length, 0);
  assert.equal(repo._state.conversations.size, 0);
  assert.equal(repo._state.messages.length, 0);
});

test('empty body is rejected before any work', async () => {
  const telnyx = mockTelnyx({ succeed: true });
  const { svc } = wire(telnyx);
  const r = await svc.sendMessage({ phone: '5551234567', body: '' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty_body');
  assert.equal(telnyx.sends.length, 0);
});
