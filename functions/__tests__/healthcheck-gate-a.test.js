'use strict';
/**
 * Gate A healthcheck + inventory-safety unit tests.
 * Runner: node --test (no external dependencies).
 *
 * Proves the safety properties required by the Gate A healthcheck task:
 *  1  no healthcheck path calls operational function URLs
 *  2  no operational POST occurs
 *  3  dry-run is side-effect-free
 *  4  unknown scheduler execution remains unknown
 *  5  unknown is never persisted as true
 *  6  business-activity freshness is separate from scheduler execution
 *  7  a failed Supabase write is reported as failed
 *  8  raw provider / Google / Supabase errors are sanitized
 *  9  inventory rows and credentials are never returned
 * 10  the UI handles 401 / 403 / non-JSON / non-2xx
 */
const { test } = require('node:test');
const assert = require('node:assert');

const worker = require('../_healthcheck-worker');
const inventory = require('../_inventory-check');
const admin = require('../admin-healthcheck-run');
const ui = require('../../healthcheck-ui');

// Substrings that must NEVER be fetched by any read-only healthcheck path.
const OPERATIONAL_URL_MARKERS = [
  '/functions/readmail',
  '/functions/autocall',
  '/functions/inventory',
  '/functions/book',
  '/functions/sendemail',
  '/functions/bulkemail',
  '/functions/outbound',
  '/functions/sms',
  '/functions/sendsurvey',
  '/functions/followup',
  '/functions/hvac-outreach',
  '/functions/sms-campaign',
];

// A fetch spy that records every call and returns canned read responses.
function makeFetchSpy(overrides = {}) {
  const calls = [];
  async function spy(url, opts = {}) {
    calls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase(), opts });
    const u = String(url);
    if (overrides.handler) {
      const r = overrides.handler(u, opts);
      if (r) return r;
    }
    if (u.includes('textbelt.com/quota')) {
      return { ok: true, status: 200, json: async () => ({ quotaRemaining: 1000 }) };
    }
    if (u.includes('api.vapi.ai/call')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (u.includes('/rest/v1/leads') && u.includes('replied_at')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (u.includes('/rest/v1/leads') && u.includes('last_call_at')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (u.includes('/rest/v1/leads')) {
      return { ok: true, status: 200, json: async () => [{ id: 1 }] };
    }
    if (u.includes('/rest/v1/system_health')) {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }
  spy.calls = calls;
  return spy;
}

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  VAPI_KEY: 'vapi-key',
  TEXTBELT_KEY: 'tb1',
  TEXTBELT_KEY_2: 'tb2',
  OPERATOR_SESSION_SECRET: 'sess-secret',
};

const okInventory = async () => ({ ok: true, sheet_count: 3 });

test('1 & 2: worker never invokes operational functions and never POSTs', async () => {
  const fetchSpy = makeFetchSpy();
  await worker.runHealthcheck({ env: ENV, fetch: fetchSpy, inventoryCheck: okInventory });

  assert.ok(fetchSpy.calls.length > 0, 'expected some read probes');
  for (const c of fetchSpy.calls) {
    assert.strictEqual(c.method, 'GET', `unexpected non-GET call to ${c.url}`);
    for (const marker of OPERATIONAL_URL_MARKERS) {
      assert.ok(!c.url.includes(marker), `worker must not call operational URL: ${c.url}`);
    }
  }
});

test('3: manual endpoint dry-run is side-effect-free (no write)', async () => {
  const fetchSpy = makeFetchSpy();
  const fakeAuth = {
    sessionTokenFromEvent: () => 'tok',
    verifySession: () => ({ ok: true, sub: 'operator' }),
    verifyCsrf: () => true,
    header: () => null,
  };
  const injectedWorker = {
    runHealthcheck: (o) => worker.runHealthcheck({ ...o, fetch: fetchSpy, inventoryCheck: okInventory }),
    persistHealthResult: (r, o) => worker.persistHealthResult(r, { ...o, fetch: fetchSpy }),
  };
  const res = await admin.handleAdminHealthcheck(
    { httpMethod: 'POST', body: JSON.stringify({ dryRun: true }) },
    { auth: fakeAuth, worker: injectedWorker, env: ENV }
  );
  assert.strictEqual(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.dry_run, true);
  assert.strictEqual(body.saved, false);
  // No write attempted at all.
  const writes = fetchSpy.calls.filter((c) => c.method !== 'GET' || c.url.includes('system_health'));
  assert.strictEqual(writes.length, 0, 'dry-run must not write anything');
});

test('4: scheduler execution states remain unknown', async () => {
  const fetchSpy = makeFetchSpy();
  const r = await worker.runHealthcheck({ env: ENV, fetch: fetchSpy, inventoryCheck: okInventory });
  assert.strictEqual(r.readmail_execution, 'unknown');
  assert.strictEqual(r.autocall_execution, 'unknown');
  assert.notStrictEqual(r.status, 'healthy'); // never "healthy" with unknowns
});

test('5: unknown execution is persisted as null, never true', async () => {
  let capturedBody = null;
  const fetchSpy = makeFetchSpy({
    handler: (u, opts) => {
      if (u.includes('/rest/v1/system_health')) {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201, json: async () => ({}) };
      }
      return null;
    },
  });
  const record = await worker.runHealthcheck({ env: ENV, fetch: fetchSpy, inventoryCheck: okInventory });
  const saved = await worker.persistHealthResult(record, { env: ENV, fetch: fetchSpy });
  assert.strictEqual(saved.saved, true);
  assert.strictEqual(capturedBody.readmail_ok, null);
  assert.strictEqual(capturedBody.autocall_ok, null);
  assert.strictEqual(capturedBody.book_ok, null);
  assert.notStrictEqual(capturedBody.readmail_ok, true);
  assert.notStrictEqual(capturedBody.autocall_ok, true);
});

