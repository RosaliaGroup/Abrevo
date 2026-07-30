'use strict';
/**
 * Browser-level tests for the crm.html Communications tab (read-only Phase 1).
 * The page's inline <script> is loaded into a vm sandbox with stubbed globals
 * (fetch/document/URLSearchParams/Date), mirroring communications.ui.test.js.
 *
 * Focus: the stale-response race. Opening lead A then lead B must not let A's
 * slower comms response overwrite B's timeline — the active-lead token guards it.
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
    classList: { add() {}, remove() {} }, addEventListener() {}, querySelectorAll: () => [] };
}
// esc() in crm.html is `d=createElement('div'); d.textContent=s; return d.innerHTML`.
// This element mirrors the browser's textContent->innerHTML HTML-escaping.
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
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
  };
}

// A fetch that returns one deferred promise per leadId so the test controls the
// resolution ORDER (the essence of the A-slower-than-B race).
function makeDeferredFetch() {
  const resolvers = {};
  const calls = [];
  function fetchImpl(url) {
    calls.push(String(url));
    const leadId = (String(url).match(/leadId=([^&]+)/) || [])[1];
    return new Promise((resolve) => {
      resolvers[leadId] = (messages) =>
        resolve({ status: 200, ok: true, json: async () => ({ ok: true, leadId, linked: true, messages }) });
    });
  }
  return { fetchImpl, resolvers, calls };
}

function loadCrm(fetchImpl) {
  const ctx = vm.createContext({
    fetch: fetchImpl, document: makeDocument(), URLSearchParams, Date,
    console: { log() {}, warn() {}, error() {} },
  });
  vm.runInContext(SCRIPT, ctx);
  return ctx;
}

const panel = (ctx) => ctx.document.getElementById('ld-comms-list').innerHTML;

test('A→B race: A resolving LAST does not overwrite B\'s timeline', async () => {
  const { fetchImpl, resolvers } = makeDeferredFetch();
  const ctx = loadCrm(fetchImpl);

  // Open A (active=A), start its load (awaiting A's deferred fetch).
  ctx.activeLeadDetailId = 'A';
  const pA = ctx.loadComms('A');
  // Open B before A resolves (active=B), start its load.
  ctx.activeLeadDetailId = 'B';
  const pB = ctx.loadComms('B');

  // B resolves first -> B's timeline renders.
  resolvers['B']([{ direction: 'inbound', body: 'B-MESSAGE', status: 'received', created_at: '2026-07-30T10:00:00Z' }]);
  await pB;
  assert.match(panel(ctx), /B-MESSAGE/, 'B timeline should render while B is active');

  // A resolves LAST -> must be discarded (A is no longer the active lead).
  resolvers['A']([{ direction: 'outbound', body: 'A-MESSAGE', status: 'sent', created_at: '2026-07-30T09:00:00Z' }]);
  await pA;
  assert.match(panel(ctx), /B-MESSAGE/, 'B timeline must remain after A resolves late');
  assert.doesNotMatch(panel(ctx), /A-MESSAGE/, "A's stale response must not appear under B");
});

test('active lead\'s own response renders normally (guard does not over-discard)', async () => {
  const { fetchImpl, resolvers } = makeDeferredFetch();
  const ctx = loadCrm(fetchImpl);
  ctx.activeLeadDetailId = 'C';
  const pC = ctx.loadComms('C');
  resolvers['C']([{ direction: 'inbound', body: 'C-MESSAGE', status: 'received', created_at: '2026-07-30T10:00:00Z' }]);
  await pC;
  assert.match(panel(ctx), /C-MESSAGE/);
});

test('every .detail-tab button has a data-tab that matches a detail-panel id', () => {
  const tabs = [...HTML.matchAll(/<div class="detail-tab(?: active)?"([^>]*)>/g)].map((m) => m[1]);
  assert.ok(tabs.length >= 4, 'expected at least the 4 detail tabs');
  const dataTabs = [];
  for (const attrs of tabs) {
    const m = attrs.match(/data-tab="([a-z]+)"/);
    assert.ok(m, `a detail-tab button is missing data-tab (attrs: ${attrs.trim()})`);
    dataTabs.push(m[1]);
  }
  for (const t of dataTabs) {
    assert.match(HTML, new RegExp('id="detail-' + t + '"'), `no matching panel for data-tab="${t}"`);
  }
  assert.deepEqual([...dataTabs].sort(), ['activity', 'comms', 'info', 'tasks']);
});
