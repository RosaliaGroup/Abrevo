/**
 * functions/call-recap.js
 *
 * Vapi Server URL webhook. Emails a recap after EVERY call.
 *
 * Set as the Server URL on each Rosalia assistant, with the
 * "end-of-call-report" server message enabled:
 *   https://app.abrevo.co/.netlify/functions/call-recap
 *
 * Unlike a tool the assistant has to remember to call, this fires
 * unconditionally — including on silence timeouts and early hangups,
 * which are exactly the calls worth reviewing.
 *
 * Env vars:
 *   VAPI_WEBHOOK_SECRET  — must match the x-vapi-secret header set in Vapi
 *   GMAIL_USER
 *   GMAIL_PASS_INQUIRIES
 *   RECAP_EMAIL_IRON65   — optional; defaults to listings2@rosaliagroup.com
 *   RECAP_EMAIL_DEFAULT  — optional; defaults to inquiries@rosaliagroup.com
 */

const crypto = require('crypto');
const { pushToAll } = require('./lib/pushAlert');
const nodemailer = require('nodemailer');
const { header } = require('./lib/auth');

// Recap routing: Iron 65 calls go to the Iron 65 inbox, everything else to inquiries.
// Env vars are optional per-brand overrides.
const TO_IRON65  = process.env.RECAP_EMAIL_IRON65  || 'listings2@rosaliagroup.com';
const TO_DEFAULT = process.env.RECAP_EMAIL_DEFAULT || 'inquiries@rosaliagroup.com';

function recapRecipient(assistantName) {
  return /iron ?65|mcwhorter/i.test(String(assistantName || '')) ? TO_IRON65 : TO_DEFAULT;
}
const FROM_USER = process.env.GMAIL_USER;
const FROM_PASS = process.env.GMAIL_PASS_INQUIRIES;

// Mechanical has its own recap pipeline — don't email Rosalia about its calls.
const SKIP_ASSISTANTS = /mechanical|hvac/i;

const MAX_TRANSCRIPT_CHARS = 15000;

function timingEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const esc = (s) =>
  String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function pick(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return null;
}

