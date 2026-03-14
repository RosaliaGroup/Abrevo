const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const BOOKING_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';

function isValidEmail(email) {
  if (!email) return false;
  if (email.includes('incomplete-')) return false;
  if (email.includes('convo.zillow.com')) return false;
  if (email.includes('newjerseyhomesbyrosalia.com')) return false;
  if (email.includes('testlead@')) return false;
  if (!email.includes('@')) return false;
  return true;
}

async function getUnrepliedLeads() {
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?created_at=gte.${since.toISOString()}&email=not.is.null&email_reply=is.null&limit=50&order=created_at.desc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return (Array.isArray(data) ? data : []).filter(l => isValidEmail(l.email));
}

async function generateReply(name, source, message) {
  const first = (name || '').split(' ')[0] || 'there';
  const prompt = `You are the Rosalia Group Inquiries Team in New Jersey.
Write a SHORT warm outreach email to a lead we haven't contacted yet.
- Greet them by first name: ${first}
- Mention we have great rental properties available in NJ
- Invite them to schedule a tour: ${BOOKING_URL}
- Ask for their phone number if not in their info
- Keep it under 80 words, no bullet points
- Sign off: Rosalia Group | Inquiries Team | +18624191763 | inquiries@rosaliagroup.com
Lead source: ${source || 'inquiry'}
Their info: ${(message || 'General inquiry').substring(0, 200)}
Write ONLY the email body.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function sendEmail(toEmail, toName, body) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
  await transporter.sendMail({
    from: `"Rosalia Group Inquiries" <${GMAIL_USER}>`,
    to: toEmail,
    subject: `Your Inquiry â€” Rosalia Group`,
    text: body,
  });
}

async function markReplied(leadId, replyText) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ email_reply: replyText, replied_at: new Date().toISOString() }),
  });
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const leads = await getUnrepliedLeads();
    console.log(`Found ${leads.length} unreplied leads`);

    const results = { sent: 0, errors: 0, skipped: 0 };

    for (const lead of leads) {
      try {
        const reply = await generateReply(lead.name, lead.source, lead.message);
        if (!reply) { results.skipped++; continue; }

        await sendEmail(lead.email, lead.name, reply);
        await markReplied(lead.id, reply);
        results.sent++;
        console.log(`Sent to: ${lead.name} <${lead.email}>`);

        // Small delay to avoid Gmail rate limits
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.error(`Error for ${lead.name}:`, err.message);
        results.errors++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, total: leads.length, results }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
