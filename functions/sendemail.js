const nodemailer = require('nodemailer');

const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

async function generateEmail(name, property) {
  try {
    const firstName = (name || 'there').split(' ')[0];
    const isIron65 = (property || '').toLowerCase().includes('iron');
    
    const prompt = isIron65 
      ? `Write a short 3-sentence outreach email to ${firstName} who previously inquired about Iron 65 Luxury Apartments in Newark NJ. Mention rooftop NYC views, up to 2 months free, and invite them to book a free tour at https://silver-ganache-1ee2ca.netlify.app/booking-form. Sign as Iron 65 Leasing Team, (862) 333-1681. No markdown, no subject line, just the email body.`
      : `Write a short 3-sentence outreach email to ${firstName} who previously inquired about Rosalia Group luxury apartments in New Jersey. Mention available units from $1,999/mo, up to 2 months free, and invite them to book a free tour at https://silver-ganache-1ee2ca.netlify.app/booking-rosalia. Sign as Rosalia Group Leasing Team, (201) 449-6850. No markdown, no subject line, just the email body.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch(e) {
    console.error('AI email gen error:', e.message);
    return null;
  }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { to, name, subject, emailBody, property } = body;

    if (!to || !to.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid email address required' }) };
    }

    // Skip relay/invalid emails
    if (to.includes('convo.zillow') || to.includes('@reply.') || to.includes('followupboss')) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: 'Skipped relay email' }) };
    }

    const firstName = (name || 'there').split(' ')[0];
    const isIron65 = (property || '').toLowerCase().includes('iron') || (property || '').toLowerCase().includes('iron65');

    // Use provided body or generate with AI
    let finalBody = emailBody;
    if (!finalBody) {
      finalBody = await generateEmail(name, property);
    }

    // Fallback if AI fails
    if (!finalBody) {
      const bookingUrl = isIron65 
        ? 'https://silver-ganache-1ee2ca.netlify.app/booking-form'
        : 'https://silver-ganache-1ee2ca.netlify.app/booking-rosalia';
      const phone = isIron65 ? '(862) 333-1681' : '(201) 449-6850';
      const brand = isIron65 ? 'Iron 65 Luxury Apartments' : 'Rosalia Group';
      finalBody = `Hi ${firstName},\n\nThank you for your interest in ${brand}! We have luxury apartments available now with up to 2 months free on select leases. Book your free tour here: ${bookingUrl}\n\nLooking forward to hearing from you!\n\n${brand} Leasing Team\n${phone}`;
    }

    const emailSubject = subject || (isIron65 
      ? `Hi ${firstName} â€” Your Iron 65 Apartment Tour` 
      : `Hi ${firstName} â€” Your Rosalia Group Apartment Tour`);

    const fromName = isIron65 ? 'Iron 65 Leasing Team' : 'Rosalia Group Leasing Team';

    await transporter.sendMail({
      from: `"${fromName}" <${GMAIL_USER}>`,
      to,
      subject: emailSubject,
      text: finalBody,
    });

    console.log(`Email sent to ${to}`);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch(e) {
    console.error('sendemail error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
