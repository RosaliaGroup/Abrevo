const nodemailer = require('nodemailer');

const SALES_EMAIL = 'sales@mechanicalenterprise.com';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

const { requireInternalToken, NO_CORS } = require('./_internal-auth');

exports.handler = async (event) => {
  const headers = NO_CORS; // server-to-server; not browser-facing
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  // INTERNAL token required (default-deny) BEFORE method check, body parse, or logic.
  // Never expose the token to browser code.
  const gate = requireInternalToken(event);
  if (!gate.ok) return gate.response;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      caller_name, caller_phone, caller_email,
      appointment_type, appointment_date, appointment_time,
      call_summary, outcome
    } = body;

    const subject = `Call Recap -- ${caller_name || 'Unknown'} -- ${outcome || 'info_only'}`;
    const text = `CALL RECAP -- Mechanical Enterprise AI

Caller: ${caller_name || 'N/A'}
Phone: ${caller_phone || 'N/A'}
Email: ${caller_email || 'N/A'}

Appointment Type: ${appointment_type || 'N/A'}
Date: ${appointment_date || 'N/A'}
Time: ${appointment_time || 'N/A'}

Outcome: ${outcome || 'N/A'}

Summary:
${call_summary || 'No summary provided.'}

---
Sent by Mechanical Enterprise AI Assistant`;

    await transporter.sendMail({
      from: '"Mechanical Enterprise AI" <inquiries@rosaliagroup.com>',
      to: SALES_EMAIL,
      subject,
      text,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch(e) {
    console.error('sendCallRecap error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
