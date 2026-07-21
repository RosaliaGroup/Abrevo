/**
 * Security regression test for crm.html — run with:
 *   node --test tests/crm.security.test.js
 * Enforces that the CRM page carries NO privileged browser credential and makes
 * NO direct Supabase calls; every privileged operation goes through the
 * authenticated /api layer, and state-changing calls carry the CSRF token.
 * The tel: Call and sms: Text buttons are intentionally preserved.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "crm.html"), "utf8");

test("no Supabase service-role / JWT-shaped secret", () => {
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/.test(html), "JWT literal present");
  assert.ok(!/SB_KEY|SB_HEADERS|SB_URL|service_role/.test(html), "Supabase key wiring present");
  assert.ok(!/\bapikey\b/.test(html), "apikey header present");
});
test("no direct Supabase REST calls from the browser", () => {
  assert.ok(!/\/rest\/v1\//.test(html), "direct Supabase REST call");
  assert.ok(!/\bsb\(/.test(html), "legacy sb() helper present");
});
test("privileged data goes through the authenticated /api layer", () => {
  assert.match(html, /fetch\('\/api\/auth\/session'/, "session bootstrap present");
  assert.match(html, /apiGet\('\/leads\?mode=crm-list'\)/);
  assert.match(html, /apiGet\('\/agents'\)/);
  assert.match(html, /apiGet\('\/deals'\)/);
  assert.match(html, /apiGet\('\/commissions'\)/);
  assert.match(html, /apiGet\('\/sequences'\)/);
  assert.match(html, /apiGet\('\/bookings\?mode=crm-week'\)/);
  assert.match(html, /apiSend\('POST', '\/leads'/);
  assert.match(html, /apiSend\('PATCH', '\/tasks\//);
  assert.match(html, /apiSend\('PATCH', '\/commissions\//);
});
test("CSRF token attached to state-changing requests", () => {
  assert.match(html, /X-CSRF-Token/, "CSRF header wiring present");
});
test("login gate present", () => {
  assert.match(html, /id="login-gate"/);
  assert.match(html, /apiLogin\(/);
  assert.match(html, /apiLogout\(/);
});
test("tel: Call and sms: Text buttons preserved", () => {
  assert.ok(html.includes('href="tel:'), "tel: Call links preserved");
  assert.ok(html.includes('href="sms:'), "sms: Text buttons preserved");
});
