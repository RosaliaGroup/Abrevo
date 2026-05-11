const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';
const ANA_PHONE = '+12014970225';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

async function sendSMS(phone, message) {
  try {
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
    });
    return res.json();
  } catch (err) {
    console.error('SMS error:', err.message);
    return { success: false };
  }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { phone, reason } = JSON.parse(event.body || '{}');
    if (!phone) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Phone required' }) };

    let normalizedPhone = phone.toString().replace(/\D/g, '');
    if (!normalizedPhone.startsWith('+')) normalizedPhone = '+1' + normalizedPhone;

    // Step 1: GET most recent booking by phone
    const getRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(normalizedPhone)}&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const bookings = await getRes.json();
    if (!bookings || bookings.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No booking found' }) };
    }
    const booking = bookings[0];

    // Step 2: Update Supabase by ID
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        additional_notes: `CANCELLED — Reason: ${reason || 'Not specified'} | ${new Date().toLocaleDateString()}`,
      }),
    });

    const propertyAddress = booking.type || 'your appointment';
    const displayDate = booking.preferred_date || 'TBD';
    const displayTime = booking.preferred_time || 'TBD';
    const firstName = (booking.full_name || 'there').split(' ')[0];

    // Step 3: Send confirmation email to lead + CC inquiries
    if (booking.email) {
      const emailHtml = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#e8e8e8;padding:40px;">
          <div style="text-align:center;margin-bottom:30px;">
            <h1 style="color:#C9A84C;font-size:22px;letter-spacing:3px;text-transform:uppercase;">Appointment Cancelled</h1>
          </div>
          <p>Dear ${firstName},</p>
          <p>Your appointment has been successfully cancelled.</p>
          <div style="background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:20px;margin:20px 0;">
            <p style="margin:6px 0;"><strong>Property:</strong> ${propertyAddress}</p>
            <p style="margin:6px 0;"><strong>Was scheduled:</strong> ${displayDate} at ${displayTime}</p>
            ${reason ? `<p style="margin:6px 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
          </div>
          <p>If you change your mind, you can always book a new tour:</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="https://book.rosaliagroup.com/book" style="display:inline-block;background:#C9A84C;color:#0A0A0A;font-size:12px;letter-spacing:3px;text-transform:uppercase;padding:14px 32px;text-decoration:none;font-weight:bold;border-radius:2px;">Book New Tour</a>
          </div>
          <p style="color:#999;font-size:12px;">Questions? Call (862) 333-1681 or email inquiries@rosaliagroup.com</p>
          <p style="color:#999;font-size:12px;">Rosalia Group</p>
        </div>`;
      try {
        await transporter.sendMail({
          from: '"Rosalia Group" <ana@rosaliagroup.com>',
          to: booking.email,
          cc: 'inquiries@rosaliagroup.com',
          subject: `Appointment Cancelled — ${propertyAddress}`,
          html: emailHtml,
        });
        console.log('Cancellation email sent to:', booking.email);
      } catch (err) {
        console.error('Email error:', err.message);
      }
    }

    // Step 4: SMS to lead
    const leadMsg = `Your appointment at ${propertyAddress} on ${displayDate} at ${displayTime} has been cancelled. Book a new tour anytime at book.rosaliagroup.com — Rosalia Group (862) 333-1681`;
    await sendSMS(normalizedPhone, leadMsg);

    // Step 5: Notify Ana
    const teamMsg = `Appointment Cancelled!\n\nName: ${booking.full_name}\nPhone: ${normalizedPhone}\nEmail: ${booking.email || 'N/A'}\nProperty: ${propertyAddress}\nWas: ${displayDate} at ${displayTime}\nReason: ${reason || 'Not specified'}`;
    await sendSMS(ANA_PHONE, teamMsg);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('Cancel error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
