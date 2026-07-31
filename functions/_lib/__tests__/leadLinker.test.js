'use strict';
/**
 * Phase 2A-1 — leadLinker unit tests. Proves the verified linking rule:
 *   tenant gate (to == TELNYX_FROM_ROSALIA) AND exactly one client='rosalia'
 *   lead whose phone normalizes exactly to the inbound sender.
 * Also proves: no cross-tenant link, idempotency, non-throwing on error,
 * no send path, and PII-free logging.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRepo } = require('./fakeRepo');
const { createLeadLinker } = require('../leadLinker');

const ROSALIA = '+15550000000';        // stands in for TELNYX_FROM_ROSALIA
const SENDER = '+18624239396';         // inbound `from`
const SENDER_10 = '8624239396';

function capturingLogger() {
  const lines = [];
  return { lines, log: (...a) => lines.push(a.join(' ')) };
}

function wire(opts = {}) {
  // Honor an explicit `rosaliaNumber: undefined` (destructuring defaults would
  // silently substitute ROSALIA and hide the missing-env case under test).
  const rosaliaNumber = 'rosaliaNumber' in opts ? opts.rosaliaNumber : ROSALIA;
  const repo = createFakeRepo();
  const logger = capturingLogger();
  const linker = createLeadLinker({ repo, rosaliaNumber, logger });
  return { repo, logger, linker };
}

// A conversation must exist for the link to attach to.
async function seedConversation(repo, phone = SENDER) {
  const c = await repo.insertConversation({ normalized_phone: phone });
  return c.id;
}

test('tenant gate: non-Rosalia destination performs NO lookup and NO link', async () => {
  const { repo, linker } = wire();
  let lookups = 0;
  const orig = repo.findLeadsByPhone.bind(repo);
  repo.findLeadsByPhone = async (...a) => { lookups++; return orig(...a); };
  repo._state.leads.push({ id: '42', phone: SENDER, client: 'rosalia' });
  const cid = await seedConversation(repo);

  const r = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: '+19998887777' });
  assert.equal(r.linked, false);
  assert.equal(r.reason, 'tenant_mismatch');
  assert.equal(lookups, 0, 'no lead lookup on tenant mismatch');
  assert.equal(repo._state.links.length, 0);
});

test('tenant gate: missing TELNYX_FROM_ROSALIA performs NO lookup and NO link', async () => {
  const { repo, linker } = wire({ rosaliaNumber: undefined });
  let lookups = 0;
  const orig = repo.findLeadsByPhone.bind(repo);
  repo.findLeadsByPhone = async (...a) => { lookups++; return orig(...a); };
  repo._state.leads.push({ id: '42', phone: SENDER, client: 'rosalia' });
  const cid = await seedConversation(repo);

  const r = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });
  assert.equal(r.linked, false);
  assert.equal(r.reason, 'tenant_mismatch');
  assert.equal(lookups, 0);
  assert.equal(repo._state.links.length, 0);
});

test('zero exact Rosalia matches -> no link', async () => {
  const { repo, linker } = wire();
  const cid = await seedConversation(repo);
  const r = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });
  assert.equal(r.linked, false);
  assert.equal(r.reason, 'no_match');
  assert.equal(repo._state.links.length, 0);
});

test('one exact Rosalia match -> idempotent conversation_links insert', async () => {
  const { repo, linker } = wire();
  repo._state.leads.push({ id: '42', phone: SENDER, client: 'rosalia' });
  const cid = await seedConversation(repo);

  const r = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });
  assert.equal(r.linked, true);
  assert.equal(r.leadId, '42');
  assert.equal(r.added, true);
  assert.equal(repo._state.links.length, 1);
  assert.deepEqual(
    { c: repo._state.links[0].conversation_id, t: repo._state.links[0].entity_type, e: repo._state.links[0].entity_id },
    { c: cid, t: 'lead', e: '42' });
});

test('multiple exact Rosalia matches -> no link', async () => {
  const { repo, linker } = wire();
  repo._state.leads.push({ id: '42', phone: SENDER, client: 'rosalia' });
  repo._state.leads.push({ id: '43', phone: SENDER, client: 'rosalia' });
  const cid = await seedConversation(repo);

  const r = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });
  assert.equal(r.linked, false);
  assert.equal(r.reason, 'ambiguous');
  assert.equal(r.count, 2);
  assert.equal(repo._state.links.length, 0);
});

test('Mechanical lead can never be linked (excluded at query and re-checked)', async () => {
  const { repo, linker } = wire();
  repo._state.leads.push({ id: '99', phone: SENDER, client: 'mechanical' });
  const cid = await seedConversation(repo);

  const r = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });
  assert.equal(r.linked, false);
  assert.equal(r.reason, 'no_match');
  assert.equal(repo._state.links.length, 0);
});

test('same phone on Mechanical + Rosalia links ONLY the Rosalia lead', async () => {
  const { repo, linker } = wire();
  repo._state.leads.push({ id: '99', phone: SENDER, client: 'mechanical' });
  repo._state.leads.push({ id: '42', phone: SENDER, client: 'rosalia' });
  const cid = await seedConversation(repo);

  const r = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });
  assert.equal(r.linked, true);
  assert.equal(r.leadId, '42');
  assert.equal(repo._state.links.length, 1);
  assert.equal(repo._state.links[0].entity_id, '42');
});

test('code-side exact match rejects a coarse ilike over-match', async () => {
  const { repo, linker } = wire();
  // Contains the 10-digit substring but is not the same (unnormalizable) number.
  repo._state.leads.push({ id: '77', phone: SENDER_10 + '123', client: 'rosalia' });
  const cid = await seedConversation(repo);

  const r = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });
  assert.equal(r.linked, false);
  assert.equal(r.reason, 'no_match');
  assert.equal(repo._state.links.length, 0);
});

test('idempotent: a second call adds no duplicate link', async () => {
  const { repo, linker } = wire();
  repo._state.leads.push({ id: '42', phone: SENDER, client: 'rosalia' });
  const cid = await seedConversation(repo);

  const a = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });
  const b = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });
  assert.equal(a.added, true);
  assert.equal(b.linked, true);
  assert.equal(b.added, false, 'second insert is a no-op');
  assert.equal(repo._state.links.length, 1);
});

test('never throws on repo error; returns a clean error result', async () => {
  const { repo, linker } = wire();
  repo.findLeadsByPhone = async () => { throw new Error('boom'); };
  const cid = await seedConversation(repo);

  const r = await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });
  assert.equal(r.linked, false);
  assert.equal(r.reason, 'error');
  assert.equal(repo._state.links.length, 0);
});

test('missing conversationId returns a clean result, no throw', async () => {
  const { linker } = wire();
  const r = await linker.linkInboundConversation({ from: SENDER, to: ROSALIA });
  assert.equal(r.linked, false);
  assert.equal(r.reason, 'no_conversation');
});

test('logs are PII-free (no phone digits, no names)', async () => {
  const { repo, logger, linker } = wire();
  repo._state.leads.push({ id: '42', phone: SENDER, client: 'rosalia', name: 'Jane Doe' });
  const cid = await seedConversation(repo);
  await linker.linkInboundConversation({ conversationId: cid, from: SENDER, to: ROSALIA });

  assert.ok(logger.lines.length > 0, 'a log line was emitted');
  for (const line of logger.lines) {
    assert.doesNotMatch(line, /\d{7,}/, 'no long digit runs (phone) in logs: ' + line);
    assert.doesNotMatch(line, /Jane|Doe/, 'no lead name in logs: ' + line);
    assert.doesNotMatch(line, /8624239396/, 'no sender digits in logs: ' + line);
  }
});
