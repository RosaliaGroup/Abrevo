// Tests for the Mechanical-isolated book-hvac function.
// Uses Node's built-in test runner (node --test) — no external deps.
// googleapis/nodemailer are never loaded: calendar returns early on empty
// GOOGLE_CREDENTIALS, and the email transporter is overridden.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const mod = require('./book-hvac.js');
const T = mod.__test;
const SRC = fs.readFileSync(path.join(__dirname, 'book-hvac.js'), 'utf8');

function fullEnv() {
  return {
    TELNYX_API_KEY: 'KEYtest',
    TELNYX_FROM_NUMBER: '+15516007027',
    MECHANICAL_CALENDAR_ID: 'mech-cal@group.calendar.google.com',
    MECHANICAL_SUPABASE_URL: 'https://mechproj.supabase.co',
    MECHANICAL_SUPABASE_SERVICE_KEY: 'svc_key',
    MECHANICAL_FROM_EMAIL: 'bookings@mechanicalenterprise.com',
    GOOGLE_CREDENTIALS: '{}',
    GMAIL_USER: 'u@x.com',
    GMAIL_PASS: 'p',
  };
}
function setEnv(e) { for (const k of Object.keys(e)) process.env[k] = e[k]; }
function clearEnv(e) { for (const k of Object.keys(e)) delete process.env[k]; }

function harness(fetchImpl) {
  const calls = [];
  const rf = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return fetchImpl(url, opts); };
  const emails = [];
  T.setTransporter({ sendMail: async (m) => { emails.push(m); return { messageId: 'x' }; } });
  return { calls, emails, restore: () => { global.fetch = rf; T.setTransporter(null); } };
}
const okFetch = (url) =>
  url.includes('api.telnyx.com')
    ? { ok: true, status: 200, text: async () => JSON.stringify({ data: { id: 'sms_1' } }) }
    : { ok: true, status: 201, text: async () => '' };

const validBooking = {
  full_name: 'Jane Doe', phone: '8624191763', email: 'j@x.com',
  preferred_date: 'December 31 2099', preferred_time: '2:00 PM',
  appointment_type: 'technician_dispatch', property_type: 'residential',
  property_address: '1 Main St', issue_description: 'No heat', budget: '5000',
};

// 1
test('1. US phone normalization', () => {
  assert.equal(T.normalizePhone('8624191763'), '+18624191763');
  assert.equal(T.normalizePhone('(862) 419-1763'), '+18624191763');
  assert.equal(T.normalizePhone('18624191763'), '+18624191763');
});

// 2
test('2. invalid phone handling (no request made)', async () => {
  assert.equal(T.normalizePhone('123'), null);
  assert.equal(T.isPlausibleE164('+1862'), false);
  assert.equal(T.isPlausibleE164('+18624191763'), true);
  let called = false; const rf = global.fetch;
  global.fetch = async () => { called = true; return { ok: true, text: async () => '{}' }; };
  const r = await T.sendSMS('123', 'hi');
  global.fetch = rf;
  assert.equal(r.success, false); assert.equal(r.error, 'invalid_phone'); assert.equal(called, false);
});

// 3
test('3. successful Telnyx response', async () => {
  const env = fullEnv(); setEnv(env); const rf = global.fetch;
  global.fetch = async (url, opts) => {
    assert.equal(url, 'https://api.telnyx.com/v2/messages');
    const body = JSON.parse(opts.body);
    assert.equal(body.from, '+15516007027'); assert.equal(body.to, '+18624191763');
    assert.match(opts.headers.Authorization, /^Bearer /);
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { id: 'msg_123' } }) };
  };
  const r = await T.sendSMS('8624191763', 'hi');
  global.fetch = rf; clearEnv(env);
  assert.deepEqual(r, { success: true, provider: 'telnyx', messageId: 'msg_123', error: null });
});

// 4
test('4. Telnyx rejection', async () => {
  const env = fullEnv(); setEnv(env); const rf = global.fetch;
  global.fetch = async () => ({ ok: false, status: 422, text: async () => '{"errors":[]}' });
  const r = await T.sendSMS('8624191763', 'hi');
  global.fetch = rf; clearEnv(env);
  assert.equal(r.success, false); assert.equal(r.error, 'telnyx_422'); assert.equal(r.messageId, null);
});

// 5
test('5. Telnyx network failure', async () => {
  const env = fullEnv(); setEnv(env); const rf = global.fetch;
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const r = await T.sendSMS('8624191763', 'hi');
  global.fetch = rf; clearEnv(env);
  assert.equal(r.success, false); assert.equal(r.provider, 'telnyx'); assert.match(r.error, /ECONNRESET/);
});

// 6
test('6. missing Telnyx configuration', async () => {
  delete process.env.TELNYX_API_KEY; delete process.env.TELNYX_FROM_NUMBER;
  const r = await T.sendSMS('8624191763', 'hi');
  assert.equal(r.success, false); assert.equal(r.error, 'not_configured');
  const miss = T.missingConfig({});
  assert.ok(miss.includes('TELNYX_API_KEY') && miss.includes('TELNYX_FROM_NUMBER'));
});

