'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupabaseRepo, UniqueViolationError } = require('../supabaseRepo');

function mockRes(status, bodyObj) {
  return { status, async text() { return bodyObj === undefined ? '' : JSON.stringify(bodyObj); } };
}

test('requires url and service key', () => {
  assert.throws(() => createSupabaseRepo({ url: '', serviceKey: '', fetchImpl: async () => {} }));
});

test('getConversationByPhone builds a PostgREST eq filter with auth headers', async () => {
  const calls = [];
  const repo = createSupabaseRepo({
    url: 'https://proj.supabase.co', serviceKey: 'svc_key',
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return mockRes(200, []); },
  });
  const r = await repo.getConversationByPhone('+15551234567');
  assert.equal(r, null);
  assert.match(calls[0].url, /\/rest\/v1\/conversations\?normalized_phone=eq\.%2B15551234567&limit=1$/);
  assert.equal(calls[0].opts.headers.apikey, 'svc_key');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer svc_key');
});

test('insertConversation maps HTTP 409 to UniqueViolationError', async () => {
  const repo = createSupabaseRepo({
    url: 'https://proj.supabase.co', serviceKey: 'svc_key',
    fetchImpl: async () => mockRes(409, { code: '23505', message: 'duplicate key' }),
  });
  await assert.rejects(
    () => repo.insertConversation({ normalized_phone: '+15551234567' }),
    (e) => e instanceof UniqueViolationError,
  );
});

test('insertLinkIfAbsent returns null on 409 (already linked)', async () => {
  const repo = createSupabaseRepo({
    url: 'https://proj.supabase.co', serviceKey: 'svc_key',
    fetchImpl: async () => mockRes(409, {}),
  });
  const r = await repo.insertLinkIfAbsent({ conversation_id: 'c1', entity_type: 'lead', entity_id: 7 });
  assert.equal(r, null);
});

test('insertConversation returns the representation row on 201', async () => {
  const repo = createSupabaseRepo({
    url: 'https://proj.supabase.co', serviceKey: 'svc_key',
    fetchImpl: async () => mockRes(201, [{ id: 'c9', normalized_phone: '+15551234567' }]),
  });
  const row = await repo.insertConversation({ normalized_phone: '+15551234567', created_by: 'test' });
  assert.equal(row.id, 'c9');
});
