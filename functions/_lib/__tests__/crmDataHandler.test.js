'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// The handler reads env + global fetch. Configure both, then require it fresh.
function loadHandler() {
  delete require.cache[require.resolve('../../crm-data.js')];
  return require('../../crm-data.js').handler;
}
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  const savedFetch = global.fetch;
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    global.fetch = savedFetch;
  });
}
function stubFetch(status, body) {
  global.fetch = async () => ({ status, async text() { return JSON.stringify(body); } });
}

test('open by default (no CRM_API_TOKEN): GET leads works', async () => {
  await withEnv({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_KEY: 'svc', CRM_API_TOKEN: undefined }, async () => {
    stubFetch(200, [{ id: 1 }]);
    const handler = loadHandler();
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { action: 'leads' } });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).ok, true);
  });
});

test('when CRM_API_TOKEN set: missing/wrong token -> 401, correct -> 200', async () => {
  await withEnv({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_KEY: 'svc', CRM_API_TOKEN: 'secret-tok' }, async () => {
    stubFetch(200, []);
    const handler = loadHandler();
    const noTok = await handler({ httpMethod: 'GET', queryStringParameters: { action: 'leads' }, headers: {} });
    assert.equal(noTok.statusCode, 401);
    const wrong = await handler({ httpMethod: 'GET', queryStringParameters: { action: 'leads' }, headers: { 'x-crm-token': 'nope' } });
    assert.equal(wrong.statusCode, 401);
    const ok = await handler({ httpMethod: 'GET', queryStringParameters: { action: 'leads' }, headers: { 'x-crm-token': 'secret-tok' } });
    assert.equal(ok.statusCode, 200);
  });
});

test('invalid input -> 400; unknown action -> 400', async () => {
  await withEnv({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_KEY: 'svc', CRM_API_TOKEN: undefined }, async () => {
    stubFetch(201, [{}]);
    const handler = loadHandler();
    const bad = await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'createLead', data: { phone: '5551234567' } }) });
    assert.equal(bad.statusCode, 400);
    const unk = await handler({ httpMethod: 'GET', queryStringParameters: { action: 'nope' } });
    assert.equal(unk.statusCode, 400);
  });
});

test('response never contains the service-role key', async () => {
  await withEnv({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_KEY: 'svc-role-XYZ', CRM_API_TOKEN: undefined }, async () => {
    stubFetch(500, { message: 'boom svc-role-XYZ' });
    const handler = loadHandler();
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { action: 'leads' } });
    assert.equal(res.body.includes('svc-role-XYZ'), false);
  });
});
