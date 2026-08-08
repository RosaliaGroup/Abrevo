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

const AGENT = 'Sure — I will message the agent to call you back shortly.';
const MGMT  = 'Okay, I will escalate this to management right away.';

test('call-back requests are grouped by caller, newest first, with count + ids', async () => {
  const { repo, api } = wire();
  repo._state.calls.push(
    // Two requests from the SAME caller: newest is agent, older is management.
    { id: 'r1', caller_phone: '+15551110000', caller_name: 'Dana', transcript: AGENT, flags: ['No booking, reschedule, or cancellation was recorded on this call'], attention_cleared_at: null, created_at: '2026-08-05T00:00:00Z' },
    { id: 'r2', caller_phone: '+15551110000', caller_name: 'Dana', transcript: MGMT,  flags: [], attention_cleared_at: null, created_at: '2026-08-04T00:00:00Z' },
    // A different caller, single agent request.
    { id: 'r3', caller_phone: '+15552220000', caller_name: null, transcript: AGENT, flags: [], attention_cleared_at: null, created_at: '2026-08-03T00:00:00Z' },
  );
  const r = await api.listCallsNeedingAttention({});
  assert.equal(r.ok, true);

  const callbacks = r.calls.filter(c => c.callback_type);
  assert.equal(callbacks.length, 2);

  const dana = callbacks.find(c => c.caller_phone === '+15551110000');
  assert.equal(dana.callback_type, 'management');           // MANAGEMENT wins if any request is management
  assert.equal(dana.count, 2);                              // count = number of that caller's requests
  assert.deepEqual(dana.ids.sort(), ['r1', 'r2']);          // both ids so one clear reviews all
  assert.equal(dana.created_at, '2026-08-05T00:00:00Z');    // representative = most recent request
  assert.equal('transcript' in dana, false);               // raw transcript never leaves the server

  const other = callbacks.find(c => c.caller_phone === '+15552220000');
  assert.equal(other.callback_type, 'agent');
  assert.equal(other.count, 1);
});

test('non-callback calls: real flags kept one-per-row, "No booking" boilerplate dropped', async () => {
  const { repo, api } = wire();
  repo._state.calls.push(
    { id: 'f1', caller_phone: '+15553330000', transcript: 'nothing notable', flags: ['Very short call (4s) — likely abandoned'], attention_cleared_at: null, created_at: '2026-08-02T00:00:00Z' },
    { id: 'f2', caller_phone: '+15554440000', transcript: 'nothing notable', flags: ['No booking, reschedule, or cancellation was recorded on this call'], attention_cleared_at: null, created_at: '2026-08-01T00:00:00Z' },
  );
  const r = await api.listCallsNeedingAttention({});
  const ids = r.calls.map(c => c.id ? c.id : (c.ids || [])[0]);
  // f1 kept as a flagged row (callback_type null, its own id); f2 is boilerplate-only -> excluded.
  const flagged = r.calls.filter(c => !c.callback_type);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].ids[0], 'f1');
  assert.equal(flagged[0].count, 1);
  assert.ok(!ids.includes('f2'));
});

test('internal / own numbers are excluded (hardcoded set + configured sender)', async () => {
  const { repo, api } = wire();
  const prev = process.env.TELNYX_FROM_ROSALIA;
  process.env.TELNYX_FROM_ROSALIA = '+15559998888';   // explicit host-env sender for this assertion
  try {
    repo._state.calls.push(
      { id: 'a1', caller_phone: '+16462269189', transcript: MGMT, flags: [], attention_cleared_at: null, created_at: '2026-08-06T00:00:00Z' }, // Ana's cell (INTERNAL_NUMBERS)
      { id: 's1', caller_phone: '+15559998888', transcript: AGENT, flags: [], attention_cleared_at: null, created_at: '2026-08-05T00:00:00Z' }, // configured sender
      { id: 'ok', caller_phone: '+15557770000', transcript: AGENT, flags: [], attention_cleared_at: null, created_at: '2026-08-04T00:00:00Z' }, // real caller
    );
    const r = await api.listCallsNeedingAttention({});
    const phones = r.calls.map(c => c.caller_phone);
    assert.ok(!phones.includes('+16462269189'));
    assert.ok(!phones.includes('+15559998888'));
    assert.deepEqual(phones, ['+15557770000']);
  } finally {
    if (prev === undefined) delete process.env.TELNYX_FROM_ROSALIA; else process.env.TELNYX_FROM_ROSALIA = prev;
  }
});

test('clearCallAttention stamps the timestamp and is idempotent', async () => {
  const { repo, api } = wire();
  repo._state.calls.push({ id: 'k9', caller_phone: '+15550000009', transcript: MGMT, flags: [], attention_cleared_at: null, created_at: '2026-08-05T00:00:00Z' });

  const first = await api.clearCallAttention({ id: 'k9', at: '2026-08-06T00:00:00Z' });
  assert.equal(first.ok, true);
  assert.equal(first.call.attention_cleared_at, '2026-08-06T00:00:00Z');

  // Now excluded from the list.
  const after = await api.listCallsNeedingAttention({});
  assert.equal(after.calls.find((c) => (c.ids || []).includes('k9')), undefined);

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
