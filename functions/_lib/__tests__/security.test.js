'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..'); // repo root

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

test('communications.html exposes no server credentials to the browser', () => {
  const html = read('communications.html');
  // no Supabase service-role / anon JWT, no Telnyx key, no Textbelt
  assert.equal(/service_role/i.test(html), false);
  assert.equal(/eyJhbGci/i.test(html), false);            // no Supabase JWT literal
  assert.equal(/TELNYX_API_KEY|telnyx.*key/i.test(html), false);
  assert.equal(/textbelt/i.test(html), false);
  // it must call the server-owned function, not Supabase/Telnyx directly
  assert.match(html, /\/\.netlify\/functions\/communications/);
  assert.equal(/api\.telnyx\.com|supabase\.co\/rest/i.test(html), false);
});

test('communications.html introduces no sms:/tel:-texting/navigator.share/window.open handlers', () => {
  const html = read('communications.html');
  assert.equal(/href=["']?sms:/i.test(html), false);
  assert.equal(/navigator\.share/i.test(html), false);
  assert.equal(/window\.open\(\s*["']sms:/i.test(html), false);
});

test('server modules hardcode no provider credentials (env only)', () => {
  for (const f of ['functions/_lib/telnyx.js', 'functions/_lib/supabaseRepo.js', 'functions/communications.js',
    'functions/telnyx-inbound.js', 'functions/telnyx-status.js']) {
    const src = read(f);
    assert.equal(/eyJhbGci/.test(src), false, `${f} contains a JWT literal`);
    assert.equal(/textbelt/i.test(src), false, `${f} references textbelt`);
    // Telnyx/Supabase creds must come from process.env, not string literals
    assert.equal(/Bearer\s+KEY[0-9A-Za-z]/.test(src), false, `${f} has a hardcoded bearer key`);
  }
});

test('crm.html no longer exposes the Supabase service-role key (Phase 2.6)', () => {
  const html = read('crm.html');
  assert.equal(/service_role/i.test(html), false);
  assert.equal(/eyJhbGci/.test(html), false);                 // no JWT literal
  assert.equal(/SB_KEY|SB_HEADERS/.test(html), false);        // old key wiring gone
  assert.equal(/supabase\.co\/rest/i.test(html), false);      // no direct PostgREST from browser
  assert.equal(/Authorization/i.test(html), false);           // no bearer header in browser
  assert.match(html, /\/\.netlify\/functions\/crm-data/);     // uses server endpoint
  // sms:/tel: buttons intentionally preserved for the later pilot
  assert.ok(html.includes('href="tel:'), 'tel: Call links preserved');
  assert.ok(html.includes('href="sms:'), 'sms: Text buttons preserved');
});

test('rosalia.html has no Textbelt key literals or live quota fetch left (Phase 2.6)', () => {
  const html = read('rosalia.html');
  assert.equal(/0672a5cd59b0fa1638624d31dea7505b49a5d146/.test(html), false);
  assert.equal(/06aa74dcb12c73154e34300053413dd8479b0cdd/.test(html), false);
  assert.equal(/fetch\(['"]https:\/\/textbelt\.com\/(text|quota)/.test(html), false); // no live call
});

test('new server code introduces no Twilio/Textbelt send path', () => {
  const files = ['functions/communications.js', 'functions/telnyx-inbound.js', 'functions/telnyx-status.js',
    'functions/_lib/smsWebhook.js', 'functions/_lib/commApi.js', 'functions/_lib/smsService.js'];
  for (const f of files) {
    const src = read(f);
    assert.equal(/twilio/i.test(src), false, `${f} references twilio`);
    assert.equal(/textbelt/i.test(src), false, `${f} references textbelt`);
  }
});
