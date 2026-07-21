/**
 * Security regression test for functions/inventory.js — run with:
 *   node --test tests/inventory.security.test.js
 * The Google service-account credential must come only from GOOGLE_CREDENTIALS
 * (matching the sibling booking functions); no hardcoded key may remain. Behavior,
 * routes, response shape, and callers are unchanged (asserted structurally).
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "functions", "inventory.js"), "utf8");

test("no hardcoded Google service-account private key", () => {
  assert.ok(!/BEGIN[A-Z ]*PRIVATE KEY/.test(src), "PRIVATE KEY literal present");
  assert.ok(!/private_key\s*:\s*['\"]/.test(src), "inline private_key literal present");
  assert.ok(!/private_key_id\s*:\s*['\"][A-Za-z0-9]/.test(src), "inline private_key_id present");
});
test("credential sourced from GOOGLE_CREDENTIALS (sibling pattern)", () => {
  assert.match(src, /JSON\.parse\(process\.env\.GOOGLE_CREDENTIALS \|\| ['"]\{\}['"]\)/);
});
test("behavior/shape preserved", () => {
  assert.match(src, /exports\.handler/, "handler still exported");
  assert.match(src, /new google\.auth\.GoogleAuth\(/, "GoogleAuth still used");
  assert.match(src, /scopes:\s*\[/, "scopes preserved");
  assert.match(src, /google\.sheets\(/, "Sheets client preserved");
  assert.match(src, /SPREADSHEET_IDS/, "spreadsheet targets preserved");
  assert.match(src, /body: JSON\.stringify\(\{ sheets:/, "response shape preserved");
});
