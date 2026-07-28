'use strict';

// Plain-node check (no test framework). Run: node functions/lib/__checks__/webflow-phone.check.js
//
// readmail.js can't be require()d (imap/mailparser/nodemailer). We load the REAL
// extractPhone, parseWebflowEmail, and BUSINESS_NAME_RE from source and exercise
// them, and assert the handler/prompt wiring against source. No reimplementation.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'readmail.js'), 'utf8');

function loadFn(sig) {
  const m = src.match(new RegExp('function ' + sig.replace(/[()]/g, '\\$&') + ' \\{[\\s\\S]*?\\n\\}'));
  assert.ok(m, `${sig} not found in source`);
  // eslint-disable-next-line no-eval
  return eval('(' + m[0] + ')');
}
const extractPhone = loadFn('extractPhone(text)');
const parseWebflowEmail = loadFn('parseWebflowEmail(body, subject)');
const reM = src.match(/const BUSINESS_NAME_RE = (\/[^\n]*\/i);/);
assert.ok(reM, 'BUSINESS_NAME_RE not found');
// eslint-disable-next-line no-eval
const BUSINESS_NAME_RE = eval(reM[1]);
const greetFirst = (name) => {
  const raw = (name || '').trim();
  return (raw && !BUSINESS_NAME_RE.test(raw)) ? raw.split(/\s+/)[0] : '';
};

// Mirror the production Webflow phone expression (asserted against source below).
const webflowPhone = (p, body, strippedHtml, subject) =>
  p.phone || extractPhone(body)
    || (strippedHtml && strippedHtml !== body ? extractPhone(strippedHtml + ' ' + subject) : null);

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }

// --- Webflow phone fallback ---------------------------------------------------
check('Webflow message with free-text "My number 862-423-9396" extracts +18624239396', () => {
  const body = 'My number 862-423-9396';
  const subject = 'Interested in Iron65';
  const p = parseWebflowEmail(body, subject);
  assert.ok(!p.phone, 'label parser should NOT find a phone in free text (precondition)');
  assert.strictEqual(webflowPhone(p, body, '', subject), '+18624239396');
});

check('a labeled Webflow phone still takes precedence over the generic extractor', () => {
  // office number appears first; the labeled "Phone:" must win
  const body = 'Reach our office at 973-555-0000. Phone: 862-423-9396';
  const subject = 'Iron 65 contact form';
  const p = parseWebflowEmail(body, subject);
  assert.strictEqual(p.phone, '+18624239396', 'label parser should capture the labeled phone');
  assert.strictEqual(webflowPhone(p, body, '', subject), '+18624239396', 'label phone must take precedence');
});

check('a Webflow message with no phone stays null', () => {
  const body = "Hi, I'm interested in a tour of Iron 65";
  const subject = 'Interested in Iron65';
  const p = parseWebflowEmail(body, subject);
  assert.strictEqual(webflowPhone(p, body, '', subject), null);
});

check('HTML/subject fallback fires only when plain-text body has no phone', () => {
  const body = 'no number in the text part';
  const strippedHtml = 'Hello — My number 862-423-9396';
  const subject = 'Interested in Iron65';
  const p = parseWebflowEmail(body, subject);
  assert.strictEqual(webflowPhone(p, body, strippedHtml, subject), '+18624239396');
});

check('handler wires the Webflow fallback (source)', () => {
  assert.ok(/phone = p\.phone \|\| extractPhone\(body\)/.test(src), 'Webflow branch does not wire the generic fallback');
  assert.ok(/extractPhone\(strippedHtml \+ ' ' \+ subject\)/.test(src), 'HTML/subject fallback missing');
});

// --- Greeting: business -> "Hi there,", person unchanged ----------------------
check('business display names → no first name (Hi there,)', () => {
  assert.strictEqual(greetFirst('Rentals Ironbound'), '');
  assert.strictEqual(greetFirst('Iron65 Leasing Team'), '');
});

check('person names → first name (Hi John,)', () => {
  assert.strictEqual(greetFirst('John Smith'), 'John');
  assert.strictEqual(greetFirst('Vincent Price'), 'Vincent');
});

check('prompt no longer overrides the business-name fallback', () => {
  assert.ok(!/never say "Hi there"/.test(src), 'ANA_CONTEXT still categorically forbids "Hi there"');
  assert.ok(/Do NOT use a business or organization display name/.test(src), 'business-name greeting guidance missing');
  assert.ok(/When no reliable person name is available, greet with "Hi there,"/.test(src), 'no-name greeting guidance missing');
  assert.ok(!/greet them by first name,/.test(src), 'reinforcing "greet them by first name" not narrowed (line 187)');
  assert.ok(/only if it is a real person's name/.test(src), 'narrowed greeting guidance missing at line 187');
});

console.log(`\nwebflow-phone.check.js: ${passed} checks passed`);
