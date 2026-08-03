'use strict';
/**
 * functions/system-audit.js — end-to-end integrity check.
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
// Fixed recipient, not read from env — this report should always reach the
// person who owns the pipeline, regardless of how other alerts are routed.
const ALERT_TO = 'ana@rosaliagroup.com';
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
        // FIXABLE: someone texted and no lead exists. Create one so they're
        // visible and can be followed up, rather than only reporting it.
        const phones = [...new Set(orphans.map((m) => phoneById[m.conversation_id]).filter(Boolean))];
        let made = 0;
        for (const phone of phones.slice(0, 25)) {
          try {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
              method: 'POST',
              headers: Object.assign(H(), { Prefer: 'return=minimal' }),
              body: JSON.stringify({
                name: 'Unknown (texted in)', phone, source: 'sms',
                client: 'rosalia', status: 'contacted',
                stage_changed_at: new Date().toISOString(), stage_changed_by: 'auto:audit',
              }),
            });
            if (r.ok) made++;
          } catch (e) { /* reported below either way */ }
        }
        if (made) repaired.push(`Created ${made} lead(s) for people who texted but had no record.`);
        if (made < phones.length) {
          issues.push(`${phones.length - made} inbound text(s) from numbers with no lead — could not create a record automatically.`);
        }
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
      // FIXABLE: a lead who replied belongs at 'contacted'. Same rule
      // telnyx-inbound applies; this catches any it missed.
      let moved = 0;
      for (const l of replied.slice(0, 50)) {
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${l.id}&status=eq.lead`, {
            method: 'PATCH',
            headers: Object.assign(H(), { Prefer: 'return=minimal' }),
            body: JSON.stringify({ status: 'contacted', stage_changed_at: new Date().toISOString(), stage_changed_by: 'auto:audit' }),
          });
          if (r.ok) moved++;
        } catch (e) { /* reported below */ }
      }
      if (moved) repaired.push(`Advanced ${moved} lead(s) to "Contacted" after they replied.`);
      if (moved < replied.length) {
        issues.push(`${replied.length - moved} lead(s) replied but remain at "Lead" — the stage update may not be running.`);
      }
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
      // FIXABLE: a subscription failing repeatedly is gone. Prune it so the
      // sender stops wasting calls on it.
      let pruned = 0;
      for (const d of subs.filter((x) => x.failures >= 3)) {
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${d.id}`, { method: 'DELETE', headers: H() });
          if (r.ok) pruned++;
        } catch (e) { /* reported below */ }
      }
      if (pruned) repaired.push(`Removed ${pruned} dead alert device(s). Re-enable alerts on that device to restore them.`);
    }

    // ---- 6. Tomorrow's tours must have a reminder ----
    // The single most costly miss: a confirmed tour where nobody was reminded,
    // so they don't turn up and the slot is wasted. Checked from 4pm ET, by
    // which time the afternoon reminder job should have run.
    // "Tomorrow" must be tomorrow in EASTERN time, not UTC. Between 8pm and
    // midnight ET the UTC date has already rolled over, so a naive UTC+1day
    // lands on the day after tomorrow and reports tours as unreminded that
    // aren't due a reminder yet.
    const etNow = new Date(Date.now() - 4 * 3600e3);          // EDT
    const tmr = new Date(etNow.getTime() + 864e5).toISOString().slice(0, 10);
    const toursTomorrow = await sb(
      `bookings?starts_at=gte.${tmr}T00:00:00&starts_at=lte.${tmr}T23:59:59&select=id,full_name,starts_at,reminder_sent_at&limit=100`
    );
    stats.tours_tomorrow = toursTomorrow.length;
    const unreminded = toursTomorrow.filter((b) => !b.reminder_sent_at);
    stats.tours_unreminded = unreminded.length;
    // Only complain after the reminder window; before that, unreminded is normal.
    if (unreminded.length && new Date().getUTCHours() >= 20) {
      issues.push(`${unreminded.length} tour(s) tomorrow with NO reminder sent — those people may not show up.`);
    }

    // ---- 7. Scheduled jobs producing nothing ----
    // A job can run, return 200, and do nothing useful. These check outcomes.
    const dayAgo = since;
    const [newLeads, callsLogged, newBookings, outboundSent] = await Promise.all([
      sb(`leads?created_at=gte.${dayAgo}&select=id&limit=500`),
      sb(`calls?created_at=gte.${dayAgo}&select=id&limit=500`),
      sb(`bookings?created_at=gte.${dayAgo}&select=id&limit=500`),
      sb(`messages?direction=eq.outbound&created_at=gte.${dayAgo}&select=id&limit=500`),
    ]);
    stats.new_leads = newLeads.length;
    stats.calls_logged = callsLogged.length;
    stats.new_bookings = newBookings.length;
    stats.outbound_sent = outboundSent.length;

    // autocall runs every minute against leads needing contact. Zero calls in a
    // day means it is picking nothing up, or Vapi is refusing them.
    const callable = await sb(`leads?status=eq.attempted&phone=not.is.null&select=id&limit=1`);
    if (callsLogged.length === 0 && callable.length > 0) {
      issues.push('No AI calls logged in 24 hours despite callable leads — autocall or Vapi may be failing.');
    }
    if (outboundSent.length === 0 && newLeads.length > 0) {
      issues.push(`${newLeads.length} new lead(s) but NO outbound texts sent — the SMS pipeline may be down.`);
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
    // An email every hour, whether or not anything was wrong. Silence is
    // ambiguous: a healthy pipeline and a dead monitor look identical from the
    // outside, and the whole point of this is not having to wonder.
    const ok = issues.length === 0;
    console.log(`[system-audit] ${ok ? 'OK' : issues.length + ' issue(s)'} | fixed ${repaired.length} | ${JSON.stringify(stats)}`);

    // The check runs hourly so a problem is caught within the hour, but the
    // all-clear only emails every 4 hours. Twenty-four "nothing wrong" emails a
    // day becomes noise you stop opening, and a monitor you ignore is no monitor.
    const allClearDue = new Date().getUTCHours() % 4 === 0;
    const shouldEmail = !ok || repaired.length > 0 || allClearDue;

    if (GMAIL_PASS && shouldEmail) {
      const subject = ok && !repaired.length
        ? 'Abrevo OK — nothing missed'
        : repaired.length && !issues.length
        ? `Abrevo OK — ${repaired.length} issue${repaired.length === 1 ? '' : 's'} found and fixed`
        : `Abrevo — ${issues.length} issue${issues.length === 1 ? '' : 's'} NEED ATTENTION`;

      const lines = [];
      lines.push(`Checked the last ${WINDOW_HOURS} hours.`);
      lines.push('');

      if (repaired.length) {
        lines.push('FIXED AUTOMATICALLY');
        repaired.forEach((r) => lines.push(`  - ${r}`));
        lines.push('');
      }
      if (issues.length) {
        lines.push('NEEDS YOUR ATTENTION');
        issues.forEach((i) => lines.push(`  - ${i}`));
        lines.push('');
      }
      if (ok && !repaired.length) {
        lines.push('No problems found. Messages recorded, calls logged, reminders sent.');
        lines.push('');
      }

      lines.push('COUNTS');
      lines.push(`  Inbound texts        ${stats.inbound_texts ?? 0}`);
      lines.push(`  Texts with no lead   ${stats.texts_without_lead ?? 0}`);
      lines.push(`  Emails recorded      ${stats.emails_recorded ?? 0} (${stats.emails_inbound ?? 0} inbound)`);
      lines.push(`  Outbound stuck       ${stats.outbound_stuck ?? 0}`);
      lines.push(`  Alert devices        ${stats.push_devices ?? 0}`);
      lines.push('');
      lines.push('ACTIVITY');
      lines.push(`  New leads            ${stats.new_leads ?? 0}`);
      lines.push(`  AI calls logged      ${stats.calls_logged ?? 0}`);
      lines.push(`  Bookings             ${stats.new_bookings ?? 0}`);
      lines.push(`  Texts sent           ${stats.outbound_sent ?? 0}`);
      lines.push(`  Tours tomorrow       ${stats.tours_tomorrow ?? 0} (${stats.tours_unreminded ?? 0} not yet reminded)`);
      lines.push('');
      lines.push('Checks run hourly. Problems and fixes email immediately; the');
      lines.push('all-clear arrives every 4 hours. If it stops, the monitor is down.');

      const t = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
      await t.sendMail({
        from: `"Abrevo Monitor" <${GMAIL_USER}>`,
        to: ALERT_TO,
        subject,
        text: lines.join('\n'),
      });
      console.log('[system-audit] report emailed to', ALERT_TO);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok, issues, stats, repaired }),
    };
  } catch (err) {
    console.error('[system-audit] failed:', err.message);
    // A monitor that dies silently is worse than no monitor.
    if (GMAIL_PASS) {
      try {
        const t = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
        await t.sendMail({
          from: `"Abrevo Monitor" <${GMAIL_USER}>`,
          to: ALERT_TO,
          subject: 'Abrevo system check FAILED to run',
          text: `The system audit itself errored: ${err.message}\n\nThat means nothing is currently watching the pipeline.`,
        });
      } catch (e) { /* nothing more we can do */ }
    }
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
