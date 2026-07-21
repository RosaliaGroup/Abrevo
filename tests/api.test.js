/**
 * Tests for the authenticated operator API — run with:
 *   node --test tests/api.test.js
 * No live network (global.fetch mocked). No real credentials.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

const auth = require("../functions/lib/auth.js");

const PASSWORD = "correct-horse-battery";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.OPERATOR_USERNAME = "operator";
process.env.OPERATOR_PASSWORD_HASH = auth.hashPassword(PASSWORD); // minted here; no secret committed
process.env.OPERATOR_SESSION_SECRET = "test-session-secret-value";
process.env.URL = "https://site.example";
process.env.VAPI_KEY = "test-vapi-key";
process.env.TEXTBELT_KEY = "test-textbelt-key";

const { handler } = require("../functions/api.js");
const SECRET = process.env.OPERATOR_SESSION_SECRET;

// ---- fetch mock ----
function mkRes(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => (typeof body === "string" ? JSON.parse(text) : body), text: async () => text };
}
let calls;
function installFetch(scn = {}) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url); const method = (opts.method || "GET").toUpperCase();
    let body = null; try { body = opts.body ? JSON.parse(opts.body) : null; } catch {}
    calls.push({ u, method, body, headers: opts.headers });
    if (u.includes("/rest/v1/login_attempts?select=id")) return mkRes(200, Array.from({ length: scn.fails || 0 }, (_, i) => ({ id: i })));
    if (u.includes("/rest/v1/login_attempts") && method === "POST") return mkRes(201, "");
    if (u.includes("/rest/v1/login_attempts") && method === "DELETE") return mkRes(200, "");
    if (u.includes("/rest/v1/sms_sends?select=id") && u.includes("kind=eq.cancel-link")) return mkRes(200, Array.from({ length: scn.smsDup || 0 }, (_, i) => ({ id: i })));
    if (u.includes("/rest/v1/sms_sends?select=id")) return mkRes(200, Array.from({ length: scn.smsRate || 0 }, (_, i) => ({ id: i })));
    if (u.includes("/rest/v1/sms_sends") && method === "POST") return mkRes(201, "");
    if (u.includes("api.vapi.ai/call")) return scn.vapiStatus ? mkRes(scn.vapiStatus, "err") : mkRes(200, scn.vapi || [{ createdAt: "2026-07-20", status: "ended", endedReason: "ok", duration: 42, assistantId: "a1", assistant: { name: "Bot" }, secretField: "leak" }]);
    if (u.includes("textbelt.com/text")) return mkRes(200, scn.textbelt || { success: true });
    if (u.includes("/.netlify/functions/")) return mkRes(scn.actionStatus || 200, scn.action || { done: true });
    if (u.includes("/rest/v1/") && method === "GET") return scn.getStatus ? mkRes(scn.getStatus, "db error detail: relation leaked") : mkRes(200, scn.rows || [{ id: 1 }]);
    if (u.includes("/rest/v1/") && method === "PATCH") return mkRes(200, "");
    if (u.includes("/rest/v1/") && method === "POST") return mkRes(201, scn.insert || [{ id: 999 }]);
    throw new Error("unexpected fetch " + method + " " + u);
  };
}
beforeEach(() => installFetch());

const ev = (method, path, opts = {}) => ({ httpMethod: method, path, body: opts.body ? JSON.stringify(opts.body) : opts.raw, headers: opts.headers || {}, queryStringParameters: opts.qs || null });
const parse = (r) => ({ status: r.statusCode, body: JSON.parse(r.body || "{}"), setCookie: r.headers["Set-Cookie"] });

async function loginAndGet() {
  const r = await handler(ev("POST", "/api/auth/login", { body: { username: "operator", password: PASSWORD } }));
  const token = /(__session=)([^;]+)/.exec(r.headers["Set-Cookie"])[2];
  const csrf = JSON.parse(r.body).csrfToken;
  return { token, csrf, cookieHeader: `__session=${token}` };
}

// ---------- auth lib unit ----------
test("auth: scrypt verify accepts correct, rejects wrong (constant-time)", () => {
  const h = auth.hashPassword("abc");
  assert.equal(auth.verifyPassword("abc", h), true);
  assert.equal(auth.verifyPassword("abd", h), false);
});
test("auth: session sign/verify; tampering and expiry rejected", () => {
  const t = auth.signSession("operator", SECRET, 1000);
  assert.equal(auth.verifySession(t, SECRET).ok, true);
  assert.equal(auth.verifySession(t + "x", SECRET).ok, false);
  const expired = auth.signSession("operator", SECRET, 1000, Date.now() - 5000);
  assert.equal(auth.verifySession(expired, SECRET).ok, false);
});
test("auth: CSRF bound to session", () => {
  const t = auth.signSession("operator", SECRET);
  const c = auth.csrfToken(t, SECRET);
  assert.equal(auth.verifyCsrf(t, c, SECRET), true);
  assert.equal(auth.verifyCsrf(t, c + "x", SECRET), false);
  assert.equal(auth.verifyCsrf(auth.signSession("operator", SECRET, 1000, 1), c, SECRET), false);
});

// ---------- login ----------
test("login: wrong password -> 401 and records a failed attempt", async () => {
  const { status, body } = parse(await handler(ev("POST", "/api/auth/login", { body: { username: "operator", password: "nope" } })));
  assert.equal(status, 401); assert.equal(body.error, "invalid_credentials");
  assert.ok(calls.some((c) => c.u.includes("login_attempts") && c.method === "POST" && c.body.success === false));
});
test("login: success -> 200, secure cookie, csrf token", async () => {
  const r = await handler(ev("POST", "/api/auth/login", { body: { username: "operator", password: PASSWORD } }));
  const { status, body, setCookie } = parse(r);
  assert.equal(status, 200); assert.equal(body.ok, true); assert.ok(body.csrfToken);
  assert.match(setCookie, /__session=/);
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//); assert.match(setCookie, /Max-Age=28800/);
});
test("login: lockout after 5 failures -> 429 Retry-After", async () => {
  installFetch({ fails: 5 });
  const r = await handler(ev("POST", "/api/auth/login", { body: { username: "operator", password: PASSWORD } }));
  const { status, body } = parse(r);
  assert.equal(status, 429); assert.equal(body.error, "locked_out");
  assert.equal(r.headers["Retry-After"], "900");
});

// ---------- session endpoint ----------
test("session: no cookie -> 401; valid cookie -> 200 with user+csrf", async () => {
  assert.equal(parse(await handler(ev("GET", "/api/auth/session"))).status, 401);
  const { cookieHeader } = await loginAndGet();
  const { status, body } = parse(await handler(ev("GET", "/api/auth/session", { headers: { cookie: cookieHeader } })));
  assert.equal(status, 200); assert.equal(body.user, "operator"); assert.ok(body.csrfToken);
});

// ---------- protected reads ----------
test("reads: require a session (401 without)", async () => {
  for (const p of ["/api/listing-alerts", "/api/tasks", "/api/leads", "/api/bookings", "/api/system-health"]) {
    assert.equal(parse(await handler(ev("GET", p))).status, 401, p);
  }
});
test("reads: with session return data; listing-alerts uses fixed query", async () => {
  const { cookieHeader } = await loginAndGet();
  const { status, body } = parse(await handler(ev("GET", "/api/listing-alerts", { headers: { cookie: cookieHeader } })));
  assert.equal(status, 200); assert.equal(body.ok, true); assert.ok(Array.isArray(body.data));
  assert.ok(calls.some((c) => c.u.includes("/rest/v1/listing_alerts?select=*&order=received_at.desc&limit=50")));
});
test("leads: bad mode -> 400; search sanitizes and builds ilike; unreplied clamps since", async () => {
  const { cookieHeader } = await loginAndGet();
  assert.equal(parse(await handler(ev("GET", "/api/leads", { headers: { cookie: cookieHeader }, qs: { mode: "evil" } }))).status, 400);
  await handler(ev("GET", "/api/leads", { headers: { cookie: cookieHeader }, qs: { mode: "search", q: "bob,(*)=1" } }));
  const search = calls.find((c) => c.u.includes("or=(name.ilike"));
  assert.ok(search, "search query built");
  assert.ok(!/[(),*]=1/.test(decodeURIComponent(search.u)), "injection chars stripped");
  await handler(ev("GET", "/api/leads", { headers: { cookie: cookieHeader }, qs: { mode: "monitor-unreplied", since: "not-a-date" } }));
  assert.ok(calls.some((c) => c.u.includes("replied_at=is.null")));
});

// ---------- writes / CSRF ----------
test("task PATCH: needs session+CSRF; bad status rejected; resolved sets field", async () => {
  const { cookieHeader, csrf } = await loginAndGet();
  // no session
  assert.equal(parse(await handler(ev("PATCH", "/api/tasks/42"))).status, 401);
  // session but no CSRF
  assert.equal(parse(await handler(ev("PATCH", "/api/tasks/42", { headers: { cookie: cookieHeader }, body: { status: "resolved" } }))).status, 403);
  // bad status
  assert.equal(parse(await handler(ev("PATCH", "/api/tasks/42", { headers: { cookie: cookieHeader, "x-csrf-token": csrf }, body: { status: "deleted" } }))).status, 400);
  // ok
  const okr = parse(await handler(ev("PATCH", "/api/tasks/42", { headers: { cookie: cookieHeader, "x-csrf-token": csrf }, body: { status: "resolved" } })));
  assert.equal(okr.status, 200);
  const patch = calls.find((c) => c.method === "PATCH" && c.u.includes("/rest/v1/tasks?id=eq.42"));
  assert.equal(patch.body.status, "resolved"); assert.ok(patch.body.resolved_at);
});

// ---------- actions ----------
test("actions: allow-list enforced; authed proxy; CSRF required", async () => {
  const { cookieHeader, csrf } = await loginAndGet();
  assert.equal(parse(await handler(ev("POST", "/api/actions/autocall", { headers: { cookie: cookieHeader }, body: {} }))).status, 403); // no csrf
  assert.equal(parse(await handler(ev("POST", "/api/actions/rm-rf", { headers: { cookie: cookieHeader, "x-csrf-token": csrf }, body: {} }))).status, 400); // not allow-listed
  const okr = parse(await handler(ev("POST", "/api/actions/autocall", { headers: { cookie: cookieHeader, "x-csrf-token": csrf }, body: { x: 1 } })));
  assert.equal(okr.status, 200);
  assert.ok(calls.some((c) => c.u.includes("/.netlify/functions/autocall")));
});
test("actions: missing upstream (ai-generate) -> 502 action_unavailable", async () => {
  installFetch({ actionStatus: 404 });
  const { cookieHeader, csrf } = await loginAndGet();
  const r = parse(await handler(ev("POST", "/api/actions/ai-generate", { headers: { cookie: cookieHeader, "x-csrf-token": csrf }, body: {} })));
  assert.equal(r.status, 502); assert.equal(r.body.error, "action_unavailable");
});

// ---------- vapi calls ----------
test("vapi: unauthenticated -> 401", async () => {
  assert.equal(parse(await handler(ev("GET", "/api/vapi/calls"))).status, 401);
});
test("vapi: invalid filter -> 400; valid -> mapped, minimal fields, no key/raw leak", async () => {
  const { cookieHeader } = await loginAndGet();
  assert.equal(parse(await handler(ev("GET", "/api/vapi/calls", { headers: { cookie: cookieHeader }, qs: { assistantId: "x" } }))).status, 400);
  assert.equal(parse(await handler(ev("GET", "/api/vapi/calls", { headers: { cookie: cookieHeader }, qs: { limit: "9999" } }))).status, 400);
  const { status, body } = parse(await handler(ev("GET", "/api/vapi/calls", { headers: { cookie: cookieHeader }, qs: { limit: "100" } })));
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body.data[0]).sort(), ["assistant", "assistantId", "createdAt", "duration", "endedReason", "status"]);
  assert.ok(!("secretField" in body.data[0]), "extra provider fields dropped");
  const call = calls.find((c) => c.u.includes("api.vapi.ai"));
  assert.match(call.headers.Authorization, /Bearer /); // key used server-side only
});
test("vapi: provider failure -> controlled 502", async () => {
  installFetch({ vapiStatus: 500 });
  const { cookieHeader } = await loginAndGet();
  const r = parse(await handler(ev("GET", "/api/vapi/calls", { headers: { cookie: cookieHeader }, qs: {} })));
  assert.equal(r.status, 502); assert.equal(r.body.error, "provider_failed");
});

// ---------- cancel-link SMS ----------
test("sms cancel-link: needs session+CSRF; fixed template; invalid phone/link rejected; success; dup/rate 429", async () => {
  const { cookieHeader, csrf } = await loginAndGet();
  const good = { phone: "(646) 226-9189", name: "Jane Doe", url: "https://book.rosaliagroup.com/cancel?phone=1" };
  // no session
  assert.equal(parse(await handler(ev("POST", "/api/sms/cancel-link", { body: good }))).status, 401);
  // no CSRF
  assert.equal(parse(await handler(ev("POST", "/api/sms/cancel-link", { headers: { cookie: cookieHeader }, body: good }))).status, 403);
  const H = { cookie: cookieHeader, "x-csrf-token": csrf };
  // invalid phone
  assert.equal(parse(await handler(ev("POST", "/api/sms/cancel-link", { headers: H, body: { ...good, phone: "123" } }))).status, 400);
  // arbitrary link / message injection impossible: link must be approved prefix
  assert.equal(parse(await handler(ev("POST", "/api/sms/cancel-link", { headers: H, body: { ...good, url: "https://evil.example/x" } }))).status, 400);
  // success + server builds fixed template (browser message text is ignored entirely)
  const okr = parse(await handler(ev("POST", "/api/sms/cancel-link", { headers: H, body: { ...good, message: "PWNED arbitrary text" } })));
  assert.equal(okr.status, 200); assert.equal(okr.body.ok, true);
  const sent = calls.find((c) => c.u.includes("textbelt.com/text"));
  assert.match(sent.body.message, /here is your appointment management link/);
  assert.ok(!/PWNED/.test(sent.body.message), "browser-supplied text never used");
  assert.equal(sent.body.phone, "+16462269189");
});
test("sms cancel-link: duplicate within window -> 429", async () => {
  installFetch({ smsDup: 1 });
  const { cookieHeader, csrf } = await loginAndGet();
  const r = parse(await handler(ev("POST", "/api/sms/cancel-link", { headers: { cookie: cookieHeader, "x-csrf-token": csrf }, body: { phone: "6462269189", name: "J", url: "https://book.rosaliagroup.com/cancel" } })));
  assert.equal(r.status, 429); assert.equal(r.body.error, "duplicate_recent");
});
test("sms cancel-link: per-IP rate limit -> 429", async () => {
  installFetch({ smsRate: 20 });
  const { cookieHeader, csrf } = await loginAndGet();
  const r = parse(await handler(ev("POST", "/api/sms/cancel-link", { headers: { cookie: cookieHeader, "x-csrf-token": csrf }, body: { phone: "6462269189", name: "J", url: "https://book.rosaliagroup.com/cancel" } })));
  assert.equal(r.status, 429); assert.equal(r.body.error, "rate_limited");
});

// ---------- CRM reads ----------
test("crm reads: all require a session (401 without)", async () => {
  for (const p of ["/api/agents", "/api/deals", "/api/commissions", "/api/sequences", "/api/activities?lead_id=1", "/api/leads?mode=crm-list", "/api/bookings?mode=crm-week", "/api/tasks?sort=due"]) {
    assert.equal(parse(await handler(ev("GET", p))).status, 401, p);
  }
});
test("crm reads: with session return data; fixed queries; bad params -> 400", async () => {
  const { cookieHeader } = await loginAndGet();
  const H = { cookie: cookieHeader };
  assert.equal(parse(await handler(ev("GET", "/api/agents", { headers: H }))).status, 200);
  assert.equal(parse(await handler(ev("GET", "/api/leads", { headers: H, qs: { mode: "crm-list" } }))).status, 200);
  assert.ok(calls.some((c) => c.u.includes("leads?order=created_at.desc&limit=500&select=id,name")));
  assert.equal(parse(await handler(ev("GET", "/api/tasks", { headers: H, qs: { sort: "evil" } }))).status, 400);
  assert.equal(parse(await handler(ev("GET", "/api/activities", { headers: H, qs: {} }))).status, 400);
  assert.equal(parse(await handler(ev("GET", "/api/activities", { headers: H, qs: { lead_id: "a b" } }))).status, 400);
});
test("crm reads: database failure -> controlled 502, no raw error leaked", async () => {
  installFetch({ getStatus: 500 });
  const { cookieHeader } = await loginAndGet();
  const r = parse(await handler(ev("GET", "/api/deals", { headers: { cookie: cookieHeader } })));
  assert.equal(r.status, 502); assert.equal(r.body.error, "upstream_failed");
  assert.ok(!/relation|db error/.test(JSON.stringify(r.body)), "no raw DB error leaked");
});

// ---------- CRM writes: PATCH ----------
test("complete task (status=completed): needs CSRF; sets completed_at", async () => {
  const { cookieHeader, csrf } = await loginAndGet();
  assert.equal(parse(await handler(ev("PATCH", "/api/tasks/7", { headers: { cookie: cookieHeader }, body: { status: "completed" } }))).status, 403);
  const okr = parse(await handler(ev("PATCH", "/api/tasks/7", { headers: { cookie: cookieHeader, "x-csrf-token": csrf }, body: { status: "completed" } })));
  assert.equal(okr.status, 200);
  const patch = calls.find((c) => c.method === "PATCH" && c.u.includes("/rest/v1/tasks?id=eq.7"));
  assert.equal(patch.body.status, "completed"); assert.ok(patch.body.completed_at);
});
test("mark commission paid: CSRF required; bad status 400; ok sets paid_at", async () => {
  const { cookieHeader, csrf } = await loginAndGet();
  assert.equal(parse(await handler(ev("PATCH", "/api/commissions/3", { headers: { cookie: cookieHeader }, body: { status: "paid" } }))).status, 403);
  assert.equal(parse(await handler(ev("PATCH", "/api/commissions/3", { headers: { cookie: cookieHeader, "x-csrf-token": csrf }, body: { status: "void" } }))).status, 400);
  const okr = parse(await handler(ev("PATCH", "/api/commissions/3", { headers: { cookie: cookieHeader, "x-csrf-token": csrf }, body: { status: "paid" } })));
  assert.equal(okr.status, 200);
  const patch = calls.find((c) => c.method === "PATCH" && c.u.includes("/rest/v1/commissions?id=eq.3"));
  assert.equal(patch.body.status, "paid"); assert.ok(patch.body.paid_at);
});

// ---------- CRM writes: creates ----------
test("create lead: CSRF; name required; source allow-list; server-set fields; allow-list enforced", async () => {
  const { cookieHeader, csrf } = await loginAndGet();
  const H = { cookie: cookieHeader, "x-csrf-token": csrf };
  assert.equal(parse(await handler(ev("POST", "/api/leads", { headers: { cookie: cookieHeader }, body: { name: "A" } }))).status, 403); // no csrf
  assert.equal(parse(await handler(ev("POST", "/api/leads", { headers: H, body: { email: "a@b.com" } }))).status, 400); // no name
  assert.equal(parse(await handler(ev("POST", "/api/leads", { headers: H, body: { name: "A", source: "haxor" } }))).status, 400); // bad source
  const okr = parse(await handler(ev("POST", "/api/leads", { headers: H, body: { name: "Jane", email: "jane@x.com", source: "zillow", client: "HACK", status: "admin", evilField: "x" } })));
  assert.equal(okr.status, 200); assert.equal(okr.body.id, 999);
  const ins = calls.find((c) => c.method === "POST" && c.u.endsWith("/rest/v1/leads"));
  assert.equal(ins.body.client, "rosalia"); // server-set, not the injected "HACK"
  assert.equal(ins.body.status, "new");     // server-set, not "admin"
  assert.ok(!("evilField" in ins.body), "unknown field dropped");
});
test("create deal: stage required + allow-listed; numeric rent", async () => {
  const { cookieHeader, csrf } = await loginAndGet();
  const H = { cookie: cookieHeader, "x-csrf-token": csrf };
  assert.equal(parse(await handler(ev("POST", "/api/deals", { headers: H, body: { property: "X" } }))).status, 400); // stage required
  assert.equal(parse(await handler(ev("POST", "/api/deals", { headers: H, body: { stage: "nonsense" } }))).status, 400);
  assert.equal(parse(await handler(ev("POST", "/api/deals", { headers: H, body: { stage: "toured", monthly_rent: "abc" } }))).status, 400);
  assert.equal(parse(await handler(ev("POST", "/api/deals", { headers: H, body: { stage: "toured", monthly_rent: 2500, lead_id: "9" } }))).status, 200);
});
test("create task: title required; priority allow-list; status server-set", async () => {
  const { cookieHeader, csrf } = await loginAndGet();
  const H = { cookie: cookieHeader, "x-csrf-token": csrf };
  assert.equal(parse(await handler(ev("POST", "/api/tasks", { headers: H, body: { priority: "high" } }))).status, 400); // no title
  assert.equal(parse(await handler(ev("POST", "/api/tasks", { headers: H, body: { title: "T", priority: "URGENT" } }))).status, 400);
  const okr = parse(await handler(ev("POST", "/api/tasks", { headers: H, body: { title: "Call Jane", priority: "high", status: "done-by-hacker" } })));
  assert.equal(okr.status, 200);
  const ins = calls.find((c) => c.method === "POST" && c.u.endsWith("/rest/v1/tasks"));
  assert.equal(ins.body.status, "pending"); // server-set
});
test("create agent: name required; role allow-list", async () => {
  const { cookieHeader, csrf } = await loginAndGet();
  const H = { cookie: cookieHeader, "x-csrf-token": csrf };
  assert.equal(parse(await handler(ev("POST", "/api/agents", { headers: H, body: { email: "a@b.com" } }))).status, 400); // no name
  assert.equal(parse(await handler(ev("POST", "/api/agents", { headers: H, body: { name: "A", role: "superadmin" } }))).status, 400);
  assert.equal(parse(await handler(ev("POST", "/api/agents", { headers: H, body: { name: "Ana", role: "manager" } }))).status, 200);
});

// ---------- logout / config ----------
test("logout clears the cookie", async () => {
  const r = await handler(ev("POST", "/api/auth/logout"));
  assert.match(r.headers["Set-Cookie"], /__session=;/);
  assert.match(r.headers["Set-Cookie"], /Max-Age=0/);
});
test("missing env -> 500 server_not_configured", async () => {
  const saved = process.env.OPERATOR_SESSION_SECRET; delete process.env.OPERATOR_SESSION_SECRET;
  try { assert.equal(parse(await handler(ev("GET", "/api/tasks"))).status, 500); }
  finally { process.env.OPERATOR_SESSION_SECRET = saved; }
});

// ---------- no secret leakage in source ----------
test("api.js and auth.js contain no hardcoded credentials", () => {
  const fs = require("node:fs"), path = require("node:path");
  for (const f of ["../functions/api.js", "../functions/lib/auth.js"]) {
    const src = fs.readFileSync(path.join(__dirname, f), "utf8");
    assert.ok(!/eyJ[A-Za-z0-9_.-]{20,}/.test(src), `${f} JWT literal`);
    assert.ok(!/[0-9a-f]{40,}/i.test(src), `${f} long hex secret`);
  }
});
