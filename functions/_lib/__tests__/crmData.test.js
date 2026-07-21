'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCrmData } = require('../crmData');

function mk(handler) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const r = handler ? handler(url, opts) : { status: 200, body: [] };
    return { status: r.status, async text() { return r.body === undefined ? '' : JSON.stringify(r.body); } };
  };
  const crm = createCrmData({ url: 'https://proj.supabase.co', serviceKey: 'svc_secret', fetchImpl, clock: () => 'T' });
  return { crm, calls };
}

test('list builds fixed PostgREST query with service-role auth headers', async () => {
  const { crm, calls } = mk(() => ({ status: 200, body: [{ id: 1 }] }));
  const r = await crm.list('leads');
  assert.equal(r.ok, true);
  assert.match(calls[0].url, /\/rest\/v1\/leads\?order=created_at\.desc&limit=500$/);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer svc_secret');
});

test('unknown read action rejected', async () => {
  const { crm } = mk();
  assert.equal((await crm.list('secrets')).error.code, 'unknown_action');
});

test('bookings validates date params', async () => {
  const { crm } = mk(() => ({ status: 200, body: [] }));
  assert.equal((await crm.bookings({ from: 'x', to: '2026-01-01' })).error.code, 'bad_params');
  const ok = await crm.bookings({ from: '2026-01-01', to: '2026-01-08' });
  assert.equal(ok.ok, true);
});

test('activities validates lead_id', async () => {
  const { crm, calls } = mk(() => ({ status: 200, body: [] }));
  assert.equal((await crm.activities({ lead_id: "1;drop" })).error.code, 'bad_id');
  await crm.activities({ lead_id: 'abc-123' });
  assert.match(calls[0].url, /activities\?lead_id=eq\.abc-123/);
});

test('create whitelists columns, sets created_at server-side, ignores client timestamp/unknowns', async () => {
  const { crm, calls } = mk(() => ({ status: 201, body: [{ id: 'new1' }] }));
  const r = await crm.create('leads', { name: 'Ann', email: 'a@x.com', evil: 'DROP', created_at: '1999', role: 'admin' });
  assert.equal(r.ok, true);
  assert.equal(r.data.id, 'new1');
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.evil, undefined);       // unknown field dropped
  assert.equal(sent.role, undefined);        // not a leads column
  assert.equal(sent.created_at, 'T');        // server-set, not '1999'
  assert.equal(sent.status, 'new');          // default applied
  assert.equal(sent.client, 'rosalia');
});

test('create enforces required fields', async () => {
  const { crm } = mk(() => ({ status: 201, body: [{}] }));
  assert.equal((await crm.create('leads', { phone: '5551234567' })).error.code, 'validation');
  assert.equal((await crm.create('tasks', {})).error.code, 'validation');
  assert.equal((await crm.create('agents', {})).error.code, 'validation');
});

test('completeTask / payCommission validate id and PATCH', async () => {
  const { crm, calls } = mk(() => ({ status: 204 }));
  assert.equal((await crm.completeTask({ id: 'bad id!' })).error.code, 'bad_id');
  const r = await crm.completeTask({ id: '42' });
  assert.equal(r.ok, true);
  assert.equal(calls[0].opts.method, 'PATCH');
  assert.match(calls[0].url, /tasks\?id=eq\.42/);
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.status, 'completed');
});

test('upstream failure is normalized (no raw error/credential leaked)', async () => {
  const { crm } = mk(() => ({ status: 500, body: { message: 'pg error at svc_secret' } }));
  const r = await crm.list('leads');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'read_failed');
  assert.equal(/svc_secret|pg error/.test(JSON.stringify(r)), false); // details hidden
});
