#!/usr/bin/env node
/* ===========================================================================
 * check-unknown-mapping.js — object-scoped check of healthcheck "unknown" honesty
 * ---------------------------------------------------------------------------
 * Gate A requires that where a scheduled function has no heartbeat, its execution
 * is reported as "unknown", and that "unknown" is NOT silently reported as
 * healthy/ok. A naive regex conflates the response ENVELOPE ("ok":true — the
 * HTTP call succeeded) with a nested PROBE that is "unknown". This walks the
 * parsed JSON and only flags a probe object where an "unknown" state co-exists
 * with a truthy healthy/ok in the SAME object.
 *
 * Prints one of: "FOUND HONEST" | "FOUND DISHONEST" | "NONE HONEST" | "UNPARSEABLE"
 * ===========================================================================*/
const fs = require('fs');
let j;
try { j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); }
catch (e) { console.log('UNPARSEABLE'); process.exit(0); }

let found = false, dishonest = false;
const EXEC_KEY = /(execution|scheduler|_exec|heartbeat)/i;
const asHealthy = (o) => o && typeof o === 'object' &&
  (o.healthy === true || o.ok === true || /^(healthy|ok|up|green)$/i.test(String(o.status || o.state || '')));

function walk(o) {
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    const v = o[k];
    // case A: a string field like readmail_execution:"unknown"
    if (EXEC_KEY.test(k) && typeof v === 'string' && v.toLowerCase() === 'unknown') {
      found = true;
      if (asHealthy(o)) dishonest = true;               // same object also asserts health
    }
    // case B: a probe object whose own state/status/execution is "unknown"
    if (v && typeof v === 'object') {
      const st = String(v.state || v.status || v.execution || '').toLowerCase();
      if (st === 'unknown') { found = true; if (v.healthy === true || v.ok === true) dishonest = true; }
      walk(v);
    }
  }
}
walk(j);
console.log(`${found ? 'FOUND' : 'NONE'} ${dishonest ? 'DISHONEST' : 'HONEST'}`);
