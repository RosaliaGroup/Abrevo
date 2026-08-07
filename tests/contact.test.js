/**
 * Tests for functions/contact.js — run with:  node --test tests/contact.test.js
 * No live network: global.fetch is mocked. No real credentials are used.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "test-service-key"; // dummy — never a real key
process.env.NOTIFY_PHONE = "+16462269189"; // Ana's cell — a recognized internal number
// Telnyx creds for lib/sms.js. Dummies only — global.fetch is mocked, nothing leaves the process.
process.env.TELNYX_API_KEY = "test-telnyx-key";
process.env.TELNYX_FROM_ROSALIA = "+12014269354";
process.env.TELNYX_MESSAGING_PROFILE_ID = "test-profile";
process.env.SUPABASE_SERVICE_KEY = "test-service-key"; // used by lib/sms threadLog (best-effort)

const { handler } = require("../functions/contact.js");

function mkRes(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(text) : body),
    text: async () => text,
  };
}

function installFetch(scenario = {}) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    let body = null;
    try {
      body = opts.body ? JSON.parse(opts.body) : null;
    } catch {}
    const u = String(url);
    calls.push({ url: u, method, body });
    // SMS now goes via lib/sms.js -> Telnyx. scenario.smsFail drives a provider failure.
    if (u.includes("api.telnyx.com"))
      return scenario.smsFail
        ? mkRes(400, { errors: [{ detail: "quota" }] })
        : mkRes(200, { data: { id: "tx_test_1" } });
    if (u.includes("/rest/v1/leads?email=eq"))
      return scenario.lookupError ? mkRes(500, "err") : mkRes(200, scenario.emailLookup ?? []);
    if (u.includes("/rest/v1/leads?phone=ilike"))
      return scenario.lookupError ? mkRes(500, "err") : mkRes(200, scenario.phoneLookup ?? []);
    if (u.includes("/rest/v1/leads?id=eq") && method === "PATCH")
      return scenario.patchError ? mkRes(500, "err") : mkRes(200, scenario.patch ?? [{ id: 201 }]);
    if (u.endsWith("/rest/v1/leads") && method === "POST")
      return scenario.insertError ? mkRes(500, "err") : mkRes(201, scenario.insert ?? [{ id: 101 }]);
    // Any other Supabase REST call is lib/sms.js threadLog (best-effort, fail-open).
    // Return empty so it no-ops without throwing.
    if (u.includes("/rest/v1/")) return mkRes(200, []);
    throw new Error("unexpected fetch: " + method + " " + u);
  };
  return calls;
}

const POST = (obj) => ({ httpMethod: "POST", body: JSON.stringify(obj) });
const parse = (r) => ({ status: r.statusCode, body: JSON.parse(r.body || "{}") });

let calls;
beforeEach(() => {
  calls = null;
});

test("new lead by email — inserts one, correct mapping, no replied_at/email_reply", async () => {
  calls = installFetch({ insert: [{ id: 101 }] });
  const { status, body } = parse(await handler(POST({ name: "Jane Smith", email: "  Jane@Example.COM ", message: "Hi there" })));
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.lead_id, 101);
  assert.equal(body.merged, false);
  const insert = calls.find((c) => c.method === "POST" && c.url.endsWith("/rest/v1/leads"));
  assert.ok(insert, "insert POST made");
  assert.equal(insert.body.email, "jane@example.com"); // normalized
  assert.equal(insert.body.source, "website-contact");
  assert.equal(insert.body.client, "rosalia");
  assert.equal(insert.body.status, "new");
  assert.equal(insert.body.follow_up_count, 0);
  assert.ok(!("replied_at" in insert.body), "replied_at not set");
  assert.ok(!("email_reply" in insert.body), "email_reply not set");
  assert.match(insert.body.notes, /website-contact:/);
});

test("new lead by phone — no email, phone normalized to +1", async () => {
  calls = installFetch({ insert: [{ id: 102 }] });
  const { status, body } = parse(await handler(POST({ name: "Bob", phone: "(646) 226-9189", message: "call me" })));
  assert.equal(status, 200);
  assert.equal(body.lead_id, 102);
  assert.equal(body.merged, false);
  const insert = calls.find((c) => c.method === "POST" && c.url.endsWith("/rest/v1/leads"));
  assert.equal(insert.body.phone, "+16462269189");
  assert.equal(insert.body.email, null);
});

test("existing lead by email — PATCH merge, note appended, status/source/replied_at untouched, no insert", async () => {
  calls = installFetch({
    emailLookup: [{ id: 201, notes: "prior note", status: "contacted", source: "phone", email: "jane@example.com", phone: "+16460000000" }],
    patch: [{ id: 201 }],
  });
  const { status, body } = parse(await handler(POST({ name: "Jane", email: "jane@example.com", message: "second inquiry" })));
  assert.equal(status, 200);
  assert.equal(body.merged, true);
  assert.equal(body.lead_id, 201);
  assert.ok(!calls.some((c) => c.method === "POST" && c.url.endsWith("/rest/v1/leads")), "no duplicate insert");
  const patch = calls.find((c) => c.method === "PATCH");
  assert.ok(patch, "patch made");
  assert.match(patch.body.notes, /prior note/);
  assert.match(patch.body.notes, /website-contact:/);
  assert.ok(!("status" in patch.body), "status not overwritten");
  assert.ok(!("source" in patch.body), "source not overwritten");
  assert.ok(!("replied_at" in patch.body), "replied_at not set");
  assert.ok(!("email_reply" in patch.body), "email_reply not set");
});

test("existing lead by normalized phone (last 10) — merge, lookup uses last 10 digits", async () => {
  calls = installFetch({ phoneLookup: [{ id: 202, notes: null }], patch: [{ id: 202 }] });
  const { status, body } = parse(await handler(POST({ name: "Carl", phone: "1 (646) 226-9189", message: "hi" })));
  assert.equal(status, 200);
  assert.equal(body.merged, true);
  assert.equal(body.lead_id, 202);
  const lookup = calls.find((c) => c.url.includes("/rest/v1/leads?phone=ilike"));
  assert.ok(lookup.url.includes("6462269189"), "phone lookup uses last 10 digits");
});

test("missing email AND phone — 400, nothing written", async () => {
  calls = installFetch();
  const { status, body } = parse(await handler(POST({ name: "NoContact", message: "hello" })));
  assert.equal(status, 400);
  assert.equal(body.error, "missing_contact_method");
  assert.equal(calls.length, 0);
});

test("invalid email (no valid phone) — 400 invalid_email", async () => {
  calls = installFetch();
  const { status, body } = parse(await handler(POST({ name: "X", email: "not-an-email", message: "hi" })));
  assert.equal(status, 400);
  assert.equal(body.error, "invalid_email");
});

test("oversized field — 400 field_too_large", async () => {
  calls = installFetch();
  const big = "x".repeat(5001);
  const { status, body } = parse(await handler(POST({ name: "X", email: "a@b.com", message: big })));
  assert.equal(status, 400);
  assert.equal(body.error, "field_too_large");
});

test("Supabase insert error — safe 502, success false", async () => {
  calls = installFetch({ insertError: true });
  const { status, body } = parse(await handler(POST({ name: "Jane", email: "jane@example.com", message: "hi" })));
  assert.equal(status, 502);
  assert.equal(body.success, false);
  assert.equal(body.error, "save_failed");
});

test("SMS failure does NOT fail a saved lead", async () => {
  calls = installFetch({ insert: [{ id: 133 }], smsFail: true });
  const { status, body } = parse(await handler(POST({ name: "Jane", email: "jane@example.com", message: "hi" })));
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.lead_id, 133);
  assert.equal(body.sms_notified, false);
  assert.ok(calls.some((c) => c.url.includes("api.telnyx.com")), "provider send was attempted");
});

test("missing SMS config (no NOTIFY_PHONE) — lead still saved, 200, no SMS attempt", async () => {
  const savedPhone = process.env.NOTIFY_PHONE;
  delete process.env.NOTIFY_PHONE;
  try {
    calls = installFetch({ insert: [{ id: 144 }] });
    const { status, body } = parse(await handler(POST({ name: "Jane", email: "jane@example.com", message: "hi" })));
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.lead_id, 144);
    assert.equal(body.sms_notified, false);
    assert.ok(!calls.some((c) => c.url.includes("api.telnyx.com")), "no SMS attempt when unconfigured");
  } finally {
    process.env.NOTIFY_PHONE = savedPhone;
  }
});

test("OPTIONS preflight — 204 with CORS headers", async () => {
  const r = await handler({ httpMethod: "OPTIONS" });
  assert.equal(r.statusCode, 204);
  assert.equal(r.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(r.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
  assert.equal(r.headers["Access-Control-Allow-Headers"], "Content-Type");
});

test("POST response carries CORS headers", async () => {
  installFetch({ insert: [{ id: 1 }] });
  const r = await handler(POST({ name: "A", email: "a@b.com", message: "hi" }));
  assert.equal(r.headers["Access-Control-Allow-Origin"], "*");
});

test("source file contains no hardcoded credentials", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "functions", "contact.js"), "utf8");
  assert.ok(!/eyJ[A-Za-z0-9_.-]{20,}/.test(src), "no JWT literal in source");
  assert.ok(!/[0-9a-f]{40,}/i.test(src), "no long hex secret in source");
  assert.ok(src.includes("process.env.SUPABASE_KEY"), "reads SUPABASE_KEY from env");
  assert.ok(src.includes("process.env.SUPABASE_URL"), "reads SUPABASE_URL from env");
  assert.ok(src.includes("process.env.NOTIFY_PHONE"), "reads NOTIFY_PHONE from env");
  assert.ok(src.includes('require("./lib/sms")'), "sends via shared lib/sms.js");
  assert.ok(!/textbelt/i.test(src), "no Textbelt reference remains");
});
