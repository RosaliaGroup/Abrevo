'use strict';
/**
 * Phase 1 (read-only) lead communications timeline: commApi.getLeadThread.
 * Proves lead→conversation resolution by existing entity link, deterministic
 * chronological ordering, inbound/outbound distinguishability, safe status
 * pass-through, empty state, strict lead isolation, and that NO send path is
 * reached (the injected smsService throws if called).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRepo } = require('./fakeRepo');
const { createConversationService } = require('../conversations');
const { createCommApi } = require('../commApi');

// smsService whose every method throws — getLeadThread must never touch it.
const noSendService = new Proxy({}, { get() { return () => { throw new Error('send path must not be called'); }; } });

function wire() {
  const repo = createFakeRepo();
  const conversationService = createConversationService({ repo });
  const api = createCommApi({ repo, conversationService, smsService: noSendService });
  return { repo, api };
}

// Seed a conversation with messages and link it to a lead. Returns conversation id.
async function seed(repo, { phone, leadId, messages }) {
  const conv = await repo.insertConversation({ normalized_phone: phone });
  if (leadId != null) await repo.insertLinkIfAbsent({ conversation_id: conv.id, entity_type: 'lead', entity_id: leadId });
  for (const m of messages || []) {
    await repo.insertMessage({
      conversation_id: conv.id, direction: m.direction, body: m.body,
      status: m.status, provider: 'telnyx', provider_message_id: m.pmid || null,
      created_at: m.created_at,
    });
  }
  return conv.id;
}

test('correct lead resolves the correct conversation', async () => {
  const { repo, api } = wire();
  const cid = await seed(repo, { phone: '+15551110001', leadId: '42', messages: [
    { direction: 'inbound', body: 'hi', status: 'received', created_at: '2026-07-29T10:00:00Z' },
  ] });
  const r = await api.getLeadThread({ leadId: '42' });
  assert.equal(r.ok, true);
  assert.equal(r.linked, true);
  assert.equal(r.conversations.length, 1);
  assert.equal(r.conversations[0].id, cid);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].body, 'hi');
});

test('messages render in deterministic chronological order', async () => {
  const { repo, api } = wire();
  await seed(repo, { phone: '+15551110002', leadId: '7', messages: [
    { direction: 'outbound', body: 'third',  status: 'delivered', created_at: '2026-07-29T12:00:00Z' },
    { direction: 'inbound',  body: 'first',  status: 'received',  created_at: '2026-07-29T10:00:00Z' },
    { direction: 'outbound', body: 'second', status: 'sent',      created_at: '2026-07-29T11:00:00Z' },
  ] });
  const r = await api.getLeadThread({ leadId: '7' });
  assert.deepEqual(r.messages.map((m) => m.body), ['first', 'second', 'third']);
});

test('inbound and outbound messages are distinguishable', async () => {
  const { repo, api } = wire();
  await seed(repo, { phone: '+15551110003', leadId: '9', messages: [
    { direction: 'inbound',  body: 'from lead', status: 'received', created_at: '2026-07-29T10:00:00Z' },
    { direction: 'outbound', body: 'to lead',   status: 'sent',     created_at: '2026-07-29T10:01:00Z' },
  ] });
  const r = await api.getLeadThread({ leadId: '9' });
  assert.deepEqual(r.messages.map((m) => m.direction), ['inbound', 'outbound']);
});

test('status values pass through safely (incl. unexpected values)', async () => {
  const { repo, api } = wire();
  await seed(repo, { phone: '+15551110004', leadId: '11', messages: [
    { direction: 'outbound', body: 'a', status: 'failed',    created_at: '2026-07-29T10:00:00Z' },
    { direction: 'outbound', body: 'b', status: 'delivered', created_at: '2026-07-29T10:01:00Z' },
  ] });
  const r = await api.getLeadThread({ leadId: '11' });
  assert.deepEqual(r.messages.map((m) => m.status), ['failed', 'delivered']);
});

test('no conversation for a lead produces an empty state', async () => {
  const { api } = wire();
  const r = await api.getLeadThread({ leadId: '999' });
  assert.equal(r.ok, true);
  assert.equal(r.linked, false);
  assert.deepEqual(r.conversations, []);
  assert.deepEqual(r.messages, []);
});

test("another lead's messages cannot appear", async () => {
  const { repo, api } = wire();
  await seed(repo, { phone: '+15551110005', leadId: 'A', messages: [
    { direction: 'inbound', body: 'lead A only', status: 'received', created_at: '2026-07-29T10:00:00Z' },
  ] });
  await seed(repo, { phone: '+15551110006', leadId: 'B', messages: [
    { direction: 'inbound', body: 'lead B only', status: 'received', created_at: '2026-07-29T10:00:00Z' },
  ] });
  const rA = await api.getLeadThread({ leadId: 'A' });
  assert.deepEqual(rA.messages.map((m) => m.body), ['lead A only']);
  const rB = await api.getLeadThread({ leadId: 'B' });
  assert.deepEqual(rB.messages.map((m) => m.body), ['lead B only']);
});

test('missing leadId returns a 400-style error, no throw', async () => {
  const { api } = wire();
  const r = await api.getLeadThread({});
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'missing_entity_id');
});

test('read path never invokes the send/sms service', async () => {
  const { repo, api } = wire(); // smsService throws on any access
  await seed(repo, { phone: '+15551110007', leadId: '77', messages: [
    { direction: 'outbound', body: 'x', status: 'sent', created_at: '2026-07-29T10:00:00Z' },
  ] });
  // If getLeadThread touched smsService, this would throw.
  const r = await api.getLeadThread({ leadId: '77' });
  assert.equal(r.ok, true);
  assert.equal(r.messages.length, 1);
});
