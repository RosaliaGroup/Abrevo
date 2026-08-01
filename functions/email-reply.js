/**
 * functions/email-reply.js
 *
 * Reply to a lead by email from the CRM, so a conversation that started over
 * email can be continued in the same place as texts and calls.
 *
 * THREADING
 * The reply carries In-Reply-To and References set to the lead's most recent
 * inbound Message-ID. Without those, Gmail files the reply as a new
 * conversation and the lead sees an orphaned message rather than an answer to
 * what they wrote.
 *
 * AUTH
 * Operator session + CSRF, same gate as communications.js. This sends mail from
 * inquiries@rosaliagroup.com, so it must never be reachable unauthenticated.
 */

const nodemailer = require('nodemailer');
const { requireSession, requireCsrf } = require('./_lib/operatorGate');
const { logEmail } = require('./lib/emailLog');

const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const MAX_BODY = 10000;

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function sbHeaders() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  // requireSession is synchronous and returns {ok,status,code} — mirror api.js.
  const session = requireSession(event);
  if (!session.ok) return json(session.status || 401, { ok: false, error: session.code || 'unauthorized' });
  if (!requireCsrf(event, session.token)) return json(403, { ok: false, error: 'csrf_failed' });

  if (!GMAIL_PASS) return json(500, { ok: false, error: 'mail_not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'invalid_json' }); }

  const leadId = String(body.leadId || '').trim();
  const text = String(body.body || '').trim();
  if (!leadId) return json(400, { ok: false, error: 'lead_required' });
  if (!text) return json(400, { ok: false, error: 'body_required' });
  if (text.length > MAX_BODY) return json(400, { ok: false, error: 'body_too_long' });

  // The recipient comes from the lead record, never from the request — so a
  // tampered call can't turn this into an open relay.
  const leadRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=id,name,email&limit=1`,
    { headers: sbHeaders() }
  );
  const leads = await leadRes.json();
  const lead = Array.isArray(leads) ? leads[0] : null;
  if (!lead) return json(404, { ok: false, error: 'lead_not_found' });
  if (!lead.email) return json(400, { ok: false, error: 'lead_has_no_email' });

  // Thread against their latest inbound message so Gmail groups the reply.
  let inReplyTo = null;
  let subject = String(body.subject || '').trim();
  try {
    const prevRes = await fetch(
      `${SUPABASE_URL}/rest/v1/emails?lead_id=eq.${encodeURIComponent(leadId)}&direction=eq.inbound&message_id=not.is.null&select=message_id,subject&order=created_at.desc&limit=1`,
      { headers: sbHeaders() }
    );
    const prev = await prevRes.json();
    if (Array.isArray(prev) && prev[0]) {
      inReplyTo = prev[0].message_id;
      if (!subject && prev[0].subject) {
        subject = /^re:/i.test(prev[0].subject) ? prev[0].subject : `Re: ${prev[0].subject}`;
      }
    }
  } catch (e) {
    console.warn('[email-reply] thread lookup failed:', e.message);
  }
  if (!subject) subject = 'Rosalia Group';

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    const headers = inReplyTo ? { 'In-Reply-To': inReplyTo, References: inReplyTo } : undefined;
    const info = await transporter.sendMail({
      from: `"Rosalia Group" <${GMAIL_USER}>`,
      to: lead.email,
      subject,
      text,
      // Plain text only: this is a person typing a reply, and an HTML wrapper
      // would just add markup they didn't write.
      headers,
    });

    // Record it so the CRM timeline shows the reply straight away.
    await logEmail({
      leadId,
      direction: 'outbound',
      subject,
      body: text,
      fromEmail: GMAIL_USER,
      toEmail: lead.email,
    });

    console.log(`[email-reply] sent to ${lead.email} | threaded=${Boolean(inReplyTo)}`);
    return json(200, { ok: true, messageId: info.messageId, threaded: Boolean(inReplyTo) });
  } catch (err) {
    console.error('[email-reply] send failed:', err.message);
    return json(500, { ok: false, error: 'send_failed' });
  }
};
