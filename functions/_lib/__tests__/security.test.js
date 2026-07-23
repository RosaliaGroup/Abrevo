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

test('new server code introduces no Twilio/Textbelt send path', () => {
  const files = ['functions/communications.js', 'functions/telnyx-inbound.js', 'functions/telnyx-status.js',
    'functions/_lib/smsWebhook.js', 'functions/_lib/commApi.js', 'functions/_lib/smsService.js'];
  for (const f of files) {
    const src = read(f);
    assert.equal(/twilio/i.test(src), false, `${f} references twilio`);
    assert.equal(/textbelt/i.test(src), false, `${f} references textbelt`);
  }
});
