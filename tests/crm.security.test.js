/**
 * Security regression test for crm.html — run with:
 *   node --test tests/crm.security.test.js
 * The standalone CRM must carry NO privileged browser credential and make NO direct
 * provider calls; every privileged operation goes through the authenticated /api layer,
 * and state-changing calls attach the CSRF token.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "crm.html"), "utf8");

test("no Supabase service-role / JWT-shaped secret", () => {
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/.test(html), "JWT literal present");
  assert.ok(!/SB_KEY|SB_URL|SB_HEADERS/.test(html), "Supabase config identifier present");
  assert.ok(!/\bapikey\b/.test(html), "apikey header present");
});
test("no Vapi or Textbelt key", () => {
  assert.ok(!/VAPI_KEY|api\.vapi\.ai/.test(html), "Vapi present");
  assert.ok(!/TEXTBELT_KEY|textbelt\.com/.test(html), "Textbelt present");
});
test("no direct Supabase provider call", () => {
  assert.ok(!/\/rest\/v1\//.test(html), "direct Supabase REST call");
  assert.ok(!/await sb\(|= sb\(/.test(html), "legacy sb() helper call remains");
});
test("privileged data goes through the authenticated /api layer", () => {
  assert.match(html, /fetch\('\/api\/auth\/session'/);
  assert.match(html, /apiGet\('\/leads\?mode=crm-list'\)/);
  assert.match(html, /apiGet\('\/agents'\)/);
  assert.match(html, /apiGet\('\/deals'\)/);
  assert.match(html, /apiGet\('\/commissions'\)/);
  assert.match(html, /apiGet\('\/sequences'\)/);
  assert.match(html, /apiGet\('\/tasks\?sort=due'\)/);
  assert.match(html, /apiGet\('\/bookings\?mode=crm-week'\)/);
  assert.match(html, /apiGet\('\/activities\?lead_id=/);
});
test("writes go through /api with method + CSRF wiring", () => {
  assert.match(html, /apiSend\('PATCH', '\/tasks\//);
  assert.match(html, /apiSend\('PATCH', '\/commissions\//);
  assert.match(html, /apiSend\('POST', '\/leads', data\)/);
  assert.match(html, /apiSend\('POST', '\/deals', data\)/);
  assert.match(html, /apiSend\('POST', '\/tasks', data\)/);
  assert.match(html, /apiSend\('POST', '\/agents', data\)/);
  assert.match(html, /X-CSRF-Token/, "CSRF header wiring present");
});
test("login gate present; follow-up sequences panel preserved", () => {
  assert.match(html, /id="login-gate"/);
  assert.match(html, /apiLogin\(/);
  assert.match(html, /apiLogout\(/);
  assert.match(html, /loadSequences/, "sequences panel kept");
});
