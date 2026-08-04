'use strict';
/**
 * Phase 2A-2 — outboundLeadLink helper unit tests. Proves the pure link
 * decision: a link only for Rosalia leads with a known id; nothing for
 * Mechanical / unknown / null client or a missing id; string coercion; and that
 * it never throws and does no phone-based guessing (it takes no phone).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { leadLink } = require('../outboundLeadLink');

test('Rosalia + known lead id -> one lead link', () => {
  assert.deepEqual(leadLink('42', 'rosalia'), { type: 'lead', id: '42' });
});

test('Mechanical client -> no link', () => {
  assert.equal(leadLink('42', 'mechanical'), null);
});

test('unknown client -> no link', () => {
  assert.equal(leadLink('42', 'iron65'), null);
  assert.equal(leadLink('42', 'something'), null);
});

test('undefined / null / empty client -> no link', () => {
  assert.equal(leadLink('42', undefined), null);
  assert.equal(leadLink('42', null), null);
  assert.equal(leadLink('42', ''), null);
});

test('missing lead id (null/undefined/empty) -> no link', () => {
  assert.equal(leadLink(null, 'rosalia'), null);
  assert.equal(leadLink(undefined, 'rosalia'), null);
  assert.equal(leadLink('', 'rosalia'), null);
});

test('lead id string coercion (number -> string)', () => {
  assert.deepEqual(leadLink(42, 'rosalia'), { type: 'lead', id: '42' });
  assert.equal(leadLink(42, 'rosalia').id, '42');
  assert.equal(typeof leadLink(42, 'rosalia').id, 'string');
});

test('never throws (even when String() coercion would throw)', () => {
  const boom = { toString() { throw new Error('nope'); } };
  let r;
  assert.doesNotThrow(() => { r = leadLink(boom, 'rosalia'); });
  assert.equal(r, null);
  // and does not throw for odd client types
  assert.doesNotThrow(() => leadLink('42', { not: 'a string' }));
});

test('signature takes no phone — cannot do phone-based guessing', () => {
  // The helper only accepts (leadId, client). There is no phone parameter, so it
  // structurally cannot resolve a lead from a phone number.
  assert.equal(leadLink.length, 2);
});
