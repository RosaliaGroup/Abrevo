'use strict';
/**
 * Phase 2A-1 — inbound-SMS auto-link integration through processInbound.
 * Proves the link is attempted only after safe persistence, only for Rosalia's
 * line, and that a lookup/link failure never affects inbound persistence,
 * webhook success, STOP/START/HELP, or triggers a send.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRepo } = require('./fakeRepo');
const { createConversationService } = require('../conversations');
const { createLeadLinker } = require('../leadLinker');
const { createSmsWebhookProcessor } = require('../smsWebhook');

const ROSALIA = '+15550000000';   // receiving (Rosalia) number
const SENDER = '5551234567';      // inbound from (10-digit)
const SENDER_E164 = '+15551234567';

function wire() {
  const repo = createFakeRepo();
  const conversationService = createConversationService({ repo });
  const logger = { lines: [], log: (...a) => logger.lines.push(a.join(' ')) };
  const leadLinker = createLeadLinker({ repo, rosaliaNumber: ROSALIA, logger });
  const proc = createSmsWebhookProcessor({ repo, conversationService, clock: () => 'T', leadLinker });
  return { repo, proc, logger };
}

function inbound(id, from, to, text) {
  return { data: { event_type: 'message.received', id: 'evt_' + id, payload: { id, from: { phone_number: from }, to: [{ phone_number: to }], text } } };
}

function leadLinks(repo) {
  return repo._state.links.filter((l) => l.entity_type === 'lead');
}

test('inbound on Rosalia line with a unique Rosalia lead is auto-linked', async () => {
  const { repo, proc } = wire();
  repo._state.leads.push({ id: '42', phone: SENDER_E164, client: 'rosalia' });
  const r = await proc.processInbound(inbound('i1', SENDER, ROSALIA, 'hello'));
  assert.equal(r.ok, true);
  const ll = leadLinks(repo);
  assert.equal(ll.length, 1);
  assert.equal(ll[0].entity_id, '42');
  assert.equal(ll[0].conversation_id, r.conversationId);
});

test('inbound on a non-Rosalia destination is never linked (message still persisted)', async () => {
  const { repo, proc } = wire();
  repo._state.leads.push({ id: '42', phone: SENDER_E164, client: 'rosalia' });
  const r = await proc.processInbound(inbound('i2', SENDER, '+19998887777', 'hello'));
  assert.equal(r.ok, true);
  assert.ok(r.message, 'inbound message persisted');
  assert.equal(leadLinks(repo).length, 0);
});

test('a Mechanical lead on the same number is never linked', async () => {
  const { repo, proc } = wire();
  repo._state.leads.push({ id: '99', phone: SENDER_E164, client: 'mechanical' });
  const r = await proc.processInbound(inbound('i3', SENDER, ROSALIA, 'hello'));
  assert.equal(r.ok, true);
  assert.equal(leadLinks(repo).length, 0);
});

test('link failure never blocks inbound persistence or webhook success', async () => {
  const { repo, proc } = wire();
  repo.findLeadsByPhone = async () => { throw new Error('lookup down'); };
  repo._state.leads.push({ id: '42', phone: SENDER_E164, client: 'rosalia' });
  const r = await proc.processInbound(inbound('i4', SENDER, ROSALIA, 'hello'));
  assert.equal(r.ok, true);
  assert.equal(r.deduped, false);
  assert.ok(r.message, 'message still persisted despite link failure');
  assert.equal(repo._state.messages.filter((m) => m.direction === 'inbound').length, 1);
  assert.equal(leadLinks(repo).length, 0);
});

test('STOP still opts out; linking does not interfere with compliance', async () => {
  const { repo, proc } = wire();
  repo._state.leads.push({ id: '42', phone: SENDER_E164, client: 'rosalia' });
  const r = await proc.processInbound(inbound('i5', SENDER, ROSALIA, 'STOP'));
  assert.equal(r.compliance.action, 'stop');
  const conv = [...repo._state.conversations.values()][0];
  assert.ok(conv.opted_out_at, 'opt-out applied');
});

test('duplicate inbound delivery does not create a second link', async () => {
  const { repo, proc } = wire();
  repo._state.leads.push({ id: '42', phone: SENDER_E164, client: 'rosalia' });
  const ev = inbound('i6', SENDER, ROSALIA, 'hello');
  const a = await proc.processInbound(ev);
  const b = await proc.processInbound(ev); // duplicate
  assert.equal(a.deduped, false);
  assert.equal(b.deduped, true);
  assert.equal(leadLinks(repo).length, 1, 'idempotent — one link only');
});

test('inbound auto-linking never persists an outbound (no send path)', async () => {
  const { repo, proc } = wire();
  repo._state.leads.push({ id: '42', phone: SENDER_E164, client: 'rosalia' });
  await proc.processInbound(inbound('i7', SENDER, ROSALIA, 'hello'));
  assert.equal(repo._state.messages.filter((m) => m.direction === 'outbound').length, 0);
});