test('6: activity freshness is separate from execution and does not raise issues', async () => {
  // No recent replies/calls (empty result sets) -> activity false, but NOT an issue.
  const fetchSpy = makeFetchSpy();
  const r = await worker.runHealthcheck({ env: ENV, fetch: fetchSpy, inventoryCheck: okInventory });
  assert.strictEqual(r.readmail_activity_fresh, false);
  assert.strictEqual(r.autocall_activity_fresh, false);
  assert.strictEqual(r.readmail_execution, 'unknown'); // distinct field, distinct value
  assert.strictEqual(r.status, 'no_detected_issues'); // stale activity alone is not an issue
  assert.strictEqual(r.issues, null);
});

test('6b: fresh activity is detected within the window', async () => {
  const now = Date.parse('2026-07-20T12:00:00Z');
  const recent = new Date(now - 60 * 60 * 1000).toISOString(); // 1h ago
  const fetchSpy = makeFetchSpy({
    handler: (u) => {
      if (u.includes('replied_at')) return { ok: true, status: 200, json: async () => [{ replied_at: recent }] };
      if (u.includes('last_call_at')) return { ok: true, status: 200, json: async () => [{ last_call_at: recent }] };
      return null;
    },
  });
  const r = await worker.runHealthcheck({ env: ENV, fetch: fetchSpy, inventoryCheck: okInventory, now });
  assert.strictEqual(r.readmail_activity_fresh, true);
  assert.strictEqual(r.autocall_activity_fresh, true);
});

test('7: a failed Supabase write is reported as failed with a bounded code', async () => {
  const fetchSpy = makeFetchSpy({
    handler: (u) => {
      if (u.includes('/rest/v1/system_health')) {
        return { ok: false, status: 400, json: async () => ({ message: 'null value in column' }) };
      }
      return null;
    },
  });
  const record = await worker.runHealthcheck({ env: ENV, fetch: fetchSpy, inventoryCheck: okInventory });
  const saved = await worker.persistHealthResult(record, { env: ENV, fetch: fetchSpy });
  assert.deepStrictEqual(saved, { saved: false, error_code: 'health_write_400' });
});

test('8: provider/Google/Supabase errors are sanitized (no raw detail leaks)', async () => {
  // Inventory metadata throws with a secret-looking message.
  const throwingClient = {
    spreadsheets: {
      get: async () => {
        throw new Error('PEM private_key parse failed at line 42 super-secret');
      },
      values: { get: async () => ({ data: {} }) },
    },
  };
  const invRes = await inventory.runInventoryCheck({
    env: { GOOGLE_SHEETS_CREDENTIALS: JSON.stringify({ private_key: 'x', client_email: 'a@b.com' }) },
    getSheetsClient: async () => throwingClient,
  });
  assert.deepStrictEqual(invRes, { ok: false, error_code: 'inventory_sheet_metadata_failed' });
  assert.ok(!JSON.stringify(invRes).includes('secret'));
  assert.ok(!JSON.stringify(invRes).includes('private_key'));

  // Worker with a failing inventory + failing supabase surfaces only bounded codes.
  const fetchSpy = makeFetchSpy({
    handler: (u) => {
      if (u.includes('/rest/v1/leads') && u.endsWith('limit=1')) {
        return { ok: false, status: 500, json: async () => ({ message: 'raw db error' }) };
      }
      return null;
    },
  });
  const r = await worker.runHealthcheck({
    env: ENV,
    fetch: fetchSpy,
    inventoryCheck: async () => ({ ok: false, error_code: 'inventory_credentials_invalid' }),
  });
  const s = JSON.stringify(r);
  assert.ok(!s.includes('raw db error'), 'must not leak raw Supabase error text');
  assert.ok(!s.includes('PEM'), 'must not leak Google key detail');
  assert.ok(r.issues.includes('inventory_credentials_invalid'));
  assert.ok(r.issues.includes('supabase_unreachable'));
});