// 7
test('7. Mechanical calendar id is env-driven', () => {
  assert.ok(SRC.includes('process.env.MECHANICAL_CALENDAR_ID'));
  assert.ok(SRC.includes('calendarId, resource: event'));
});

// 8
test('8. Rosalia calendar id never used', () => {
  assert.ok(!SRC.includes('4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398'));
});

// 9
test('9. Mechanical Supabase URL used, shared Rosalia not', () => {
  assert.ok(SRC.includes('process.env.MECHANICAL_SUPABASE_URL'));
  assert.ok(SRC.includes('/rest/v1/hvac_appointments'));
  assert.ok(!SRC.includes('fhkgpepkwibxbxsepetd'));
});

// 10
test('10. HVAC field names inserted, no real-estate remap', () => {
  const row = T.buildAppointmentRow({
    full_name: 'Jane Doe', phone: '8624191763', email: 'j@x.com',
    preferred_date: 'March 15 2026', preferred_time: '2:00 PM',
    appointment_type: 'technician_dispatch', property_type: 'residential',
    property_address: '1 Main St', issue_description: 'No heat', budget: '5000',
  }, { calendarEventId: 'ev1', smsResult: { provider: 'telnyx', messageId: 'm1' } });
  assert.equal(row.appointment_type, 'technician_dispatch');
  assert.equal(row.property_type, 'residential');
  assert.equal(row.property_address, '1 Main St');
  assert.equal(row.issue_description, 'No heat');
  assert.equal(row.budget, '5000');
  assert.equal(row.calendar_event_id, 'ev1');
  assert.equal(row.sms_provider, 'telnyx');
  assert.equal(row.sms_message_id, 'm1');
  assert.equal(row.source, 'vapi');
  assert.equal(row.status, 'scheduled');
  for (const legacy of ['apartment_size', 'preferred_area', 'move_in_date']) {
    assert.ok(!(legacy in row), `must not contain ${legacy}`);
  }
});

// 11
test('11. Rosalia sender email removed; Mechanical sender used', () => {
  assert.ok(!SRC.includes('inquiries@rosaliagroup.com'));
  assert.ok(SRC.includes('process.env.MECHANICAL_FROM_EMAIL'));
});
test('11b. no TextBelt/Twilio provider references remain', () => {
  assert.ok(!SRC.includes('textbelt.com'));
  assert.ok(!SRC.includes('TEXTBELT_KEY'));
  assert.ok(!/api\.twilio\.com/.test(SRC));
  assert.ok(SRC.includes('api.telnyx.com/v2/messages'));
});

// 12
test('12. Vapi 200 response contract preserved + Mechanical routing', async () => {
  const env = fullEnv(); setEnv(env);
  const h = harness(okFetch);
  const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify(validBooking) });
  h.restore(); clearEnv(env);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  const body = JSON.parse(res.body);
  assert.equal(body.success, true);
  assert.ok('eventId' in body);
  assert.ok(h.calls.some((c) => c.url.includes('api.telnyx.com')));
  const sb = h.calls.find((c) => c.url.includes('/rest/v1/hvac_appointments'));
  assert.ok(sb && sb.url.startsWith('https://mechproj.supabase.co'));
  const row = JSON.parse(sb.opts.body);
  assert.equal(row.source, 'vapi'); assert.equal(row.status, 'scheduled');
  assert.equal(row.sms_provider, 'telnyx'); assert.equal(row.sms_message_id, 'sms_1');
  assert.equal(h.emails.length, 2);
  assert.ok(h.emails[0].from.includes('bookings@mechanicalenterprise.com'));
});
test('12b. missing required fields → 400 (unchanged)', async () => {
  const env = fullEnv(); setEnv(env);
  const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify({ full_name: 'x' }) });
  clearEnv(env);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'Missing required fields');
});
test('12c. missing config → controlled 500 (no Rosalia routing)', async () => {
  for (const k of T.REQUIRED_ENV) delete process.env[k];
  const h = harness(okFetch);
  const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify(validBooking) });
  h.restore();
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.body).error, 'Server configuration error');
  assert.equal(h.calls.length, 0); // nothing external attempted
});

// 13
test('13. subsystem failures remain isolated (still 200)', async () => {
  const env = fullEnv(); setEnv(env);
  const h = harness((url) => {
    if (url.includes('api.telnyx.com')) return { ok: true, status: 200, text: async () => JSON.stringify({ data: { id: 's1' } }) };
    throw new Error('supabase down');
  });
  T.setTransporter({ sendMail: async () => { throw new Error('smtp down'); } });
  const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify(validBooking) });
  h.restore(); clearEnv(env);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).success, true);
});

// 14
test('14. advance-notice validation still enforced (no send)', async () => {
  const env = fullEnv(); setEnv(env);
  const h = harness(okFetch);
  const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify({ ...validBooking, preferred_date: 'January 1 2020' }) });
  h.restore(); clearEnv(env);
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /18 hours advance notice/);
  assert.ok(!h.calls.some((c) => c.url.includes('api.telnyx.com')));
  assert.ok(!h.calls.some((c) => c.url.includes('hvac_appointments')));
});
