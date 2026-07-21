'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRepo } = require('./fakeRepo');
const { createConversationService } = require('../conversations');
const { createSmsService } = require('../smsService');
const { createCommApi } = require('../commApi');

function wire() {
  const repo = createFakeRepo();
  const conversationService = createConversationService({ repo });
  const telnyx = { sends: [], async sendSms({ to }) { this.sends.push(to); return { success: true, providerMessageId: 'pmid_' + this.sends.length }; } };
  const smsService = createSmsService({ conversationService, repo, telnyx, clock: () => 'T' });
  const api = createCommApi({ repo, conversationService, smsService });
  return { repo, api, telnyx };
}

test('findOrCreate reuses and reports created flag; invalid phone -> 400-style error', async () => {
  const { api } = wire();
  const a = await api.findOrCreateConversation({ phone: '5551234567' });
  assert.equal(a.ok, true); assert.equal(a.created, true);
  const b = await api.findOrCreateConversation({ phone: '+1 (555) 123-4567' });
  assert.equal(b.created, false);
  const bad = await api.findOrCreateConversation({ phone: '123' });
  assert.equal(bad.ok, false); assert.equal(bad.error.code, 'invalid_phone');
});

test('listConversations paginates and signals hasMore, ordered by recency', async () => {
  const { repo, api } = wire();
  for (let i = 1; i <= 3; i++) {
    const c = await repo.insertConversation({ normalized_phone: '+155500000' + (10 + i) });
    await repo.touchConversation(c.id, { last_message_at: '2026-01-0' + i + 'T00:00:00Z' });
  }
  const p1 = await api.listConversations({ limit: 2 });
  assert.equal(p1.ok, true);
  assert.equal(p1.conversations.length, 2);
  assert.equal(p1.hasMore, true);
  // most recent first
  assert.equal(p1.conversations[0].normalized_phone, '+15550000013');
  assert.ok(Array.isArray(p1.conversations[0].links)); // linkage summary present
  const p2 = await api.listConversations({ limit: 2, offset: 2 });
  assert.equal(p2.conversations.length, 1);
  assert.equal(p2.hasMore, false);
});

test('getThread paginates messages in order and returns conversation+links', async () => {
  const { repo, api } = wire();
  const c = await repo.insertConversation({ normalized_phone: '+15551239999' });
  await repo.insertLinkIfAbsent({ conversation_id: c.id, entity_type: 'lead', entity_id: '7' });
  for (let i = 1; i <= 3; i++) {
    await repo.insertMessage({ conversation_id: c.id, direction: 'outbound', body: 'm' + i, status: 'sent', provider: 'telnyx', created_at: 't' + i });
  }
  const r = await api.getThread({ conversationId: c.id, limit: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.messages.length, 2);
  assert.equal(r.hasMore, true);
  assert.deepEqual(r.messages.map((m) => m.body), ['m1', 'm2']); // chronological
  assert.equal(r.conversation.links[0].entity_type, 'lead');
});

test('getThread on unknown conversation -> not found', async () => {
  const { api } = wire();
  const r = await api.getThread({ conversationId: 'nope' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'conversation_not_found');
});

test('send routes through smsService and returns the message', async () => {
  const { api, telnyx } = wire();
  const r = await api.sendMessage({ phone: '5551234567', body: 'hi' });
  assert.equal(r.ok, true);
  assert.equal(r.message.status, 'sent');
  assert.equal(telnyx.sends.length, 1);
});

test('send to opted-out conversation returns opted_out error, no send', async () => {
  const { repo, api, telnyx } = wire();
  const c = await repo.insertConversation({ normalized_phone: '+15551234567' });
  await repo.setOptOut(c.id, 'T');
  const r = await api.sendMessage({ conversationId: c.id, body: 'promo' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'opted_out');
  assert.equal(telnyx.sends.length, 0);
});

test('addLink validates type and id; idempotent', async () => {
  const { repo, api } = wire();
  const c = await repo.insertConversation({ normalized_phone: '+15551234567' });
  assert.equal((await api.addLink({ conversationId: c.id, type: 'owner', id: 1 })).error.code, 'unsupported_entity_type');
  assert.equal((await api.addLink({ conversationId: c.id, type: 'lead' })).error.code, 'missing_entity_id');
  const first = await api.addLink({ conversationId: c.id, type: 'lead', id: 5 });
  assert.equal(first.added, true);
  const again = await api.addLink({ conversationId: c.id, type: 'lead', id: 5 });
  assert.equal(again.added, false); // idempotent
  assert.equal(repo._state.links.length, 1);
});

test('getMessageStatus and markRead', async () => {
  const { repo, api } = wire();
  const c = await repo.insertConversation({ normalized_phone: '+15551234567' });
  const m = await repo.insertMessage({ conversation_id: c.id, direction: 'outbound', body: 'x', status: 'sent', provider: 'telnyx', provider_message_id: 'pmid_1', created_at: 't1' });
  const st = await api.getMessageStatus({ id: m.id });
  assert.equal(st.ok, true); assert.equal(st.status, 'sent');
  assert.equal((await api.getMessageStatus({ id: 'nope' })).error.code, 'message_not_found');
  const mr = await api.markRead({ conversationId: c.id });
  assert.equal(mr.ok, true);
  assert.ok(mr.conversation.last_read_at);
});
