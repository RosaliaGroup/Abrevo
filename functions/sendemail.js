const nodemailer = require('nodemailer');

const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

async function alreadyEmailed(email) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&replied_at=not.is.null&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 && data[0].replied_at;
  } catch(e) { return false; }
}

async function markEmailed(email) {
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ replied_at: new Date().toISOString() }),
      }
    );
  } catch(e) { console.error('markEmailed error:', e.message); }
}

function buildIron65Email(firstName) {
  const bookingUrl = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';
  
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <tr><td style="background:#1a1a2e;padding:24px 32px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Iron 65 Luxury Apartments</h1>
    <p style="color:#a0a0c0;margin:6px 0 0;font-size:14px;">Newark's Ironbound District</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="color:#333;font-size:16px;margin:0 0 16px;">Hi ${firstName},</p>
    <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 16px;">
      We noticed you previously inquired about Iron 65 â€” we'd love to show you around our brand new luxury building in Newark's vibrant Ironbound District.
    </p>
    <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 16px;">
      <strong>Current Move-In Specials:</strong><br>
      &bull; <strong>1 month free</strong> on a 12-month lease<br>
      &bull; <strong>$4,000 rent credit</strong> on an 18-month lease<br>
      &bull; Amenity fee waived for 12 months<br>
      &bull; Free high-speed internet for 1 year (apply within 24hrs of tour)
    </p>
    <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Studios from $2,199/mo &bull; 1BR from $2,724/mo &bull; Lofts from $3,488/mo<br>
      Rooftop with NYC skyline views &bull; Yoga studio &bull; Cold plunge &bull; Steps from Newark Penn Station
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
      <tr><td style="background:#e53e3e;border-radius:6px;text-align:center;">
        <a href="${bookingUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Book Your Free Tour &rarr;</a>
      </td></tr>
    </table>
    <p style="color:#666;font-size:13px;margin:0;">
      Or call us at <strong>(862) 333-1681</strong> &bull; <a href="mailto:inquiries@rosaliagroup.com" style="color:#e53e3e;">inquiries@rosaliagroup.com</a>
    </p>
  </td></tr>
  <tr><td style="background:#f8f8f8;padding:16px 32px;text-align:center;border-top:1px solid #eee;">
    <p style="color:#999;font-size:12px;margin:0;">Iron 65 &bull; 65 McWhorter Street, Newark NJ 07105 &bull; iron65.com</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = `Hi ${firstName},\n\nWe noticed you previously inquired about Iron 65 Luxury Apartments in Newark's Ironbound District â€” we'd love to show you around!\n\nCurrent Move-In Specials:\n- 1 month free on a 12-month lease\n- $4,000 rent credit on an 18-month lease\n- Amenity fee waived 12 months\n- Free high-speed internet 1 year (apply within 24hrs of tour)\n\nStudios from $2,199/mo | 1BR from $2,724/mo | Lofts from $3,488/mo\nRooftop with NYC skyline views | Yoga studio | Cold plunge | Steps from Newark Penn Station\n\nBook your free tour: ${bookingUrl}\n\nOr call (862) 333-1681\n\nIron 65 Leasing Team\ninquiries@rosaliagroup.com\n65 McWhorter Street, Newark NJ 07105`;

  return { html, text };
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { to, name } = body;

    if (!to || !to.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid email required' }) };
    }

    // Skip relay/invalid emails
    if (to.includes('convo.zillow') || to.includes('@reply.') || to.includes('followupboss')) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: 'Skipped relay email' }) };
    }

    // Duplicate check - don't email same person twice
    const already = await alreadyEmailed(to);
    if (already) {
      console.log(`Skipping ${to} - already emailed`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: 'Already emailed' }) };
    }

    const firstName = (name || 'there').split(' ')[0];
    const { html, text } = buildIron65Email(firstName);

    await transporter.sendMail({
      from: '"Iron 65 Leasing Team" <inquiries@rosaliagroup.com>',
      to,
      subject: `Hi ${firstName} â€” Your Iron 65 Tour Awaits`,
      html,
      text,
    });

    // Mark as emailed in Supabase
    await markEmailed(to);

    console.log(`Email sent to ${to}`);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch(e) {
    console.error('sendemail error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
