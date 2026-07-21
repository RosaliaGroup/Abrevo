/**
 * Security regression test for social.html — run with:
 *   node --test tests/social.security.test.js
 * The social dashboard must carry NO privileged browser credential and make NO direct
 * provider/Supabase calls; every privileged operation goes through the authenticated
 * /api layer, writes attach CSRF, and the login gate is present. The social-auth OAuth
 * flow (server-side secret, no browser credential) is intentionally retained.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "social.html"), "utf8");

test("no Supabase service-role / JWT-shaped secret", () => {
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/.test(html), "JWT literal present");
  assert.ok(!/SUPABASE_KEY|SUPABASE_URL/.test(html), "Supabase key/url identifier present");
  assert.ok(!/\bapikey\b/.test(html), "apikey header present");
});
test("no Vapi or Textbelt key", () => {
  assert.ok(!/VAPI_KEY|VAPI_BASE/.test(html), "Vapi key/base present");
  assert.ok(!/TEXTBELT_KEY|textbelt\.com/.test(html), "Textbelt present");
});
test("no direct Supabase / Vapi provider call", () => {
  assert.ok(!/\/rest\/v1\//.test(html), "direct Supabase REST call");
  assert.ok(!/api\.vapi\.ai/.test(html), "direct Vapi call");
});
test("privileged data goes through the authenticated /api layer", () => {
  assert.match(html, /fetch\('\/api\/auth\/session'/);
  assert.match(html, /apiGet\('\/agents'\)/);
  assert.match(html, /apiGet\('\/leads\?mode=social-search/);
  assert.match(html, /apiGet\('\/leads\?mode=social-list/);
  assert.match(html, /apiGet\('\/leads\?mode=monitor-replied'\)/);
  assert.match(html, /apiGet\('\/vapi\/calls/);
  assert.match(html, /apiSend\('POST', '\/actions\/ai-generate'/);
  assert.match(html, /apiSend\('POST', '\/actions\/autocall'\)/);
  assert.match(html, /apiSend\('POST', '\/actions\/readmail'\)/);
});
test("actions attach CSRF; login gate present", () => {
  assert.match(html, /X-CSRF-Token/, "CSRF header wiring present");
  assert.match(html, /id="login-gate"/);
  assert.match(html, /apiLogin\(/);
  assert.match(html, /apiLogout\(/);
});
test("social-auth OAuth flow retained (server-side secret, no browser credential)", () => {
  assert.match(html, /\/\.netlify\/functions\/social-auth/, "OAuth entry retained");
  // ...but it must not carry any key/token in the browser
  assert.ok(!/social-auth[^'"]*(key|secret|token)=/i.test(html), "no secret in social-auth URL");
});
