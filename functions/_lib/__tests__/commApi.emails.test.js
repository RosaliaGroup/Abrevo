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
  const telnyx = { async sendSms() { return { success: true, providerMessageId: 'x' }; } };
  const smsService = createSmsService({ conversationService, repo, telnyx, clock: () => 'T' });
  const api = createCommApi({ repo, conversationService, smsService });
  return { repo, api };
}

function seed(repo) {
  // Lead A: 2 inbound + 1 outbound -> qualifies (count > 1).
  repo._state.leadRows.push({ id: 'A', name: 'Ada Lead', email: 'ada@example.com', email_attention_cleared_at: null });
  repo._state.emails.push(
    { id: 'e1', lead_id: 'A', direction: 'inbound', subject: 'Tour?', body: 'Is 2pm ok?', created_at: '2026-08-01T10:00:00Z' },
    { id: 'e2', lead_id: 'A', direction: 'outbound', subject: 'Re: Tour?', body: 'Sure', created_at: '2026-08-01T11:00:00Z' },
    { id: 'e3', lead_id: 'A', direction: 'inbound', subject: 'Following up', body: 'Any update on my tour?\n\n> On Aug 1 you wrote:\n> Sure, see you then', created_at: '2026-08-02T09:00:00Z' },
  );
  // Lead B: only 1 inbound -> excluded.
  repo._state.leadRows.push({ id: 'B', name: 'Ben Once', email: 'ben@example.com', email_attention_cleared_at: null });
  repo._state.emails.push({ id: 'e4', lead_id: 'B', direction: 'inbound', subject: 'Hi', body: 'first contact', created_at: '2026-08-01T00:00:00Z' });
}

test('listEmailAttention returns only leads with >1 inbound, with newest inbound + counts', async () => {
  const { repo, api } = wire();
  seed(repo);
  const r = await api.listEmailAttention();
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  const a = r.items[0];
  assert.equal(a.lead_id, 'A');
  assert.equal(a.inbound_count, 2);
  assert.equal(a.outbound_count, 1);
  // Newest inbound (e3) drives subject/snippet/timestamp; the quoted reply chain
  // is stripped so only the lead's newest text remains.
  assert.equal(a.subject, 'Following up');
  assert.equal(a.snippet, 'Any update on my tour?');
  assert.equal(a.last_inbound_at, '2026-08-02T09:00:00Z');
  // Superset: vendor-exclusion and cleared-at are client-side, so email + cleared-at pass through.
  assert.equal(a.email, 'ada@example.com');
  assert.equal(a.email_attention_cleared_at, null);
});

test('cleared leads are still returned (browser applies the reappear rule)', async () => {
  const { repo, api } = wire();
  seed(repo);
  // Clear lead A; the row still comes back with the timestamp for the client to compare.
  const cleared = await api.clearEmailAttention({ leadId: 'A', at: '2026-08-03T00:00:00Z' });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.lead.email_attention_cleared_at, '2026-08-03T00:00:00Z');
  const r = await api.listEmailAttention();
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].email_attention_cleared_at, '2026-08-03T00:00:00Z');
});

test('clearEmailAttention validates leadId and reports unknown lead', async () => {
  const { api } = wire();
  const missing = await api.clearEmailAttention({});
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'missing_lead_id');

  const notFound = await api.clearEmailAttention({ leadId: 'nope' });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.error.code, 'lead_not_found');
});