function fmtDuration(sec) {
  if (!sec && sec !== 0) return 'unknown';
  const s = Math.round(Number(sec));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function fmtEastern(ts) {
  try {
    const d = ts ? new Date(Number(ts) || ts) : new Date();
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch (e) {
    return String(ts || '');
  }
}

/** Pull tool calls and their results out of the artifact transcript. */
function extractToolActivity(messages) {
  const acts = [];
  for (const m of messages || []) {
    const role = m.role || m.type;
    if (role === 'tool_calls' || role === 'tool_call') {
      for (const tc of m.toolCalls || m.tool_calls || []) {
        acts.push({ name: (tc.function && tc.function.name) || tc.name || 'unknown', result: null });
      }
    }
    if (role === 'tool_call_result' || role === 'tool_result') {
      const name = m.name || 'unknown';
      let parsed = m.result;
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch (e) {
          /* keep as string */
        }
      }
      const existing = acts.find((a) => a.name === name && a.result === null);
      if (existing) existing.result = parsed;
      else acts.push({ name, result: parsed });
    }
  }
  return acts;
}

/** Decide pass/fail for a tool result, and surface why. */
function judge(act) {
  const r = act.result;
  if (r === null || r === undefined) return { ok: null, note: 'no result recorded' };
  if (typeof r === 'string') return { ok: null, note: r.slice(0, 120) };

  // Nested SMS result (outbound.js / sendForm.js shape)
  const sms = r.sms;
  if (sms && typeof sms === 'object' && sms.success === false) {
    return { ok: false, note: `SMS FAILED — ${String(sms.error || 'unknown').slice(0, 90)}` };
  }
  if (r.smsSent === false) return { ok: false, note: 'SMS FAILED' };
  if (r.error) return { ok: false, note: `ERROR — ${String(r.error).slice(0, 90)}` };
  if (r.success === false) return { ok: false, note: String(r.message || 'returned success:false').slice(0, 90) };
  if (r.found === false) return { ok: null, note: 'caller not found in system' };
  return { ok: true, note: '' };
}

function collectFlags({ acts, endedReason, durationSec }) {
  const flags = [];
  const names = acts.map((a) => a.name.toLowerCase());

  for (const a of acts) {
    const j = judge(a);
    if (j.ok === false) flags.push(`${a.name} failed — ${j.note}`);
  }

  const booked = names.some((n) => /book/.test(n) && !/link/.test(n));
  const rescheduled = names.some((n) => /reschedul/.test(n));
  const cancelled = names.some((n) => /cancel/.test(n));
  if (!booked && !rescheduled && !cancelled) {
    flags.push('No booking, reschedule, or cancellation was recorded on this call');
  }

  if (/silence/i.test(endedReason || '')) flags.push('Call ended on silence timeout — caller may have been left waiting');
  if (/error|failed|pipeline/i.test(endedReason || '')) flags.push(`Abnormal end: ${endedReason}`);
  if (durationSec !== null && durationSec < 20) flags.push(`Very short call (${Math.round(durationSec)}s) — likely abandoned`);

  return flags;
}

function buildHtml(ctx) {
  const { assistant, when, caller, callerName, duration, endedReason, summary, evaluation, acts, flags, recording, transcript, callId } = ctx;

  const flagRows = flags.length
    ? `<div style="background:#fff3cd;border-left:4px solid #d39e00;padding:12px 14px;margin:0 0 18px;">
         <strong style="color:#7a5c00;">Needs attention</strong>
         <ul style="margin:8px 0 0;padding-left:20px;color:#5a4500;">
           ${flags.map((f) => `<li>${esc(f)}</li>`).join('')}
         </ul>
       </div>`
    : `<div style="background:#e8f5e9;border-left:4px solid #2e7d32;padding:10px 14px;margin:0 0 18px;color:#1b5e20;">
         No issues detected on this call.
       </div>`;

  const actRows = acts.length
    ? acts
        .map((a) => {
          const j = judge(a);
          const mark = j.ok === true ? '✓' : j.ok === false ? '✗' : '–';
          const color = j.ok === true ? '#2e7d32' : j.ok === false ? '#c62828' : '#777';
          return `<tr>
            <td style="padding:5px 10px;border-bottom:1px solid #eee;color:${color};font-weight:600;">${mark}</td>
            <td style="padding:5px 10px;border-bottom:1px solid #eee;">${esc(a.name)}</td>
            <td style="padding:5px 10px;border-bottom:1px solid #eee;color:#555;">${esc(j.note)}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="3" style="padding:8px 10px;color:#777;">No tools were used on this call.</td></tr>`;

  return `<!doctype html><html><body style="margin:0;padding:20px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#222;">
<div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e3e5e8;border-radius:6px;overflow:hidden;">
  <div style="padding:16px 20px;background:#111;color:#fff;">
    <div style="font-size:17px;font-weight:600;">Call Recap</div>
    <div style="font-size:13px;color:#bbb;margin-top:3px;">${esc(assistant)} &middot; ${esc(when)}</div>
  </div>
  <div style="padding:20px;">
    ${flagRows}

    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
      <tr><td style="padding:5px 0;color:#666;width:150px;">Caller</td><td style="padding:5px 0;font-weight:600;">${esc(caller)}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Name</td><td style="padding:5px 0;">${esc(callerName || 'not captured')}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Duration</td><td style="padding:5px 0;">${esc(duration)}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Ended because</td><td style="padding:5px 0;">${esc(endedReason || 'unknown')}</td></tr>
    </table>

    <div style="font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:6px;">Summary</div>
    <div style="font-size:14px;line-height:1.6;margin-bottom:20px;">${esc(summary || 'No summary generated.')}</div>

    ${evaluation ? `<div style="font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:6px;">Evaluation</div>
    <div style="font-size:14px;line-height:1.6;margin-bottom:20px;">${esc(evaluation)}</div>` : ''}

    <div style="font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:6px;">Actions taken</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">${actRows}</table>

    ${recording ? `<div style="margin-bottom:20px;"><a href="${esc(recording)}" style="color:#0b5cad;">Listen to the recording</a></div>` : ''}

    <details>
      <summary style="cursor:pointer;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Full transcript</summary>
      <pre style="white-space:pre-wrap;font-size:12.5px;line-height:1.55;background:#fafafa;border:1px solid #eee;padding:12px;margin-top:10px;">${esc(transcript || 'No transcript available.')}</pre>
    </details>

    <div style="margin-top:22px;font-size:11px;color:#aaa;">Call ID ${esc(callId || 'unknown')}</div>
  </div>
</div>
</body></html>`;
}

/**
 * Write the call to Supabase so it shows on the lead's record in the CRM.
 *
 * Best-effort: this webhook's job is to acknowledge Vapi, so a database problem
 * must never turn into a non-2xx (Vapi would retry and re-send the email).
 * Every failure is logged and swallowed.
 *
 * The lead is matched on the last 10 digits of the caller's number — the
 * canonical convention used everywhere else in this codebase (see
 * findExistingLead in respondrosalia.js).
 */
async function logCall(ctx, { durationSec, endedReason } = {}) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_KEY) {
      console.warn('[call-recap] SUPABASE_SERVICE_KEY not set — call not logged');
      return { logged: false, reason: 'missing_key' };
    }

    const h = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    const digits = String(ctx.caller || '').replace(/\D/g, '');
    const last10 = digits.length >= 10 ? digits.slice(-10) : null;

    // Best-effort lead match so the call appears on the right record.
    let leadId = null;
    if (last10) {
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${last10}*&select=id&order=created_at.desc&limit=1`,
          { headers: h }
        );
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length) leadId = rows[0].id;
      } catch (e) {
        console.warn('[call-recap] lead lookup failed:', e.message);
      }
    }

    const names = (ctx.acts || []).map((a) => String(a.name || '').toLowerCase());
    const outcome = names.some((n) => /book/.test(n) && !/link/.test(n))
      ? 'booked'
      : names.some((n) => /reschedul/.test(n))
      ? 'rescheduled'
      : names.some((n) => /cancel/.test(n))
      ? 'cancelled'
      : 'no_action';

    const res = await fetch(`${SUPABASE_URL}/rest/v1/calls`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify({
        vapi_call_id: ctx.callId || null,
        lead_id: leadId,
        assistant: ctx.assistant || null,
        caller_phone: ctx.caller === 'unknown' ? null : ctx.caller,
        caller_name: ctx.callerName || null,
        direction: 'inbound',
        duration_sec: durationSec === null || durationSec === undefined ? null : Math.round(durationSec),
        ended_reason: endedReason || null,
        outcome,
        summary: ctx.summary || null,
        evaluation: ctx.evaluation === null || ctx.evaluation === undefined ? null : String(ctx.evaluation),
        transcript: ctx.transcript || null,
        recording_url: ctx.recording || null,
        flags: ctx.flags && ctx.flags.length ? ctx.flags : null,
      }),
    });

    if (res.status === 409) {
      // Duplicate vapi_call_id — Vapi retried an event we already stored.
      console.log('[call-recap] call already logged, skipping duplicate');
      return { logged: false, reason: 'duplicate' };
    }
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[call-recap] call log failed (${res.status}): ${body.slice(0, 200)}`);
      return { logged: false, reason: `http_${res.status}` };
    }

    console.log(`[call-recap] call logged | lead=${leadId || 'unmatched'} | outcome=${outcome}`);
    return { logged: true, leadId, outcome };
  } catch (err) {
    console.warn('[call-recap] call log error:', err.message);
    return { logged: false, reason: 'error' };
  }
}

