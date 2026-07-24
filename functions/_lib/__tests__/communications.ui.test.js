'use strict';
/**
 * Behavioral + static tests for the communications.html client script.
 *
 * The page's inline <script> is loaded into a vm sandbox with stubbed globals
 * (fetch/document/URLSearchParams). No jsdom dependency, no real network. The
 * top-level `function` declarations become callable in the sandbox, so the CSRF
 * helper (api/bootstrapSession/setAuthState/canMutate) can be exercised directly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'communications.html'), 'utf8');
const SCRIPT = (HTML.match(/<script>([\s\S]*?)<\/script>/) || [])[1];

function makeEl() {
  return { style: {}, dataset: {}, disabled: false, value: '', innerHTML: '', textContent: '',
    scrollTop: 0, scrollHeight: 0, onclick: null, querySelectorAll: () => [], addEventListener: () => {} };
}
function makeDocument() {
  const els = {};
  return { getElementById: (id) => (els[id] || (els[id] = makeEl())), addEventListener: () => {}, querySelectorAll: () => [] };
}
function res(status, body) { return { status, json: async () => body }; }
async function tick() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

// Load the page script with an initial fetch implementation; returns the sandbox.
async function loadPage(initialFetch) {
  const calls = [];
  let impl = initialFetch;
  const fetch = (url, opts) => { calls.push({ url, opts: opts || {} }); return impl(url, opts || {}); };
  const logs = [];
  const ctx = vm.createContext({
    fetch, document: makeDocument(), URLSearchParams, Date,
    console: { log: (...a) => logs.push(a.join(' ')), warn: () => {}, error: () => {} },
  });
  vm.runInContext(SCRIPT, ctx);
  await tick(); // let the init IIFE settle
  return { ctx, calls, logs, setFetch: (f) => { impl = f; } };
}

const sessionOk = (csrf) => (url) => url.includes('/api/auth/session') ? res(200, { ok: true, user: 'op', csrfToken: csrf }) : res(200, { ok: true, conversations: [], messages: [] });
const session401 = (url) => url.includes('/api/auth/session') ? res(401, { ok: false, error: 'unauthenticated' }) : res(200, { ok: true, conversations: [] });

// (1)(2) init requests the session endpoint with same-origin credentials.
test('init requests /api/auth/session with same-origin credentials', async () => {
  const p = await loadPage(sessionOk('CSRF123'));
  const first = p.calls[0];
  assert.match(first.url, /\/api\/auth\/session/);
  assert.equal(first.opts.credentials, 'same-origin');
});

// (3)(9) mutation attaches X-CSRF-Token (header only, not in URL/body/logs).
test('mutation attaches X-CSRF-Token header, token never in URL or logs', async () => {
  const p = await loadPage(sessionOk('CSRF123'));
  p.calls.length = 0;
  await p.ctx.api('send', { method: 'POST', body: { conversationId: 'c1', body: 'hi', idempotencyKey: 'k' } });
  const c = p.calls.find((x) => String(x.url).includes('communications'));
  assert.ok(c, 'comms request made');
  assert.equal(c.opts.method, 'POST');
  assert.equal(c.opts.credentials, 'same-origin');
  assert.equal(c.opts.headers['X-CSRF-Token'], 'CSRF123');
  assert.equal(c.opts.headers['Content-Type'], 'application/json');
  assert.doesNotMatch(String(c.url), /CSRF123/);         // token not in URL
  assert.doesNotMatch(String(c.opts.body || ''), /CSRF123/); // token not in body
  assert.ok(!p.logs.join('\n').includes('CSRF123'));      // token not logged
});

// (4) read (GET) carries no CSRF token.
test('read GET carries no CSRF token', async () => {
  const p = await loadPage(sessionOk('CSRF123'));
  p.calls.length = 0;
  await p.ctx.api('listConversations', { query: { limit: 50 } });
  const c = p.calls.find((x) => String(x.url).includes('communications'));
  assert.match(String(c.url), /\?action=listConversations/);
  assert.ok(!c.opts.headers || c.opts.headers['X-CSRF-Token'] === undefined);
  assert.equal(c.opts.credentials, 'same-origin');
});

// (5) no mutation is emitted when the token is absent (fail closed).
test('no mutation fetch when token absent', async () => {
  const p = await loadPage(session401);
  p.calls.length = 0;
  const r = await p.ctx.api('send', { method: 'POST', body: { conversationId: 'c1', body: 'hi' } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'no_session');
  assert.equal(p.calls.filter((x) => String(x.url).includes('communications')).length, 0);
});

// (6) mutation controls disabled + banner shown when session verification fails.
test('controls disabled and banner shown when unauthenticated', async () => {
  const p = await loadPage(session401);
  assert.equal(p.ctx.document.getElementById('new-btn').disabled, true);
  assert.equal(p.ctx.document.getElementById('auth-banner').style.display, 'block');
  assert.equal(p.ctx.canMutate(), false);
});

// (7) a 401 on a mutation clears auth state (subsequent mutation fails closed).
test('401 clears auth state; next mutation fails closed', async () => {
  const p = await loadPage(sessionOk('CSRF123'));
  assert.equal(p.ctx.canMutate(), true);
  p.setFetch((url) => url.includes('communications') ? res(401, { ok: false }) : res(200, { ok: true }));
  const r1 = await p.ctx.api('send', { method: 'POST', body: { conversationId: 'c1', body: 'x' } });
  assert.equal(r1.status, 401);
  assert.equal(p.ctx.canMutate(), false);               // token cleared by onAuthLost
  assert.equal(p.ctx.document.getElementById('new-btn').disabled, true);
  p.calls.length = 0;
  const r2 = await p.ctx.api('send', { method: 'POST', body: { conversationId: 'c1', body: 'y' } });
  assert.equal(r2.error.code, 'no_session');
  assert.equal(p.calls.length, 0);                      // no fetch attempted
});

// (8) a 403 does NOT trigger an automatic retry.
test('403 does not auto-retry the mutation', async () => {
  const p = await loadPage(sessionOk('CSRF123'));
  p.calls.length = 0;
  p.setFetch((url) => url.includes('communications') ? res(403, { ok: false }) : res(200, { ok: true }));
  const r = await p.ctx.api('send', { method: 'POST', body: { conversationId: 'c1', body: 'x' } });
  assert.equal(r.status, 403);
  assert.equal(r.error.code, 'forbidden');
  assert.equal(p.calls.filter((x) => String(x.url).includes('communications')).length, 1); // exactly one attempt
});

// (9 static)(10) hygiene + no credentials in the page.
test('static: no storage/console token leak; no provider credentials in page', async () => {
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(SCRIPT), 'no web storage / cookie access');
  assert.equal((SCRIPT.match(/fetch\(/g) || []).length, 2, 'exactly two centralized fetch sites');
  assert.equal((SCRIPT.match(/credentials: *'same-origin'/g) || []).length, 2, 'both fetches are same-origin');
  // no privileged credential literal anywhere in the page
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/.test(HTML), 'no JWT literal');
  assert.ok(!/service_role|SUPABASE_KEY|TELNYX_API_KEY|TEXTBELT_KEY|VAPI_KEY/.test(HTML), 'no provider key identifier');
  assert.ok(!/textbelt\.com|api\.telnyx\.com|api\.twilio\.com/.test(HTML), 'no direct provider endpoint');
});
