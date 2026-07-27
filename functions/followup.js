const nodemailer = require('nodemailer');
const { ELIGIBLE_STATUS_FILTER } = require('./lib/followup-eligibility');
const {
  buildFollowupPrompt,
  validateGeneratedEmailBody,
  assembleEmail,
  buildFallbackEmail,
  buildSMS,
  threadHeaders,
} = require('./lib/followup-content');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const BOOKING_FORM_URL = 'https://book.rosaliagroup.com/book';
const IRON65_BOOKING_URL = 'https://book.rosaliagroup.com/iron65';
const { sendSMS } = require('./lib/sms');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Ask Claude to improve ONLY the wording of a follow-up email. Returns the raw
// generated body text, or null on any failure (missing key, API error, network
// error, empty output) so the caller falls back to a static template. Logs are
// PII-safe: lead id + reason only, never name/email/message content.
async function generateFollowupBody(lead, attempt) {
  if (!ANTHROPIC_KEY) {
    console.log(`[followup] ANTHROPIC_API_KEY not set — static fallback for lead ${lead.id}`);
    return null;
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: buildFollowupPrompt(lead, attempt) }],
      }),
    });
    const data = await res.json();
    if (!res.ok || data.type === 'error') {
      console.log(`[followup] Claude API error for lead ${lead.id}: status ${res.status} — static fallback`);
      return null;
    }
    return data.content?.[0]?.text || null;
  } catch (e) {
    console.log(`[followup] Claude API call failed for lead ${lead.id}: ${e.message} — static fallback`);
    return null;
  }
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

async function sendFollowUpEmail(lead, attempt) {
  if (!lead.email || lead.email.includes('reply.avail.co') || lead.email.includes('convo.zillow')) return;
  const isIron65 = lead.client === 'iron65';
  const bookingUrl = isIron65 ? IRON65_BOOKING_URL : BOOKING_FORM_URL;

  // Improve wording via Claude; validate; fall back to a static template on any
  // failure. The trusted booking URL and opt-out are always added by code, never
  // generated or altered by the model.
  const generated = await generateFollowupBody(lead, attempt);
  const validation = generated ? validateGeneratedEmailBody(generated)
    : { ok: false, reason: 'no_generation' };
  let subject; let body;
  if (validation.ok) {
    ({ subject, body } = assembleEmail(lead, generated, bookingUrl));
  } else {
    ({ subject, body } = buildFallbackEmail(lead, attempt, bookingUrl));
    console.log(`[followup] fallback email path for lead ${lead.id} (attempt ${attempt}) reason=${validation.reason}`);
  }

  try {
    await transporter.sendMail({
      from: '"Rosalia Group" <inquiries@rosaliagroup.com>',
      to: lead.email,
      subject,
      text: body,
      // In-Reply-To / References only when valid stored metadata exists (none today).
      ...threadHeaders(lead),
    });
    console.log(`Follow-up email #${attempt} sent to:`, lead.email);
    return true;
  } catch (e) {
    console.error('Follow-up email error:', e.message);
    return false;
  }
}

async function sendFollowUpSMS(lead, attempt) {
  if (!lead.phone) return;
  const isIron65 = lead.client === 'iron65';
  const bookingUrl = isIron65 ? IRON65_BOOKING_URL : BOOKING_FORM_URL;
  const msg = buildSMS(lead, attempt, bookingUrl);
  // Route through the shared Telnyx sender (functions/lib/sms.js). buildSMS()
  // already includes "Reply STOP to opt out.", so withOptOut is a no-op backstop.
  const result = await sendSMS(lead.phone, msg, { optOut: true });
  console.log(`Follow-up SMS #${attempt} sent to:`, lead.phone, result.success);
}

exports.handler = async () => {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const now = new Date();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Get leads that got first reply but no booking, not yet followed up
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?replied_at=not.is.null&${ELIGIBLE_STATUS_FILTER}&follow_up_count=lt.2&replied_at=lt.${twoDaysAgo}&select=id,name,email,phone,client,status,property,message,email_reply,notes,replied_at,follow_up_count,last_follow_up_at`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const leads = await res.json();
    if (!Array.isArray(leads)) { console.log('No leads found'); return { statusCode: 200, headers, body: JSON.stringify({ success: true, processed: 0 }) }; }

    let processed = 0;
    for (const lead of leads) {
      // Defensive opt-out guard (belt-and-suspenders with the status whitelist above).
      if (lead.status === 'dnc') {
        console.log('[followup] skipped: dnc');
        continue;
      }
      const followUpCount = lead.follow_up_count || 0;
      const repliedAt = new Date(lead.replied_at);
      const lastFollowUp = lead.last_follow_up_at ? new Date(lead.last_follow_up_at) : null;
      const attempt = followUpCount + 2; // 2nd or 3rd contact

      // 2nd follow-up: 48hrs after first reply, no previous follow-up
      if (followUpCount === 0 && repliedAt < new Date(twoDaysAgo)) {
        await sendFollowUpEmail(lead, 2);
        await sendFollowUpSMS(lead, 2);
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          body: JSON.stringify({ follow_up_count: 1, last_follow_up_at: now.toISOString() }),
        });
        processed++;
      }
      // 3rd follow-up: 5 days after first reply, 1 follow-up already sent
      else if (followUpCount === 1 && repliedAt < new Date(fiveDaysAgo) && (!lastFollowUp || lastFollowUp < new Date(twoDaysAgo))) {
        await sendFollowUpEmail(lead, 3);
        await sendFollowUpSMS(lead, 3);
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          body: JSON.stringify({ follow_up_count: 2, last_follow_up_at: now.toISOString() }),
        });
        processed++;
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, processed, total: leads.length }) };
  } catch (e) {
    console.error('followup error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