exports.handler = async (event) => {
  const ok = (body) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || { received: true }) });

  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // --- auth ---
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  const provided = header(event, 'x-vapi-secret');
  if (!expected || !timingEqualStr(provided, expected)) {
    console.warn('[call-recap] rejected: bad or missing x-vapi-secret');
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    console.error('[call-recap] bad JSON');
    return ok({ received: true, ignored: 'bad json' });
  }

  const msg = payload.message || payload;
  const type = msg.type || '';

  // Vapi sends many event types. Ack everything, act only on the final report.
  if (type !== 'end-of-call-report') return ok({ received: true, ignored: type || 'unknown' });

  const call = msg.call || payload.call || {};
  const assistantObj = msg.assistant || call.assistant || {};
  const assistant = pick(assistantObj.name, call.assistantId, 'Unknown assistant');

  if (SKIP_ASSISTANTS.test(String(assistant))) {
    console.log(`[call-recap] skipping non-Rosalia assistant: ${assistant}`);
    return ok({ received: true, skipped: assistant });
  }

  const artifact = msg.artifact || call.artifact || {};
  const analysis = msg.analysis || call.analysis || {};
  const messages = artifact.messages || artifact.messagesOpenAIFormatted || [];

  const acts = extractToolActivity(messages);

  // Caller name: structured data first, then whatever getCallerInfo returned.
  let callerName = null;
  const sd = analysis.structuredData || {};
  callerName = pick(sd.caller_name, sd.name, sd.full_name);
  if (!callerName) {
    for (const a of acts) {
      const r = a.result;
      if (r && typeof r === 'object') {
        const n = pick(r.caller_name, r.full_name, r.name);
        if (n) { callerName = n; break; }
      }
    }
  }

  let durationSec = pick(msg.durationSeconds, call.durationSeconds);
  if (durationSec === null && msg.durationMs) durationSec = Number(msg.durationMs) / 1000;
  if (durationSec === null && (msg.startedAt || call.startedAt) && (msg.endedAt || call.endedAt)) {
    try {
      durationSec = (new Date(msg.endedAt || call.endedAt) - new Date(msg.startedAt || call.startedAt)) / 1000;
    } catch (e) { /* leave null */ }
  }

  const endedReason = pick(msg.endedReason, call.endedReason);
  let transcript = pick(artifact.transcript, msg.transcript, '');
  if (transcript && transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS) + '\n\n[transcript truncated]';
  }

  const ctx = {
    assistant,
    when: fmtEastern(pick(msg.endedAt, call.endedAt, msg.timestamp)),
    caller: pick((call.customer || {}).number, (msg.customer || {}).number, 'unknown'),
    callerName,
    duration: fmtDuration(durationSec),
    endedReason,
    summary: pick(analysis.summary, msg.summary),
    evaluation: pick(analysis.successEvaluation),
    acts,
    flags: collectFlags({ acts, endedReason, durationSec }),
    recording: pick(artifact.recordingUrl, artifact.stereoRecordingUrl, msg.recordingUrl),
    transcript,
    callId: pick(call.id, msg.callId),
  };

  // Persist the call BEFORE the email step. Logging must not depend on mail
  // config being present — the early return below used to drop the whole event.
  const logged = await logCall(ctx, { durationSec, endedReason });

  // Alert when an AI call finishes, with the outcome — that's the moment you'd
  // want to follow up, not whenever you next open the CRM.
  try {
    await pushToAll({
      title: `Call ended · ${ctx.callerName || ctx.caller || 'unknown'}`,
      body: (ctx.summary || 'No summary').slice(0, 140),
      tag: 'call-' + (ctx.caller || ''),
    });
  } catch (e) { /* never block the recap email */ }

  if (!FROM_USER || !FROM_PASS) {
    console.error('[call-recap] GMAIL_USER or GMAIL_PASS_INQUIRIES not set — cannot email');
    return ok({ received: true, emailed: false, logged: logged.logged, error: 'missing_mail_config' });
  }

  const flagCount = ctx.flags.length;

  // Escalation subjects. The assistant is scripted to say these exact phrases,
  // so the transcript is a reliable signal for what the call actually needs.
  const said = String(ctx.transcript || '');
  const wantsManagement = /escalate this to management/i.test(said);
  const wantsCallback   = /message the agent to call you back/i.test(said);
  const who = ctx.callerName || ctx.caller;

  let subject;
  if (wantsManagement) {
    subject = `Resident needs to speak with management — ${who} — ${ctx.caller || ''}`;
  } else if (wantsCallback) {
    subject = `Call caller back — ${who} — ${ctx.caller || ''}`;
  } else {
    subject = `${flagCount ? '[Needs attention] ' : ''}Call Recap — ${who} — ${assistant}`;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: FROM_USER, pass: FROM_PASS },
    });
    const recipient = recapRecipient(assistant);
    await transporter.sendMail({
      from: `"Rosalia Group AI" <${FROM_USER}>`,
      to: recipient,
      subject,
      html: buildHtml(ctx),
    });
    console.log(`[call-recap] emailed ${recipient} | ${assistant} | ${ctx.caller} | flags=${flagCount}`);
    return ok({ received: true, emailed: true, logged: logged.logged, flags: flagCount });
  } catch (err) {
    console.error('[call-recap] email failed:', err.message);
    return ok({ received: true, emailed: false, error: err.message });
  }
};
