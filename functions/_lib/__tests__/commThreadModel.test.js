'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeMessages, orderThread, messageKey } = require('../commThreadModel');

test('orders by created_at ascending', () => {
  const out = orderThread([
    { id: 'b', created_at: '2026-01-01T00:00:02Z' },
    { id: 'a', created_at: '2026-01-01T00:00:01Z' },
  ]);
  assert.deepEqual(out.map((m) => m.id), ['a', 'b']);
});

test('merge does not duplicate the same message id', () => {
  const existing = [{ id: 'm1', body: 'hi', created_at: 't1' }];
  const incoming = [{ id: 'm1', body: 'hi', status: 'delivered', created_at: 't1' }];
  const merged = mergeMessages(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'delivered'); // patched, not duplicated
});

test('optimistic message reconciles with confirmed row via idempotency_key (no duplicate)', () => {
  const optimistic = { tempId: 'ui-1', idempotency_key: 'k1', direction: 'outbound', body: 'yo', status: 'queued', created_at: 't1' };
  const confirmed = { id: 'm9', idempotency_key: 'k1', direction: 'outbound', body: 'yo', status: 'sent', created_at: 't1' };
  const merged = mergeMessages([optimistic], [confirmed]);
  assert.equal(merged.length, 1);              // exactly one bubble
  assert.equal(merged[0].id, 'm9');            // replaced by the confirmed row
  assert.equal(merged[0].status, 'sent');
});

test('distinct messages are all kept', () => {
  const merged = mergeMessages(
    [{ id: 'm1', created_at: 't1' }],
    [{ id: 'm2', created_at: 't2' }, { provider_message_id: 'p3', created_at: 't3' }],
  );
  assert.equal(merged.length, 3);
});

test('messageKey falls back id -> provider id -> tempId', () => {
  assert.equal(messageKey({ id: 'a', provider_message_id: 'b', tempId: 'c' }), 'a');
  assert.equal(messageKey({ provider_message_id: 'b', tempId: 'c' }), 'b');
  assert.equal(messageKey({ tempId: 'c' }), 'c');
});
