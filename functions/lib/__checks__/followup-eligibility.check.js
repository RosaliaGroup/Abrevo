'use strict';

// Plain-node check (no test framework). Run: node functions/lib/__checks__/followup-eligibility.check.js
//
// Imports the ACTUAL production eligibility helper and reads followup.js source
// to prove the status whitelist and the defensive dnc guard. No node_modules.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { ELIGIBLE_STATUSES, isEligibleStatus, ELIGIBLE_STATUS_FILTER } = require('../followup-eligibility');
const followupSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'followup.js'), 'utf8');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }

// --- Only new + contacted are eligible ---------------------------------------
check('only "new" and "contacted" are eligible statuses', () => {
  assert.deepStrictEqual([...ELIGIBLE_STATUSES].sort(), ['contacted', 'new']);
  assert.strictEqual(isEligibleStatus('new'), true);
  assert.strictEqual(isEligibleStatus('contacted'), true);
});

check('dnc, booked, applied, needs_specialist, and all other statuses are excluded', () => {
  for (const s of ['dnc', 'booked', 'applied', 'needs_specialist', 'lost', 'unqualified',
    'nurture', '', null, undefined, 'NEW', 'Contacted', 'new ']) {
    assert.strictEqual(isEligibleStatus(s), false, `status ${JSON.stringify(s)} must be ineligible`);
  }
});

check('the Supabase query uses the exact whitelist filter, not the old blacklist', () => {
  assert.strictEqual(ELIGIBLE_STATUS_FILTER, 'status=in.(new,contacted)');
  assert.ok(followupSrc.includes('${ELIGIBLE_STATUS_FILTER}'), 'followup.js query does not use ELIGIBLE_STATUS_FILTER');
  assert.ok(!/status=neq\.booked/.test(followupSrc), 'old booked-only blacklist still present');
  assert.ok(/select=[^`]*\bstatus\b/.test(followupSrc), 'status column not selected (guard could not read it)');
});

// --- A DNC fixture cannot reach generation or sending ------------------------
check('DNC lead is excluded at the query source (never fetched)', () => {
  const fixtures = [
    { id: 1, status: 'new' }, { id: 2, status: 'contacted' },
    { id: 3, status: 'dnc' }, { id: 4, status: 'booked' }, { id: 5, status: 'applied' },
  ];
  const wouldBeFetched = fixtures.filter((l) => isEligibleStatus(l.status)).map((l) => l.id);
  assert.deepStrictEqual(wouldBeFetched, [1, 2], 'only new/contacted leads should be fetched');
});

check('defensive dnc guard runs before any send call in the loop', () => {
  const guard = "if (lead.status === 'dnc') {";
  assert.ok(followupSrc.includes(guard), 'defensive dnc guard missing');
  assert.ok(/console\.log\('\[followup\] skipped: dnc'\)/.test(followupSrc), 'dnc skip log missing');
  const gi = followupSrc.indexOf(guard);
  const firstEmailCall = followupSrc.indexOf('await sendFollowUpEmail(lead');
  const firstSmsCall = followupSrc.indexOf('await sendFollowUpSMS(lead');
  assert.ok(gi > -1 && firstEmailCall > gi && firstSmsCall > gi,
    'dnc guard is not positioned before the send calls');
});

check('dnc skip log is PII-free', () => {
  const line = (followupSrc.match(/\[followup\] skipped: dnc[^\n]*/) || [''])[0];
  assert.ok(!/\$\{lead\.(email|name|phone|message)\}/.test(line), 'dnc skip log leaks PII');
});

console.log(`\nfollowup-eligibility.check.js: ${passed} checks passed`);
