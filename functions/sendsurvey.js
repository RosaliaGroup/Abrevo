const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const TEXTBELT_KEY = process.env.TEXTBELT_KEY;
const SITE_URL = 'https://abrevo.co';

// Find leads to survey:
// 1. Had a tour (called_at set) but no application after 7 days
// 2. Has email_reply but no response in 5 days and status still 'new'
// 3. Status = 'not_interested'
async function findSurveyLeads() {
  const now = new Date();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?` +
    `email=not.is.null&` +
    `status=neq.survey_completed&status=neq.rented&` +
    `survey_sent=is.null&` +
    `or=(` +
      `and(called_at.lt.${sevenDaysAgo},status.eq.contacted),` +
      `and(replied_at.lt.${fiveDaysAgo},status.eq.new,email_reply.not.is.null),` +
      `status.eq.not_interested` +
    `)&` +
    `limit=10&order=created_at.desc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return Array.isArray(data) ? data.filter(l => {
    if (!l.email) return false;
    if (l.email.includes('convo.zillow')) return false;
    if (l.email.includes('newjerseyhomesbyrosalia')) return false;
    if (l.email.includes('incomplete-')) return false;
    return true;
  }) : [];
}

async function markSurveySent(leadId) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ survey_sent: new Date().toISOString() }),
  });
}

async function sendSurveyEmail(lead) {
  const surveyUrl = `${SITE_URL}/survey?id=${lead.id}&name=${encodeURIComponent(lead.name || '')}`;
  const firstName = (lead.name || '').split(' ')[0] || 'there';

  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
  const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.8;color:#333;max-width:600px;">
<p>Hi ${firstName},</p>
<p>We noticed you were looking at apartments with us recently but haven't moved forward yet. We completely understand -- finding the right home takes time!</p>
<p>We'd love to hear your feedback so we can improve. It takes less than 60 seconds:</p>
<p><a href="${surveyUrl}" style="background:#c9a84c;color:#0a0a0a;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:500;display:inline-block;">Share Quick Feedback >'</a></p>
<p style="color:#888;font-size:13px;">If your situation changes, we'd love to have you visit. We add new units and promotions regularly.</p>
<br/>
<p>Rosalia Group | Inquiries Team | +18624191763 | inquiries@rosaliagroup.com</p>
</div>`;

  await transporter.sendMail({
    from: `"Rosalia Group Inquiries" <${GMAIL_USER}>`,
    to: lead.email,
    subject: `Quick question for you -- Rosalia Group`,
    html: htmlBody,
    text: `Hi ${firstName},\n\nWe noticed you were looking at apartments with us recently. We'd love your feedback -- it takes less than 60 seconds:\n\n${surveyUrl}\n\nRosalia Group | Inquiries Team | +18624191763`,
  });
}

async function sendSurveySMS(lead) {
  if (!lead.phone || !TEXTBELT_KEY) return;
  const surveyUrl = `${SITE_URL}/survey?id=${lead.id}&name=${encodeURIComponent(lead.name || '')}`;
  const firstName = (lead.name || '').split(' ')[0] || 'there';
  const msg = `Hi ${firstName}! Rosalia Group here. We'd love your feedback on your apartment search -- takes 60 seconds: ${surveyUrl}`;

  await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: lead.phone, message: msg, key: TEXTBELT_KEY }),
  });
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const leads = await findSurveyLeads();
    console.log(`Found ${leads.length} leads to survey`);

    const results = { sent: 0, errors: 0 };

    for (const lead of leads) {
      try {
        await sendSurveyEmail(lead);
        if (lead.phone) await sendSurveySMS(lead);
        await markSurveySent(lead.id);
        results.sent++;
        console.log(`Survey sent to: ${lead.name} <${lead.email}>`);
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error(`Survey error for ${lead.name}:`, err.message);
        results.errors++;
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, total: leads.length, results }) };
  } catch (err) {
    console.error('sendsurvey error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
