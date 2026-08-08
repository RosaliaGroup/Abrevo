'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripQuotedReply, emailSnippet } = require('../emailSnippet');

test('strips ">" quoted lines, keeps the newest text', () => {
  const raw = "Yes 2pm works, thanks!\n\n> On the tour we discussed\n> the 1BR unit";
  assert.equal(stripQuotedReply(raw), 'Yes 2pm works, thanks!');
});

test('strips Gmail "On <date>, <name> wrote:" attribution, including wrapped', () => {
  const raw = "Any update?\nOn Fri, Aug 1, 2026 at 10:00 AM Rosalia Group\n<inquiries@rosaliagroup.com> wrote:\n> earlier reply";
  assert.equal(stripQuotedReply(raw), 'Any update?');
});

test('strips Outlook "-----Original Message-----" divider and everything after', () => {
  const raw = "Sounds good.\n\n-----Original Message-----\nFrom: Rosalia Group\nSent: Friday\nTo: Me\nSubject: Your tour\n\nold body";
  assert.equal(stripQuotedReply(raw), 'Sounds good.');
});

test('strips a dash-less Outlook From:/Sent:/To:/Subject: header block', () => {
  const raw = "Confirmed for 3pm.\nFrom: Rosalia Group\nSent: Friday, Aug 1\nTo: me@example.com\nSubject: Tour\n\nquoted body here";
  assert.equal(stripQuotedReply(raw), 'Confirmed for 3pm.');
});

test('a bare "From:" line in prose is NOT treated as a header block', () => {
  const raw = "From: my old apartment, I can move any time.\nThanks!";
  assert.equal(stripQuotedReply(raw), "From: my old apartment, I can move any time.\nThanks!");
});

test('emailSnippet collapses whitespace and caps at ~200 chars with an ellipsis', () => {
  assert.equal(emailSnippet('  Hi\n\nthere  '), 'Hi there');            // short: no ellipsis
  const long = emailSnippet('x'.repeat(250));
  assert.equal(long.length, 201);                                       // 200 chars + '…'
  assert.ok(long.endsWith('…'));
});

test('emailSnippet strips the quote chain before truncating', () => {
  const raw = "Short new line.\n> " + 'q'.repeat(500);
  assert.equal(emailSnippet(raw), 'Short new line.');                   // quoted bulk never counts toward the cap
});
