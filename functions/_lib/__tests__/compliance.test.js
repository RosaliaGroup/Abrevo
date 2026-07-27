'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyKeyword, REPLIES } = require('../compliance');

test('STOP variants classify as stop (case/space insensitive)', () => {
  for (const v of ['STOP', 'stop', '  Stop  ', 'STOPALL', 'unsubscribe', 'CANCEL', 'end', 'QUIT']) {
    assert.equal(classifyKeyword(v), 'stop', v);
  }
});

test('START variants classify as start', () => {
  for (const v of ['START', 'start', 'YES', 'unstop']) assert.equal(classifyKeyword(v), 'start', v);
});

test('HELP variants classify as help', () => {
  for (const v of ['HELP', 'help', 'INFO']) assert.equal(classifyKeyword(v), 'help', v);
});

test('only the first token matters', () => {
  assert.equal(classifyKeyword('STOP please'), 'stop');
  assert.equal(classifyKeyword('help me out'), 'help');
});

test('non-keywords return null', () => {
  for (const v of ['hello', '', null, undefined, 'i want to stop by']) assert.equal(classifyKeyword(v), null);
});

test('approved replies exist for stop/help/start', () => {
  assert.ok(REPLIES.stop && REPLIES.help && REPLIES.start);
  assert.match(REPLIES.stop, /unsubscrib/i);
});
