'use strict';
/**
 * Regression test for the A→B stale-response race in crm.html's existing
 * Messages-tab loader (loadLeadMessages). The page's inline <script> is loaded
 * into a vm sandbox with stubbed globals, mirroring communications.ui.test.js.
 *
 * Opening lead A then lead B: A's slower response must NOT overwrite B's
 * timeline. The `/calls` fetch is deferred per lead so the test controls order.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'crm.html'), 'utf8');
const SCRIPT = (HTML.match(/<script>([\s\S]*?)<\/script>/) || [])[1];

function makeEl() {
  return { style: {}, dataset: {}, disabled: false, value: '', innerHTML: '', textContent: '',
    scrollTop: 0, scrollHeight: 0, classList: { add() {}, remove() {}, contains: () => false },
    // options[0] is read by the page's init()/populateAgentDropdowns at load.
    options: [{ outerHTML: '' }], addEventListener() {}, querySelectorAll: () => [] };
}
function makeEscapingEl() {
  let text = '';
  return {
    set textContent(v) { text = v == null ? '' : String(v); },
    get textContent() { return text; },
    get innerHTML() {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    set innerHTML(v) { text = v; },
  };
}
function makeDocument() {
  const els = {};
  return {
    getElementById: (id) => (els[id] || (els[id] = makeEl())),
    createElement: () => makeEscapingEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
}
function res(status, body) { return { status, ok: status >= 200 && status < 300, json: async () => body }; }
async function tick() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

// /calls is deferred per lead so the test decides which lead resolves last.
// findOrCreate + thread resolve immediately, keyed by lead id via conv-<id>.
function makeFetch(DATA) {
  const callsResolvers = {};
  function fetchImpl(url, opts = {}) {
    const u = String(url);
    if (u.includes('/api/calls')) {
      const leadId = (u.match(/lead_id=([^&]+)/) || [])[1];
      return new Promise((resolve) => { callsResolvers[leadId] = () => resolve(res(200, { ok: true, data: [] })); });
    }
    if (u.includes('/communications')) {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        const body = JSON.parse(opts.body || '{}');
        const leadId = body.links && body.links[0] && body.links[0].id;
        return Promise.resolve(res(200, { ok: true, conversation: { id: 'conv-' + leadId, opted_out_at: null } }));
      }
      const conversationId = (u.match(/conversationId=([^&]+)/) || [])[1] || '';
      const leadId = conversationId.replace('conv-', '');
      return Promise.resolve(res(200, { ok: true, conversation: { id: conversationId, opted_out_at: null }, messages: DATA[leadId] || [] }));
    }
    if (u.includes('/api/auth/session')) return Promise.resolve(res(200, { ok: true, csrfToken: 'x' }));
    return Promise.resolve(res(200, { ok: true, data: [] }));
  }
  return { fetchImpl, callsResolvers };
}

function loadCrm(fetchImpl) {
  const ctx = vm.createContext({
    fetch: fetchImpl, document: makeDocument(), URLSearchParams, Date,
    console: { log() {}, warn() {}, error() {} },
  });
  vm.runInContext(SCRIPT, ctx);
  return ctx;
}
const timeline = (ctx) => ctx.document.getElementById('ld-timeline').innerHTML;

test('loadLeadMessages A→B race: A resolving LAST does not overwrite B\'s timeline', async () => {
  const DATA = {
    A: [{ direction: 'outbound', body: 'A-MESSAGE', status: 'sent', created_at: '2026-07-30T09:00:00Z' }],
    B: [{ direction: 'inbound', body: 'B-MESSAGE', status: 'received', created_at: '2026-07-30T10:00:00Z' }],
  };
  const { fetchImpl, callsResolvers } = makeFetch(DATA);
  const ctx = loadCrm(fetchImpl);

  const pA = ctx.loadLeadMessages({ id: 'A', phone: '+15551110001' }); // suspends at /calls (deferred)
  const pB = ctx.loadLeadMessages({ id: 'B', phone: '+15551110002' }); // active lead is now B
  await tick();

  // B's chain completes first -> B timeline renders.
  callsResolvers['B']();
  await pB;
  assert.match(timeline(ctx), /B-MESSAGE/, 'B timeline should render while B is active');

  // A resumes LAST -> stale guard must discard it.
  callsResolvers['A']();
  await pA;
  assert.match(timeline(ctx), /B-MESSAGE/, 'B timeline must survive A resolving late');
  assert.doesNotMatch(timeline(ctx), /A-MESSAGE/, "A's stale response must not overwrite B");
});

test('non-raced load renders the active lead normally', async () => {
  const DATA = { C: [{ direction: 'inbound', body: 'C-MESSAGE', status: 'received', created_at: '2026-07-30T10:00:00Z' }] };
  const { fetchImpl, callsResolvers } = makeFetch(DATA);
  const ctx = loadCrm(fetchImpl);
  const pC = ctx.loadLeadMessages({ id: 'C', phone: '+15551110003' });
  await tick();
  callsResolvers['C']();
  await pC;
  assert.match(timeline(ctx), /C-MESSAGE/);
});