test('9: inventory success returns only bounded fields — no rows, ids, or credentials', async () => {
  const fakeClient = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [{ properties: { title: 'Inventory' } }] } }),
      values: { get: async () => ({ data: { values: [['SECRET-HEADER'], ['SECRET-ROW-DATA']] } }) },
    },
  };
  const res = await inventory.runInventoryCheck({
    env: { GOOGLE_SHEETS_CREDENTIALS: JSON.stringify({ private_key: 'PRIVKEY', client_email: 'a@b.com' }) },
    getSheetsClient: async () => fakeClient,
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.sheet_count, 1);
  const s = JSON.stringify(res);
  assert.ok(!s.includes('SECRET-ROW-DATA'), 'must not return inventory rows');
  assert.ok(!s.includes('SECRET-HEADER'), 'must not return inventory headers');
  assert.ok(!s.includes('PRIVKEY'), 'must not return credentials');
  assert.ok(!s.includes(inventory.SPREADSHEET_IDS[0]), 'must not return spreadsheet IDs');
});

test('9b: inventory credential error codes are bounded', async () => {
  const missing = await inventory.runInventoryCheck({ env: {}, getSheetsClient: async () => ({}) });
  assert.deepStrictEqual(missing, { ok: false, error_code: 'inventory_credentials_missing' });

  const invalid = await inventory.runInventoryCheck({
    env: { GOOGLE_SHEETS_CREDENTIALS: 'not-json' },
    getSheetsClient: async () => ({}),
  });
  assert.deepStrictEqual(invalid, { ok: false, error_code: 'inventory_credentials_invalid' });

  const noKey = await inventory.runInventoryCheck({
    env: { GOOGLE_SHEETS_CREDENTIALS: JSON.stringify({ client_email: 'a@b.com' }) },
    getSheetsClient: async () => ({}),
  });
  assert.deepStrictEqual(noKey, { ok: false, error_code: 'inventory_credentials_invalid' });
});

test('10: UI classifies 401/403/non-2xx/non-JSON/ok correctly', () => {
  assert.strictEqual(ui.classifyHealthcheckResponse(401, 'application/json').kind, 'auth');
  assert.strictEqual(ui.classifyHealthcheckResponse(403, 'text/html').kind, 'auth');
  assert.strictEqual(ui.classifyHealthcheckResponse(500, 'application/json').kind, 'http_error');
  assert.strictEqual(ui.classifyHealthcheckResponse(502, null).kind, 'http_error');
  assert.strictEqual(ui.classifyHealthcheckResponse(200, 'text/html; charset=utf-8').kind, 'bad_content');
  assert.strictEqual(ui.classifyHealthcheckResponse(200, 'application/json; charset=utf-8').kind, 'ok');
  assert.strictEqual(ui.executionLabel('unknown'), 'Unknown');
  assert.strictEqual(ui.activityLabel(false), 'No recent activity');
});

test('manual endpoint: unauthenticated -> 401, missing auth helper -> 503', async () => {
  const fakeAuth = {
    sessionTokenFromEvent: () => null,
    verifySession: () => ({ ok: false }),
    verifyCsrf: () => false,
    header: () => null,
  };
  const injectedWorker = {
    runHealthcheck: async () => ({}),
    persistHealthResult: async () => ({ saved: true }),
  };
  const unauth = await admin.handleAdminHealthcheck(
    { httpMethod: 'POST', body: '{}' },
    { auth: fakeAuth, worker: injectedWorker, env: ENV }
  );
  assert.strictEqual(unauth.statusCode, 401);

  const noHelper = await admin.handleAdminHealthcheck(
    { httpMethod: 'POST', body: '{}' },
    { auth: null, worker: injectedWorker, env: ENV }
  );
  assert.strictEqual(noHelper.statusCode, 503);
});

test('manual endpoint: non-dry-run without CSRF -> 403', async () => {
  const fetchSpy = makeFetchSpy();
  const fakeAuth = {
    sessionTokenFromEvent: () => 'tok',
    verifySession: () => ({ ok: true, sub: 'operator' }),
    verifyCsrf: () => false, // no/invalid CSRF
    header: () => null,
  };
  const injectedWorker = {
    runHealthcheck: (o) => worker.runHealthcheck({ ...o, fetch: fetchSpy, inventoryCheck: okInventory }),
    persistHealthResult: (r, o) => worker.persistHealthResult(r, { ...o, fetch: fetchSpy }),
  };
  const res = await admin.handleAdminHealthcheck(
    { httpMethod: 'POST', body: JSON.stringify({ dryRun: false }) },
    { auth: fakeAuth, worker: injectedWorker, env: ENV }
  );
  assert.strictEqual(res.statusCode, 403);
  // And crucially: no write happened because CSRF failed first.
  assert.strictEqual(fetchSpy.calls.filter((c) => c.url.includes('system_health')).length, 0);
});
