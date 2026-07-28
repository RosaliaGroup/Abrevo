'use strict';

// Plain-node check (no test framework). Run: node functions/lib/__checks__/readmail-parse.check.js
//
// readmail.js requires imap/mailparser/nodemailer, so it can't be require()d
// without node_modules. Instead we load the REAL extractPhone function and the
// REAL BUSINESS_NAME_RE from the readmail.js source and exercise them — no
// reimplementation, and we assert the handler wiring the fallback + greeting.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'readmail.js'), 'utf8');

// --- Load the real extractPhone() from source ---
const fnMatch = src.match(/function extractPhone\(text\) \{[\s\S]*?\n\}/);
assert.ok(fnMatch, 'extractPhone function not found in readmail.js source');
// eslint-disable-next-line no-eval
const extractPhone = eval('(' + fnMatch[0] + ')');

// --- Load the real BUSINESS_NAME_RE from source ---
const reMatch = src.match(/const BUSINESS_NAME_RE = (\/[^\n]*\/i);/);
assert.ok(reMatch, 'BUSINESS_NAME_RE not found in readmail.js source');
// eslint-disable-next-line no-eval
const BUSINESS_NAME_RE = eval(reMatch[1]);
// mirror the real greeting derivation (asserted against source below)
const greetFirst = (name) => {
  const raw = (name || '').trim();
  return (raw && !BUSINESS_NAME_RE.test(raw)) ? raw.split(/\s+/)[0] : '';
};

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }

// --- Phone: supported formats all normalize to +18624239396 ---
const EXPECT = '+18624239396';
check('accepted phone formats normalize to +1 E.164', () => {
  for (const [label, input] of [
    ['dashes', 'My number 862-423-9396'],
    ['parens', 'call (862) 423-9396 anytime'],
    ['spaces', 'ph 862 423 9396'],
    ['dots', '862.423.9396'],
    ['bare 10-digit', '8624239396'],
    ['leading +1', '+1 862-423-9396'],
    ['2 spaces per gap', '862  423  9396'],
    ['3 spaces per gap', '862   423   9396'],
    ['mixed sep + tag-strip gap', 'My number 862-  423 - 9396 thanks'],
  ]) {
    assert.strictEqual(extractPhone(input), EXPECT, `format failed: ${label} (${input})`);
  }
});

check('invalid digit lengths / non-numbers are rejected', () => {
  for (const bad of ['', null, 'no phone here', '5551234', '862-42-9396', '86242399', 'unit 5 year 2024']) {
    assert.strictEqual(extractPhone(bad), null, `should reject: ${JSON.stringify(bad)}`);
  }
});

check('emails are stripped before extraction (no digits pulled from addresses)', () => {
  assert.strictEqual(extractPhone('reach me at a1234567890@relay.example only'), null);
});

// --- Narrow fallback: empty/no-phone parsed.text falls back to HTML + subject ---
check('empty or non-matching parsed.text falls back to HTML/subject', () => {
  const subject = 'Apartment inquiry';
  const strippedHtml = 'Hello, My number 862-423-9396 — please call';
  // simulate the handler two-step with the REAL extractPhone
  const step = (body) => {
    let phone = extractPhone(body + ' ' + subject);
    if (!phone && strippedHtml && strippedHtml !== body) phone = extractPhone(strippedHtml + ' ' + subject);
    return phone;
  };
  assert.strictEqual(step(''), EXPECT, 'empty parsed.text should fall back to HTML');
  assert.strictEqual(step('just some text with no number'), EXPECT, 'no-phone parsed.text should fall back to HTML');
  // handler actually wires the fallback
  assert.ok(src.includes("phone = extractPhone(strippedHtml + ' ' + subject);"), 'HTML fallback not wired in handler');
  assert.ok(/if \(!phone && strippedHtml && strippedHtml !== body\)/.test(src), 'fallback guard not present/narrow');
});

// --- Greeting: business names -> "Hi there,", person names unchanged ---
check('business-like display names do not become a first name', () => {
  assert.strictEqual(greetFirst('Rentals Ironbound'), '', 'Rentals Ironbound should not yield a first name');
  assert.strictEqual(greetFirst('Iron65 Leasing Team'), '', 'Iron65 Leasing Team should not yield a first name');
  for (const biz of ['Ironbound Property Management', 'Newark Realty', 'Elite Properties LLC', 'Acme Realtors', 'Bay Estates']) {
    assert.strictEqual(greetFirst(biz), '', `business name leaked a first name: ${biz}`);
  }
});

check('normal person names still produce a first name', () => {
  assert.strictEqual(greetFirst('John Smith'), 'John');
  assert.strictEqual(greetFirst('maria garcia'), 'maria');
  assert.strictEqual(greetFirst('Vincent Price'), 'Vincent'); // \b prevents "inc" false-positive
});

check('greeting derivation + fallback wording present in source (no drift)', () => {
  assert.ok(src.includes("const firstName = (rawLeadName && !BUSINESS_NAME_RE.test(rawLeadName)) ? rawLeadName.split(/\\s+/)[0] : '';"),
    'greeting firstName derivation drifted from expected');
  assert.ok(/Hi there,/.test(src) && /Do not use a company or business name as a first name/.test(src),
    'business-name greeting fallback wording missing');
});

console.log(`\nreadmail-parse.check.js: ${passed} checks passed`);
