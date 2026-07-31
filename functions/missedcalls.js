// functions/missedcalls.js
// Missed-call text-back (Rosalia). Runs every minute (see netlify.toml). Pulls
// recent calls from EVERY FUB account; an unanswered / short incoming call gets
// ONE Iron 65 text-back, deduped per fub_call_id and per phone (7-day cooldown).
//
// Routing is intentionally flat: EVERY qualifying missed call -- from either FUB
// account -- gets the Iron 65 message. (Calls carry no assigned agent, and the
// owner chose a single Iron 65 treatment for all callers.)
//
// FIELD NAMES: the exact FUB /v1/calls payload is logged once per run
// ("FUB raw call sample:") so the field extractors below can be confirmed
// against real data; they are deliberately defensive until then.

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const { sendSMS, toE164, mask } = require('./lib/sms');
const { fubAccounts } = require('./lib/fubAccounts');
const { isSkipNumber } = require('./lib/skipNumbers');
const FUB_BASE = 'https://api.followupboss.com/v1';

const IRON65_TEXTBACK =
  'Sorry we missed your call! Iron 65 Luxury Apartments here — book your tour anytime: ' +
  'https://book.rosaliagroup.com/iron65 or call us back at (862) 333-1681.';

function supaHeaders(extra) {
  return Object.assign({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, extra || {});
}

function logRateLimit(res, acctLabel) {
  const rem = res.headers.get('x-ratelimit-remaining') || res.headers.get('x-rate-limit-remaining');
  if (rem != null && Number(rem) < 20) console.warn(`FUB rate limit low (${acctLabel}): ${rem} remaining`);
}

async function fetchRecentCalls(auth, acctLabel) {
  const res = await fetch(`${FUB_BASE}/calls?sort=created&direction=desc&limit=50`, {
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FUB calls API error ${res.status} (${acctLabel}): ${err}`);
  }
  logRateLimit(res, acctLabel);
  const data = await res.json();
  return data.calls || data.items || [];
}

// --- FUB call field extraction (defensive) ---------------------------------
function callIsIncoming(call) {
  if (typeof call.isIncoming === 'boolean') return call.isIncoming;
  const dir = String(call.direction || call.type || '').toLowerCase();
  return dir ? /in(bound|coming)/.test(dir) : false;
}
function callDuration(call) {
  const d = call.duration != null ? call.duration
    : call.callDuration != null ? call.callDuration
    : call.seconds != null ? call.seconds : call.length;
  const n = Number(d);
  return Number.isFinite(n) ? n : null;
}
function callRingDuration(call) {
  const r = call.ringDuration != null ? call.ringDuration : call.ring_duration;
  const n = Number(r);
  return Number.isFinite(n) ? n : null;
}
// outcome is present-but-null on real FUB calls here, so this never fires today;
// kept as a defensive extra in case it starts getting populated.
function outcomeUnanswered(call) {
  const o = String(call.outcome || call.status || call.disposition || '').toLowerCase();
  return /no\s*answer|missed|voicemail|left\s*(a\s*)?(message|voicemail)|no\s*response|unanswered|busy|failed|abandon/.test(o);
}
function callerNumber(call) {
  return call.phone || call.fromNumber || call.from || call.callerId || call.number || null;
}
function callQualifies(call) {
  if (!callIsIncoming(call)) return false;
  const dur = callDuration(call);
  const ring = callRingDuration(call);
  const shortCall = dur != null && dur < 60;
  // Rang the whole time with ~no talk time -> missed, even on a long ring.
  const ringLikeMiss = dur != null && ring != null && ring > 0 && dur <= ring + 5;
  return shortCall || ringLikeMiss || outcomeUnanswered(call);
}

// --- call_texts dedupe -----------------------------------------------------
async function alreadyTextedCall(fubCallId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/call_texts?fub_call_id=eq.${encodeURIComponent(fubCallId)}&limit=1`,
    { headers: supaHeaders() }
  );
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}
async function phoneTextedWithin7d(phone) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/call_texts?phone=eq.${encodeURIComponent(phone)}&texted_at=gt.${encodeURIComponent(since)}&limit=1`,
    { headers: supaHeaders() }
  );
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}
async function recordCallText(fubCallId, phone, account) {
  await fetch(`${SUPABASE_URL}/rest/v1/call_texts`, {
    method: 'POST',
    headers: supaHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify({ fub_call_id: String(fubCallId), phone, account, texted_at: new Date().toISOString() }),
  });
}

// Unknown caller -> minimal lead + stamp outreach_sms_at so the phone-arrival
// sweep in fubsync does not send a second, different text to the same phone.
async function ensureLead(phone, account, callTime) {
  const clean = phone.replace(/\D/g, '');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${clean}*&limit=1`, { headers: supaHeaders() });
  const rows = await res.json();
  if (Array.isArray(rows) && rows.length > 0) return; // known caller -- leave as-is
  await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: supaHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({
      phone,
      source: 'missed-call',
      client: 'iron65',
      status: 'lead',
      notes: `Missed call ${callTime} | Account: ${account}`,
      outreach_sms_at: new Date().toISOString(),
    }),
  });
}

