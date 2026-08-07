'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRepo } = require('./fakeRepo');
const { createConversationService } = require('../conversations');
const { createSmsService } = require('../smsService');
const { createCommApi } = require('../commApi');

// Minimal wiring: the calls methods only touch the repo, but createCommApi
// requires the full trio, so provide inert conversation/sms services.
function wire() {
  const repo = createFakeRepo();
  const conversationService = createConversationService({ repo });
  const telnyx = { async sendSms() { return { success: true, providerMessageId: 'x' }; } };
  const smsService = createSmsService({ conversationService, repo, telnyx, clock: () => 'T' });
  const api = createCommApi({ repo, conversationService, smsService });
  return { repo, api };
}

test('listCallsNeedingAttention returns only un-cleared calls, newest first', async () => {
  const { repo, api } = wire();
  repo._state.calls.push(
    { id: 'k1', caller_phone: '+15550000001', caller_name: null, flags: ['Very short call (4s) — likely abandoned'], attention_cleared_at: null, created_at: '2026-08-01T00:00:00Z' },
    { id: 'k2', caller_phone: '+15550000002', caller_name: 'Pat', flags: ['No booking, reschedule, or cancellation was recorded on this call'], attention_cleared_at: null, created_at: '2026-08-03T00:00:00Z' },
    { id: 'k3', caller_phone: '+15550000003', caller_name: null, flags: ['Call ended on silence timeout — caller may have been left waiting'], attention_cleared_at: '2026-08-04T00:00:00Z', created_at: '2026-08-02T00:00:00Z' },
  );
  const r = await api.listCallsNeedingAttention({});
  assert.equal(r.ok, true);
  // k3 is cleared -> excluded. k1/k2 remain, newest (k2) first. Boilerplate
  // filtering is client-side, so k2 is still returned here.
  assert.deepEqual(r.calls.map((c) => c.id), ['k2', 'k1']);
});

test('clearCallAttention stamps the timestamp and is idempotent', async () => {
  const { repo, api } = wire();
  repo._state.calls.push({ id: 'k9', flags: ['Abnormal end: pipeline-error'], attention_cleared_at: null, created_at: '2026-08-05T00:00:00Z' });

  const first = await api.clearCallAttention({ id: 'k9', at: '2026-08-06T00:00:00Z' });
  assert.equal(first.ok, true);
  assert.equal(first.call.attention_cleared_at, '2026-08-06T00:00:00Z');

  // Now excluded from the list.
  const after = await api.listCallsNeedingAttention({});
  assert.equal(after.calls.find((c) => c.id === 'k9'), undefined);

  // Re-clearing just re-stamps; still ok.
  const again = await api.clearCallAttention({ id: 'k9', at: '2026-08-07T00:00:00Z' });
  assert.equal(again.ok, true);
  assert.equal(again.call.attention_cleared_at, '2026-08-07T00:00:00Z');
});

test('clearCallAttention validates id and reports unknown call', async () => {
  const { api } = wire();
  const missing = await api.clearCallAttention({});
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'missing_call_id');

  const notFound = await api.clearCallAttention({ id: 'nope' });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.error.code, 'call_not_found');
});
