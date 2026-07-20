'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, toE164OrNull } = require('../phone');

test('10 digits -> +1 E.164', () => {
  const r = normalizePhone('5551234567');
  assert.equal(r.ok, true);
  assert.equal(r.e164, '+15551234567');
});

test('strips formatting and normalizes', () => {
  assert.equal(normalizePhone('(555) 123-4567').e164, '+15551234567');
  assert.equal(normalizePhone('555.123.4567').e164, '+15551234567');
  assert.equal(normalizePhone(' 555 123 4567 ').e164, '+15551234567');
});

test('11 digits leading 1 -> + E.164', () => {
  assert.equal(normalizePhone('15551234567').e164, '+15551234567');
});

test('already-E.164 input is idempotent', () => {
  assert.equal(normalizePhone('+15551234567').e164, '+15551234567');
});

test('missing values rejected explicitly', () => {
  for (const v of [null, undefined, '', '   ', 'abc']) {
    const r = normalizePhone(v);
    assert.equal(r.ok, false);
    assert.ok(r.reason === 'missing' || r.reason === 'invalid');
  }
});

test('invalid lengths rejected explicitly (not coerced)', () => {
  assert.equal(normalizePhone('123').ok, false);          // too short
  assert.equal(normalizePhone('20551234567').ok, false);  // 11 digits not leading 1
  assert.equal(normalizePhone('+447911123456').ok, false);// non-NANP
  assert.equal(normalizePhone('155512345678').ok, false); // 12 digits
});

test('toE164OrNull convenience', () => {
  assert.equal(toE164OrNull('5551234567'), '+15551234567');
  assert.equal(toE164OrNull('nope'), null);
});
