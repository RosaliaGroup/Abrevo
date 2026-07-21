/**
 * Security regression test for rosalia.html — run with:
 *   node --test tests/rosalia.security.test.js
 * Enforces that the page carries NO privileged browser credential and makes NO
 * direct provider calls; every privileged operation goes through the authenticated
 * /api layer, and state-changing calls carry the CSRF token.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "rosalia.html"), "utf8");

test("no Supabase service-role / JWT-shaped secret", () => {
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/.test(html), "JWT literal present");
  assert.ok(!/SUPABASE_KEY|SUPABASE_URL/.test(html), "Supabase key/url identifier present");
  assert.ok(!/\bapikey\b/.test(html), "apikey header present");
});
test("no VAPI key", () => {
  assert.ok(!/VAPI_KEY|VAPI_BASE/.test(html), "Vapi key/base present");
});
test("no Textbelt key", () => {
  assert.ok(!/TEXTBELT_KEY/.test(html), "Textbelt key identifier present");
  assert.ok(!/[0-9a-f]{40}[A-Za-z0-9]{20,}/.test(html), "Textbelt-shaped key literal present");
});
test("no direct Supabase / Vapi / Textbelt provider calls", () => {
  assert.ok(!/\/rest\/v1\//.test(html), "direct Supabase REST call");
  assert.ok(!/api\.vapi\.ai/.test(html), "direct Vapi call");
  assert.ok(!/textbelt\.com/.test(html), "direct Textbelt call");
});
test("no direct browser calls to privileged Netlify functions (must go via /api)", () => {
  assert.ok(!/\.netlify\/functions\/(inventory|ai-generate|ai-enrich|autocall|readmail|healthcheck)/.test(html),
    "direct function call bypassing /api");
});
test("privileged data goes through the authenticated /api layer", () => {
  assert.match(html, /fetch\('\/api\/auth\/session'/, "session bootstrap present");
  assert.match(html, /apiGet\('\/listing-alerts'\)/);
  assert.match(html, /apiGet\('\/tasks'\)/);
  assert.match(html, /apiGet\('\/vapi\/calls/);
  assert.match(html, /apiSend\('POST', '\/sms\/cancel-link'/);
  assert.match(html, /apiSend\('PATCH', '\/tasks\//);
});
test("CSRF token attached to state-changing requests", () => {
  assert.match(html, /X-CSRF-Token/, "CSRF header wiring present");
});
test("login gate present", () => {
  assert.match(html, /id="login-gate"/);
  assert.match(html, /apiLogin\(/);
  assert.match(html, /apiLogout\(/);
});
