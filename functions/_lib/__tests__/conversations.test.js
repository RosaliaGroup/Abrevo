'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRepo, UniqueViolationError } = require('./fakeRepo');
const { createConversationService } = require('../conversations');

test('creates exactly one conversation for an unknown phone', async () => {
  const repo = createFakeRepo();
  const svc = createConversationService({ repo });
  const r = await svc.getOrCreateConversation({ phone: '(555) 123-4567', createdBy: 'test' });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.conversation.normalized_phone, '+15551234567');
  assert.equal(repo._state.conversations.size, 1);
});

test('reuses the existing conversation for a known phone (any format)', async () => {
  const repo = createFakeRepo();
  const svc = createConversationService({ repo });
  const a = await svc.getOrCreateConversation({ phone: '5551234567' });
  const b = await svc.getOrCreateConversation({ phone: '+1 (555) 123-4567' });
  assert.equal(a.conversation.id, b.conversation.id);
  assert.equal(b.created, false);
  assert.equal(repo._state.conversations.size, 1);
});

test('missing/invalid phone creates nothing', async () => {
  const repo = createFakeRepo();
  const svc = createConversationService({ repo });
  const miss = await svc.getOrCreateConversation({ phone: '' });
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, 'missing_phone');
  const bad = await svc.getOrCreateConversation({ phone: '12345' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid_phone');
  assert.equal(repo._state.conversations.size, 0);
});

test('concurrent get-or-create yields a single conversation (race-safe)', async () => {
  const repo = createFakeRepo();
  const svc = createConversationService({ repo });
  const [a, b] = await Promise.all([
    svc.getOrCreateConversation({ phone: '5551234567' }),
    svc.getOrCreateConversation({ phone: '5551234567' }),
  ]);
  assert.equal(a.conversation.id, b.conversation.id);
  assert.equal(repo._state.conversations.size, 1);
  assert.equal([a.created, b.created].filter(Boolean).length, 1); // exactly one creator
});

test('race recovery path: insert unique-violation falls back to re-select', async () => {
  // Deterministic stub: phone appears absent, insert always conflicts, then present.
  let phoneRow = null;
  const stub = {
    async getConversationByPhone() { return phoneRow; },
    async insertConversation() { throw new UniqueViolationError('normalized_phone'); },
    async listLinks() { return []; },
    async insertLinkIfAbsent() { return null; },
  };
  const svc = createConversationService({ repo: stub });
  // First getByPhone returns null; after the failed insert, the winner's row exists.
  phoneRow = null;
  const p = svc.getOrCreateConversation({ phone: '5551234567' });
  phoneRow = { id: 'c-winner', normalized_phone: '+15551234567', opted_out_at: null };
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(r.created, false);
  assert.equal(r.conversation.id, 'c-winner');
});

test('links CRM entities by stable id; repeated linkage is idempotent', async () => {
  const repo = createFakeRepo();
  const svc = createConversationService({ repo });
  await svc.getOrCreateConversation({ phone: '5551234567', links: [{ type: 'lead', id: 42 }] });
  const second = await svc.getOrCreateConversation({
    phone: '5551234567',
    links: [{ type: 'lead', id: 42 }, { type: 'booking', id: 'bk_9' }],
  });
  assert.equal(second.created, false);
  const kinds = second.links.map((l) => `${l.entity_type}:${l.entity_id}`).sort();
  assert.deepEqual(kinds, ['booking:bk_9', 'lead:42']); // lead:42 not duplicated
  assert.equal(repo._state.links.length, 2);
});

test('unsupported entity types and missing ids are skipped, not invented', async () => {
  const repo = createFakeRepo();
  const svc = createConversationService({ repo });
  const r = await svc.getOrCreateConversation({
    phone: '5551234567',
    links: [{ type: 'owner', id: 1 }, { type: 'lead', id: null }, { type: 'lead', id: 7 }],
  });
  assert.equal(repo._state.links.length, 1); // only lead:7
  assert.equal(r.links[0].entity_type, 'lead');
  assert.equal(r.links[0].entity_id, '7');
  const reasons = r.skippedLinks.map((s) => s.reason).sort();
  assert.deepEqual(reasons, ['missing_entity_id', 'unsupported_entity_type']);
});