const logDecision = (phone, acct, decision) => console.log('Missed-call:', mask(phone), '| acct:', acct, '|', decision);

// -- HANDLER --
// GET /missedcalls          -- scheduled/normal run (texts new missed calls)
// GET /missedcalls?seed=true -- one-time: record existing call ids, NO texts
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  const seed = event.queryStringParameters?.seed === 'true';

  const results = { texted: 0, seeded: 0, dupCall: 0, dupPhone: 0, noNumber: 0, team: 0, notMissed: 0, errors: 0, accountErrors: 0, pulled: {} };
  let loggedRaw = false;

  try {
    // Deploy safety: this runs on a 1-minute schedule, so the very first
    // scheduled run must NOT blast the historical backlog. Until the one-time
    // ?seed=true pass has recorded existing call ids, a normal run sends nothing.
    if (!seed) {
      const seededRes = await fetch(`${SUPABASE_URL}/rest/v1/call_texts?select=fub_call_id&limit=1`, { headers: supaHeaders() });
      const seededRows = await seededRes.json().catch(() => []);
      if (!Array.isArray(seededRows) || seededRows.length === 0) {
        console.warn('Missed-call: call_texts is empty -- not seeded yet, skipping all texts. Run GET /missedcalls?seed=true once.');
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, skipped: 'not seeded' }) };
      }
    }

    for (const acct of fubAccounts()) {
      if (!acct.auth) {
        // INFO-level so it shows in the default Netlify log view.
        console.log(`Missed-call: account ${acct.label} key unset -- skipping`);
        results.pulled[acct.label] = 'unset';
        continue;
      }
      let calls = [];
      try {
        calls = await fetchRecentCalls(acct.auth, acct.label);
      } catch (e) {
        // Account-level pull failure: count it AND log at INFO so empty-vs-errored
        // is visible without digging into error-only logs.
        console.log(`Missed-call: account ${acct.label} pull FAILED -- ${e.message}`);
        results.accountErrors++;
        results.pulled[acct.label] = 'error';
        continue;
      }
      results.pulled[acct.label] = calls.length;
      console.log(`Missed-call: account ${acct.label} pulled ${calls.length} call(s)`);

      for (const call of calls) {
        try {
          // Log ONE raw call object per run to confirm real field names.
          if (!loggedRaw) { console.log('FUB raw call sample:', JSON.stringify(call)); loggedRaw = true; }

          if (!callQualifies(call)) { results.notMissed++; continue; }

          const fubCallId = call.id != null ? call.id : (call.callId != null ? call.callId : call.uuid);
          if (fubCallId == null) { results.errors++; continue; }

          const rawNum = callerNumber(call);
          if (!rawNum || /anon|block|unknown|private|restrict|withheld/i.test(String(rawNum))) {
            logDecision(rawNum || 'none', acct.label, 'no-number'); results.noNumber++; continue;
          }
          const phone = toE164(rawNum);
          if (!phone) { logDecision(String(rawNum), acct.label, 'no-number'); results.noNumber++; continue; }

          if (isSkipNumber(phone)) { logDecision(phone, acct.label, 'team'); results.team++; continue; }

          // Layer 1 dedupe: this exact call already handled.
          if (await alreadyTextedCall(fubCallId)) { logDecision(phone, acct.label, 'dup-call'); results.dupCall++; continue; }

          // Seed mode: record the id so the historical backlog never texts. No SMS.
          if (seed) {
            await recordCallText(fubCallId, phone, acct.label);
            logDecision(phone, acct.label, 'seeded'); results.seeded++; continue;
          }

          // Layer 2 dedupe: this phone already texted within the cooldown window.
          if (await phoneTextedWithin7d(phone)) { logDecision(phone, acct.label, 'dup-phone'); results.dupPhone++; continue; }

          const r = await sendSMS(phone, IRON65_TEXTBACK, { optOut: true });
          if (r.success) {
            await recordCallText(fubCallId, phone, acct.label);
            await ensureLead(phone, acct.label, call.created || new Date().toISOString());
            logDecision(phone, acct.label, 'texted'); results.texted++;
          } else {
            results.errors++;
          }
          await new Promise(res => setTimeout(res, 500));
        } catch (e) { console.error('Missed-call per-call error:', e.message); results.errors++; }
      }
    }

    console.log('Missed-call results:', JSON.stringify(results), seed ? '(seed)' : '');
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, seed, results }) };
  } catch (err) {
    console.error('missedcalls error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
