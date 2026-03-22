const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-rosalia';
const IRON65_BOOKING_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';
const TEXTBELT_KEY = process.env.TEXTBELT_KEY;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

async function sendFollowUpEmail(lead, attempt) {
  if (!lead.email || lead.email.includes('reply.avail.co') || lead.email.includes('convo.zillow')) return;
  const firstName = (lead.name || '').split(' ')[0] || 'there';
  const isIron65 = lead.client === 'iron65';
  const bookingUrl = isIron65 ? IRON65_BOOKING_URL : BOOKING_FORM_URL;
  const property = isIron65 ? 'Iron 65' : 'our properties';

  const subjects = [
    `${firstName}, still looking for an apartment?`,
    `Last chance — tours filling up fast at ${property}`,
  ];
  const bodies = [
    `Hi ${firstName},\n\nJust following up on your inquiry about ${property}. We still have units available and would love to schedule a tour for you.\n\nBook your tour here: ${bookingUrl}\n\nBest regards,\nRosalia Group\n(862) 333-1681`,
    `Hi ${firstName},\n\nWe wanted to reach out one more time — tours at ${property} are filling up quickly. If you're still interested, grab your spot now.\n\nBook here: ${bookingUrl}\n\nBest regards,\nRosalia Group\n(862) 333-1681`,
  ];

  const subject = subjects[attempt - 2] || subjects[0];
  const body = bodies[attempt - 2] || bodies[0];

  try {
    await transporter.sendMail({
      from: '"Rosalia Group" <inquiries@rosaliagroup.com>',
      to: lead.email,
      subject,
      text: body,
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
  const firstName = (lead.name || '').split(' ')[0] || 'there';
  const isIron65 = lead.client === 'iron65';
  const bookingUrl = isIron65 ? IRON65_BOOKING_URL : BOOKING_FORM_URL;
  const msg = attempt === 2
    ? `Hi ${firstName}! Still looking for an apartment? We have units available. Book a tour: ${bookingUrl}`
    : `Hi ${firstName}! Last chance — tours filling up fast. Book now: ${bookingUrl}`;
  try {
    let p = lead.phone.toString().replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11) p = '+' + p;
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: p, message: msg, key: TEXTBELT_KEY }),
    });
    console.log(`Follow-up SMS #${attempt} sent to:`, lead.phone);
  } catch (e) { console.error('Follow-up SMS error:', e.message); }
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
      `${SUPABASE_URL}/rest/v1/leads?replied_at=not.is.null&status=neq.booked&follow_up_count=lt.2&replied_at=lt.${twoDaysAgo}&select=id,name,email,phone,client,replied_at,follow_up_count,last_follow_up_at`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const leads = await res.json();
    if (!Array.isArray(leads)) { console.log('No leads found'); return { statusCode: 200, headers, body: JSON.stringify({ success: true, processed: 0 }) }; }

    let processed = 0;
    for (const lead of leads) {
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
