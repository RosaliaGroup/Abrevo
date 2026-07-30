'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelnyxClient, TELNYX_MESSAGES_URL } = require('../telnyx');

function mockResponse(status, bodyObj) {
  return { status, async text() { return bodyObj === undefined ? '' : JSON.stringify(bodyObj); } };
}

test('configCheck reports presence only, never credential values', () => {
  const c = createTelnyxClient({ apiKey: 'KEY_secret_value', fromNumber: '+15551230000' });
  const chk = c.configCheck();
  assert.equal(chk.ok, true);
  assert.equal(chk.apiKeyPresent, true);
  assert.equal(chk.fromNumberPresent, true);
  assert.equal(chk.fromNumberValid, true);
  // no secret leaks into the report
  assert.equal(JSON.stringify(chk).includes('KEY_secret_value'), false);
});

test('configCheck fails when unconfigured or malformed from-number', () => {
  assert.equal(createTelnyxClient({ apiKey: '', fromNumber: '' }).configCheck().ok, false);
  assert.equal(createTelnyxClient({ apiKey: 'k', fromNumber: '5551230000' }).configCheck().fromNumberValid, false);
});

test('sendSms constructs the correct Telnyx request (mock transport, no network)', async () => {
  const calls = [];
  const transport = async (url, opts) => {
    calls.push({ url, opts });
    return mockResponse(200, { data: { id: 'msg_123' } });
  };
  const c = createTelnyxClient({ apiKey: 'KEY_abc', fromNumber: '+15551230000', transport });
  const res = await c.sendSms({ to: '+15551234567', text: 'hello' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TELNYX_MESSAGES_URL);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer KEY_abc');
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body, { from: '+15551230000', to: '+15551234567', text: 'hello' });
  assert.equal(res.success, true);
  assert.equal(res.providerMessageId, 'msg_123');
});

test('sendSms adds per-message delivery webhook only when statusWebhookUrl is set', async () => {
  const STATUS = 'https://app.abrevo.co/.netlify/functions/telnyx-status';
  // with statusWebhookUrl -> webhook_url + use_profile_webhooks:false in payload
  const withCalls = [];
  const withClient = createTelnyxClient({ apiKey: 'k', fromNumber: '+15551230000',
    statusWebhookUrl: STATUS, transport: async (u, o) => { withCalls.push(o); return mockResponse(200, { data: { id: 'm1' } }); } });
  await withClient.sendSms({ to: '+15551234567', text: 'hi' });
  const withBody = JSON.parse(withCalls[0].body);
  assert.equal(withBody.webhook_url, STATUS);
  assert.equal(withBody.use_profile_webhooks, false);
  assert.equal(withBody.from, '+15551230000');

  // without statusWebhookUrl -> payload carries no webhook fields
  const noCalls = [];
  const noClient = createTelnyxClient({ apiKey: 'k', fromNumber: '+15551230000',
    transport: async (u, o) => { noCalls.push(o); return mockResponse(200, { data: { id: 'm2' } }); } });
  await noClient.sendSms({ to: '+15551234567', text: 'hi' });
  const noBody = JSON.parse(noCalls[0].body);
  assert.equal('webhook_url' in noBody, false);
  assert.equal('use_profile_webhooks' in noBody, false);
});

test('unconfigured client does not call the transport', async () => {
  let called = false;
  const transport = async () => { called = true; return mockResponse(200, {}); };
  const c = createTelnyxClient({ apiKey: '', fromNumber: '', transport });
  const res = await c.sendSms({ to: '+15551234567', text: 'x' });
  assert.equal(called, false);
  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'telnyx_not_configured');
});

test('provider error is normalized, not thrown', async () => {
  const transport = async () => mockResponse(422, { errors: [{ code: '10015', detail: 'Invalid to number' }] });
  const c = createTelnyxClient({ apiKey: 'k', fromNumber: '+15551230000', transport });
  const res = await c.sendSms({ to: 'bad', text: 'x' });
  assert.equal(res.success, false);
  assert.equal(res.errorCode, '10015');
  assert.equal(res.errorMessage, 'Invalid to number');
});

test('network error is captured, not thrown', async () => {
  const transport = async () => { throw new Error('ECONNRESET'); };
  const c = createTelnyxClient({ apiKey: 'k', fromNumber: '+15551230000', transport });
  const res = await c.sendSms({ to: '+15551234567', text: 'x' });
  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'network_error');
});
