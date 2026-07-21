'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRepo } = require('./fakeRepo');
const { createConversationService } = require('../conversations');
const { createSmsService } = require('../smsService');
const { createSmsWebhookProcessor } = require('../smsWebhook');

function wire() {
  const repo = createFakeRepo();
  const conversationService = createConversationService({ repo });
  const proc = createSmsWebhookProcessor({ repo, conversationService, clock: () => 'T' });
  const telnyx = { sends: [], async sendSms({ to, text }) { this.sends.push({ to, text }); return { success: true, providerMessageId: 'pmid_' + this.sends.length }; } };
  const smsService = createSmsService({ conversationService, repo, telnyx, clock: () => 'T' });
  return { repo, proc, smsService, telnyx };
}

function inbound(id, from, text) {
  return { data: { event_type: 'message.received', id: 'evt_' + id, payload: { id, from: { phone_number: from }, to: [{ phone_number: '+15550000000' }], text } } };
}

test('inbound message is persisted exactly once (idempotent on provider id)', async () => {
  const { repo, proc } = wire();
  const ev = inbound('in_1', '5551234567', 'Hello there');
  const a = await proc.processInbound(ev);
  const b = await proc.processInbound(ev); // duplicate delivery
  assert.equal(a.ok, true); assert.equal(a.deduped, false);
  assert.equal(b.ok, true); assert.equal(b.deduped, true);
  assert.equal(repo._state.messages.filter((m) => m.direction === 'inbound').length, 1);
  assert.equal(repo._state.conversations.size, 1);
});

test('inbound updates conversation recency + preview', async () => {
  const { repo, proc } = wire();
  await proc.processInbound(inbound('in_2', '5551234567', 'Need a quote'));
  const conv = [...repo._state.conversations.values()][0];
  assert.equal(conv.last_message_at, 'T');
  assert.equal(conv.last_message_direction, 'inbound');
  assert.match(conv.last_message_preview, /Need a quote/);
});

test('STOP sets opt-out BEFORE any later send is allowed', async () => {
  const { proc, smsService, telnyx } = wire();
  const r = await proc.processInbound(inbound('in_stop', '5551234567', 'STOP'));
  assert.equal(r.compliance.action, 'stop');
  const send = await smsService.sendMessage({ phone: '5551234567', body: 'promo' });
  assert.equal(send.ok, false);
  assert.equal(send.reason, 'opted_out');
  assert.equal(telnyx.sends.length, 0); // never sent
});

test('START clears opt-out; HELP changes no state', async () => {
  const { repo, proc, smsService } = wire();
  await proc.processInbound(inbound('s1', '5551234567', 'STOP'));
  const help = await proc.processInbound(inbound('h1', '5551234567', 'HELP'));
  assert.equal(help.compliance.action, 'help');
  let conv = [...repo._state.conversations.values()][0];
  assert.ok(conv.opted_out_at); // still opted out after HELP
  await proc.processInbound(inbound('st1', '5551234567', 'START'));
  conv = [...repo._state.conversations.values()][0];
  assert.equal(conv.opted_out_at, null);
  const send = await smsService.sendMessage({ phone: '5551234567', body: 'welcome back' });
  assert.equal(send.ok, true);
});

test('inbound with invalid sender stores nothing', async () => {
  const { repo, proc } = wire();
  const r = await proc.processInbound(inbound('bad', '12345', 'hi'));
  assert.equal(r.ok, false);
  assert.equal(repo._state.messages.length, 0);
  assert.equal(repo._state.conversations.size, 0);
});

// ---- delivery status ----
async function seedOutbound(smsService) {
  const r = await smsService.sendMessage({ phone: '5551234567', body: 'hello' });
  return r.message.provider_message_id;
}
function delivery(pmid, event_type, toStatus) {
  return { data: { event_type, id: 'devt', payload: { id: pmid, to: [{ status: toStatus }] } } };
}

test('delivery status updates the matched outbound message', async () => {
  const { proc, smsService } = wire();
  const pmid = await seedOutbound(smsService);
  const r = await proc.processDeliveryStatus(delivery(pmid, 'message.finalized', 'delivered'));
  assert.equal(r.matched, true);
  assert.equal(r.updated, true);
  assert.equal(r.status, 'delivered');
  assert.equal(r.message.delivered_at, 'T');
});

test('duplicate delivery event is idempotent (no-op)', async () => {
  const { proc, smsService } = wire();
  const pmid = await seedOutbound(smsService);
  await proc.processDeliveryStatus(delivery(pmid, 'message.finalized', 'delivered'));
  const dup = await proc.processDeliveryStatus(delivery(pmid, 'message.finalized', 'delivered'));
  assert.equal(dup.updated, false);
  assert.equal(dup.deduped, true);
});

test('out-of-order event does not downgrade a terminal status', async () => {
  const { proc, smsService } = wire();
  const pmid = await seedOutbound(smsService);
  await proc.processDeliveryStatus(delivery(pmid, 'message.finalized', 'delivered'));
  const late = await proc.processDeliveryStatus(delivery(pmid, 'message.sent', 'sent'));
  assert.equal(late.updated, false);
  assert.equal(late.status, 'delivered');
});

test('failed delivery records error details', async () => {
  const { proc, smsService } = wire();
  const pmid = await seedOutbound(smsService);
  const ev = { data: { event_type: 'message.delivery_failed', id: 'd', payload: { id: pmid, to: [{ status: 'delivery_failed' }], errors: [{ code: '40010', detail: 'carrier rejected' }] } } };
  const r = await proc.processDeliveryStatus(ev);
  assert.equal(r.status, 'failed');
  assert.equal(r.message.error_code, '40010');
});

test('unmatched delivery event creates no fake message', async () => {
  const { repo, proc } = wire();
  const r = await proc.processDeliveryStatus(delivery('nope_unknown', 'message.finalized', 'delivered'));
  assert.equal(r.ok, true);
  assert.equal(r.matched, false);
  assert.equal(repo._state.messages.length, 0);
});
