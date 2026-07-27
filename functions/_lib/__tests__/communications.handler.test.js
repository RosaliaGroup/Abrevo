'use strict';
/**
 * Handler-level authentication tests for functions/communications.js.
 *
 * Proves the operator-session gate rejects unauthenticated / unauthorized /
 * malformed requests BEFORE the privileged context is constructed or any
 * Supabase/Telnyx call is made. All DB/provider work is stubbed via an injected
 * context factory; no real network occurs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../../lib/auth');
const { makeHandler } = require('../../communications');

const SECRET = 'test-operator-secret';
process.env.OPERATOR_SESSION_SECRET = SECRET;

function session() {
  const token = auth.signSession('operator', SECRET);
  return { token, csrf: auth.csrfToken(token, SECRET) };
}
function evt({ method = 'POST', body = null, cookie = null, csrf = null, query = null } = {}) {
  const headers = {};
  if (cookie) headers.cookie = `__session=${cookie}`;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return { httpMethod: method, headers, body: body ? JSON.stringify(body) : null, queryStringParameters: query };
}
// Context factory spy: records whether it was constructed and which api methods ran.
function spy() {
  const state = { built: 0, calls: [] };
  const rec = (name) => async (args) => { state.calls.push({ name, args }); return { ok: true, id: 'x', conversations: [], messages: [] }; };
  const ctx = { commApi: {
    listConversations: rec('listConversations'), getThread: rec('getThread'), getMessageStatus: rec('getMessageStatus'),
    findOrCreateConversation: rec('findOrCreate'), addLink: rec('addLink'), sendMessage: rec('send'), markRead: rec('markRead'),
  } };
  const makeContext = () => { state.built++; return ctx; };
  return { state, makeContext };
}
const SEND = { action: 'send', phone: '+15551234567', body: 'hi' };

// A1 + A4: missing session rejected before any context/DB/provider work.
test('A1/A4 missing session -> 401 before context is built or api is called', async () => {
  const s = spy();
  const res = await makeHandler({ makeContext: s.makeContext })(evt({ body: SEND }));
  assert.equal(res.statusCode, 401);
  assert.match(res.body, /unauthenticated/);
  assert.equal(s.state.built, 0);
  assert.equal(s.state.calls.length, 0);
});

// A2: invalid/garbage session token rejected.
test('A2 invalid session token -> 401, no side effects', async () => {
  const s = spy();
  const res = await makeHandler({ makeContext: s.makeContext })(evt({ body: SEND, cookie: 'garbage.token', csrf: 'x' }));
  assert.equal(res.statusCode, 401);
  assert.equal(s.state.built, 0);
  assert.equal(s.state.calls.length, 0);
});

// A3: valid session + CSRF reaches the handler and dispatches.
test('A3 valid session + CSRF -> send dispatched (200)', async () => {
  const s = spy(); const sess = session();
  const res = await makeHandler({ makeContext: s.makeContext })(evt({ body: SEND, cookie: sess.token, csrf: sess.csrf }));
  assert.equal(res.statusCode, 200);
  assert.equal(s.state.built, 1);
  assert.equal(s.state.calls[0].name, 'send');
  assert.equal(s.state.calls[0].args.phone, '+15551234567');
});

// A7 + A4: authenticated but missing CSRF on a mutation (a browser cross-site
// request cannot read the session-bound CSRF) -> 403 before any api call.
test('A7 mutation without CSRF -> 403, no send', async () => {
  const s = spy(); const sess = session();
  const res = await makeHandler({ makeContext: s.makeContext })(evt({ body: SEND, cookie: sess.token /* no csrf */ }));
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /csrf_failed/);
  assert.equal(s.state.built, 0);
  assert.equal(s.state.calls.length, 0);
});

// A5: unknown action rejected.
test('A5 unknown action -> 400', async () => {
  const s = spy(); const sess = session();
  const res = await makeHandler({ makeContext: s.makeContext })(evt({ body: { action: 'bogus' }, cookie: sess.token, csrf: sess.csrf }));
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /unknown_action/);
  assert.equal(s.state.calls.length, 0);
});

// A6: unsupported method for an action (POST-only action requested via GET) and
// an entirely unsupported verb.
test('A6 method mismatch -> 405', async () => {
  const s = spy(); const sess = session();
  const asGet = await makeHandler({ makeContext: s.makeContext })(evt({ method: 'GET', query: { action: 'send' }, cookie: sess.token }));
  assert.equal(asGet.statusCode, 405);
  const asDelete = await makeHandler({ makeContext: s.makeContext })(evt({ method: 'DELETE', cookie: sess.token }));
  assert.equal(asDelete.statusCode, 405);
  assert.equal(s.state.calls.length, 0);
});

// Read action still requires a session, and succeeds with one.
test('read action requires session; succeeds with valid session', async () => {
  const s = spy(); const sess = session();
  const anon = await makeHandler({ makeContext: s.makeContext })(evt({ method: 'GET', query: { action: 'listConversations' } }));
  assert.equal(anon.statusCode, 401);
  const ok = await makeHandler({ makeContext: s.makeContext })(evt({ method: 'GET', query: { action: 'listConversations' }, cookie: sess.token }));
  assert.equal(ok.statusCode, 200);
  assert.equal(s.state.calls.at(-1).name, 'listConversations');
});

// Fail-closed: missing session secret -> 500, never open.
test('missing OPERATOR_SESSION_SECRET fails closed (500), not open', async () => {
  const s = spy(); const sess = session();
  const saved = process.env.OPERATOR_SESSION_SECRET;
  delete process.env.OPERATOR_SESSION_SECRET;
  try {
    const res = await makeHandler({ makeContext: s.makeContext })(evt({ body: SEND, cookie: sess.token, csrf: sess.csrf }));
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /server_not_configured/);
    assert.equal(s.state.built, 0);
  } finally { process.env.OPERATOR_SESSION_SECRET = saved; }
});

// Bounded request size.
test('oversized body -> 413 before auth work', async () => {
  const s = spy();
  const big = { httpMethod: 'POST', headers: {}, body: 'x'.repeat(64 * 1024 + 1) };
  const res = await makeHandler({ makeContext: s.makeContext })(big);
  assert.equal(res.statusCode, 413);
  assert.equal(s.state.built, 0);
});
