'use strict';
/**
 * Phase 2A-2 — propagation tests for the three automated outbound SMS paths.
 *
 * The real functions/lib/sms.js is replaced with a capturing stub via a
 * Module._load override (also stubbing the bundle-only deps nodemailer/imap/
 * mailparser/googleapis, which are not installed in this dev environment), so we
 * can require followup/autocall/readmail and assert exactly what each passes to
 * sendSMS — WITHOUT touching sms.js or threadLog and without any network.
 *
 * Byte-identity is proven by sending the same lead as Rosalia vs Mechanical and
 * asserting `to`, `text`, and every option EXCEPT the added `links` are equal.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const sent = [];
const smsStub = {
  sendSMS: (to, text, options = {}) => {
    sent.push({ to, text, options });
    return Promise.resolve({ success: true, id: 'pmid_' + sent.length, to, provider: 'telnyx' });
  },
  sendBulk: async () => [],
  toE164: (x) => x,
  withOptOut: (t) => t,
  mask: () => 'xxxx',
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './lib/sms') return smsStub;                 // the wrapper under test
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => ({}) }) };
  if (request === 'imap') return function Imap() {};
  if (request === 'mailparser') return { simpleParser: async () => ({}) };
  if (request === 'googleapis') return { google: {} };
  return origLoad.apply(this, arguments);
};

let followup, autocall, readmail;
try {
  followup = require('../../followup');
  autocall = require('../../autocall');
  readmail = require('../../readmail');
} finally {
  Module._load = origLoad; // restore immediately after loading the graph
}

function reset() { sent.length = 0; }
const LEAD_LINK = [{ type: 'lead', id: '42' }];

// ---- followup ----
test('followup: Rosalia lead attaches one lead link; body/recipient/options otherwise byte-identical', async () => {
  reset();
  const base = { id: 42, phone: '5551234567', name: 'Pat', property: 'Some Building' };
  await followup.sendFollowUpSMS({ ...base, client: 'rosalia' }, 2);
  await followup.sendFollowUpSMS({ ...base, client: 'mechanical' }, 2);
  assert.equal(sent.length, 2);
  const [ros, mech] = sent;
  assert.deepEqual(ros.options.links, LEAD_LINK, 'Rosalia -> exactly one lead link');
  assert.ok(!('links' in mech.options), 'Mechanical -> no link');
  // byte-identity of everything except the added link
  assert.equal(ros.to, mech.to);
  assert.equal(ros.to, base.phone);
  assert.equal(ros.text, mech.text);
  assert.equal(ros.options.optOut, mech.options.optOut);
  assert.equal(ros.options.optOut, true);
});

test('followup: missing phone triggers no send (skip path)', async () => {
  reset();
  await followup.sendFollowUpSMS({ id: 1, client: 'rosalia', phone: null }, 2);
  assert.equal(sent.length, 0);
});

test('followup: unknown/null client attaches no link', async () => {
  reset();
  const base = { id: 42, phone: '5551234567', name: 'Pat', property: 'X' };
  await followup.sendFollowUpSMS({ ...base, client: null }, 2);
  await followup.sendFollowUpSMS({ ...base, client: 'iron65' }, 2);
  assert.equal(sent.length, 2);
  assert.ok(!('links' in sent[0].options));
  assert.ok(!('links' in sent[1].options));
});

// ---- autocall ----
test('autocall: Rosalia attaches link; Mechanical/null do not; cooldown+body unchanged', async () => {
  reset();
  const args = ['5551234567', 'Pat', 'https://book.rosaliagroup.com/book', 1, 'Bldg'];
  await autocall.sendLeadSMS(...args, 42, 'rosalia');
  await autocall.sendLeadSMS(...args, 42, 'mechanical');
  await autocall.sendLeadSMS(...args, null, 'rosalia');
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[0].options.links, LEAD_LINK);
  assert.ok(!('links' in sent[1].options), 'Mechanical -> no link');
  assert.ok(!('links' in sent[2].options), 'missing id -> no link');
  for (const s of sent) {
    assert.equal(s.to, '5551234567');
    assert.equal(s.options.optOut, true);
    assert.equal(s.options.cooldownHours, 1, 'cooldown unchanged');
  }
  assert.equal(sent[0].text, sent[1].text, 'body byte-identical with/without link');
});

// ---- readmail (email-resolved known id path) ----
test('readmail: Rosalia attaches link; Mechanical does not; body/URL/recipient/cooldown unchanged', async () => {
  reset();
  const args = ['5551234567', 'Pat', 'Bldg', 'https://book.rosaliagroup.com/book'];
  await readmail.buildAndSendLeadText(...args, 42, 'rosalia');
  await readmail.buildAndSendLeadText(...args, 42, 'mechanical');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].options.links, LEAD_LINK);
  assert.ok(!('links' in sent[1].options));
  assert.equal(sent[0].to, sent[1].to);
  assert.equal(sent[0].text, sent[1].text);
  assert.equal(sent[0].options.cooldownHours, 2, 'cooldown unchanged');
  assert.equal(sent[0].options.optOut, true);
});

test('readmail: missing lead id attaches no link (still sends)', async () => {
  reset();
  await readmail.buildAndSendLeadText('5551234567', 'Pat', 'Bldg', 'https://book/x', null, 'rosalia');
  assert.equal(sent.length, 1);
  assert.ok(!('links' in sent[0].options));
});
