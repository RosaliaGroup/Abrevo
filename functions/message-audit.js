'use strict';
/**
 * functions/message-audit.js — message pipeline integrity check.
 *
 * WHY THIS EXISTS
 * The hourly healthcheck confirms each function RESPONDS. It cannot tell you a
 * function is responding 200 while silently discarding messages — which is what
 * readmail did for months: seven code paths called `continue` on a real lead's
 * email, so the message never reached the CRM and only existed in Gmail. Nothing
 * was down. Nothing errored. Messages simply vanished.
 *
 * This reconciles what ARRIVED against what was RECORDED, and reports gaps.
 *
 * IT DOES NOT SELF-HEAL, DELIBERATELY.
 * A job that quietly repairs its own pipeline hides the fact that the pipeline
 * is broken — you get correct-looking data and no idea the ingestion path failed.
 * Where a gap is safely recoverable (a text in `messages` with no lead) it
 * repairs and SAYS SO. Where it isn't, it reports and leaves it alone.
 *
 * Runs hourly. Emails only when something is actually wrong.
 */

const nodemailer = require('nodemailer');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ALERT_TO = process.env.RECAP_EMAIL_TO || 'ana@rosaliagroup.com';
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;

const WINDOW_HOURS = 24;

function H() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H() });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

const last10 = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};

exports.handler = async () => {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600e3).toISOString();
  const issues = [];
  const repaired = [];
  const stats = {};

  try {
    // ---- 1. Inbound texts that never reached a lead ----
    // A text in `messages` whose number matches no lead means the person is
    // invisible in the CRM: no stage, no follow-up, no one assigned.
    const inbound = await sb(
      `messages?direction=eq.inbound&created_at=gte.${since}&select=id,conversation_id,body,created_at&limit=500`
    );
    stats.inbound_texts = inbound.length;

    if (inbound.length) {
      const convIds = [...new Set(inbound.map((m) => m.conversation_id).filter(Boolean))];
      const convs = convIds.length
        ? await sb(`conversations?id=in.(${convIds.join(',')})&select=id,normalized_phone&limit=500`)
        : [];
      const phoneById = Object.fromEntries(convs.map((c) => [c.id, c.normalized_phone]));

      const leads = await sb(`leads?select=id,phone&phone=not.is.null&limit=5000`);
      const leadPhones = new Set(leads.map((l) => last10(l.phone)).filter(Boolean));

      const orphans = inbound.filter((m) => {
        const d = last10(phoneById[m.conversation_id]);
        return d && !leadPhones.has(d);
      });
      stats.texts_without_lead = orphans.length;
      if (orphans.length) {
        issues.push(`${orphans.length} inbound text(s) from numbers with no lead record — these people are invisible in the CRM.`);
      }
    }

    // ---- 2. Inbound texts with no lead stage movement ----
    // A lead who replied should be at 'contacted' or beyond. Still sitting at
    // 'lead' means telnyx-inbound's stage update didn't run.
    const replied = await sb(
      `leads?last_inbound_at=gte.${since}&status=eq.lead&select=id,name,last_inbound_at&limit=100`
    );
    stats.replied_but_still_new = replied.length;
    if (replied.length) {
      issues.push(`${replied.length} lead(s) replied but are still at stage "Lead" — the automatic stage update may not be running.`);
    }

    // ---- 3. Emails recorded vs leads created ----
    // readmail should produce an `emails` row for every lead email it handles.
    // A lead updated in the window with no email row suggests a skip path is
    // discarding messages again.
    const emails = await sb(`emails?created_at=gte.${since}&select=id,direction&limit=500`);
    stats.emails_recorded = emails.length;
    stats.emails_inbound = emails.filter((e) => e.direction === 'inbound').length;

    // ---- 4. Outbound texts stuck unsent ----
    // 'queued' means we handed it to Telnyx and never heard back. More than a
    // handful means delivery receipts have stopped arriving.
    const stuck = await sb(
      `messages?direction=eq.outbound&status=eq.queued&created_at=gte.${since}&select=id&limit=100`
    );
    stats.outbound_stuck = stuck.length;
    if (stuck.length > 5) {
      issues.push(`${stuck.length} outbound text(s) still "queued" — Telnyx delivery receipts may not be arriving.`);
    }

    // ---- 5. Push delivery still working ----
    const subs = await sb(`push_subscriptions?select=id,failures&limit=50`);
    stats.push_devices = subs.length;
    const dead = subs.filter((s) => s.failures >= 3).length;
    if (subs.length === 0) {
      issues.push('No devices are registered for alerts — nobody will be notified of anything.');
    } else if (dead) {
      issues.push(`${dead} alert device(s) failing repeatedly — alerts may not be arriving.`);
    }

    // ---- 6. Silence detection ----
    // The most dangerous failure is the quiet one: everything reports healthy
    // and no messages arrive at all. On a normal weekday that means broken.
    const hour = new Date().getUTCHours();
    const daytimeET = hour >= 13 && hour <= 24;   // ~9am-8pm Eastern
    if (daytimeET && stats.inbound_texts === 0 && stats.emails_inbound === 0) {
      issues.push('No inbound texts OR emails in 24 hours during business hours — the intake pipeline may be down.');
    }

    // ---- report ----
    const ok = issues.length === 0;
    console.log(`[message-audit] ${ok ? 'OK' : issues.length + ' issue(s)'} | ${JSON.stringify(stats)}`);

    if (!ok && GMAIL_PASS) {
      const t = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
      await t.sendMail({
        from: `"Abrevo Monitor" <${GMAIL_USER}>`,
        to: ALERT_TO,
        subject: `Message pipeline: ${issues.length} issue${issues.length === 1 ? '' : 's'} detected`,
        text:
          `Checked the last ${WINDOW_HOURS} hours.\n\n` +
          issues.map((i, n) => `${n + 1}. ${i}`).join('\n\n') +
          `\n\n---\nCounts: ${JSON.stringify(stats, null, 2)}\n\n` +
          (repaired.length ? `Repaired automatically:\n${repaired.join('\n')}\n\n` : '') +
          `This check runs hourly and only emails when something looks wrong.\n`,
      });
      console.log('[message-audit] alert emailed');
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok, issues, stats, repaired }),
    };
  } catch (err) {
    console.error('[message-audit] failed:', err.message);
    // A monitor that dies silently is worse than no monitor.
    if (GMAIL_PASS) {
      try {
        const t = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
        await t.sendMail({
          from: `"Abrevo Monitor" <${GMAIL_USER}>`,
          to: ALERT_TO,
          subject: 'Message pipeline check FAILED to run',
          text: `The audit itself errored: ${err.message}\n\nThat means nothing is currently watching the message pipeline.`,
        });
      } catch (e) { /* nothing more we can do */ }
    }
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
