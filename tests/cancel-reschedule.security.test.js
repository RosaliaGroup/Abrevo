/**
 * Security regression test for cancel-reschedule.html — run with:
 *   node --test tests/cancel-reschedule.security.test.js
 * Phase 1 remediation: the page must contain NO privileged browser credential
 * (it delegates all Supabase work to /.netlify/functions/cancel), and that
 * delegation must remain intact.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "cancel-reschedule.html"), "utf8");

test("no JWT (service_role or otherwise) embedded in the page", () => {
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/.test(html), "JWT literal present");
});

test("no Supabase key/url or REST credential wiring remains", () => {
  assert.ok(!/SUPABASE_KEY/.test(html), "SUPABASE_KEY reference present");
  assert.ok(!/supabase\.co\/rest\/v1/.test(html), "direct Supabase REST call present");
  assert.ok(!/\bapikey\b/.test(html), "apikey header present");
});

test("behavior preserved: still delegates to the cancel Netlify function", () => {
  assert.match(html, /\/\.netlify\/functions\/cancel/, "cancel function call missing");
});
