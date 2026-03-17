const nodemailer = require('nodemailer');

const SALES_EMAIL = 'sales@mechanicalenterprise.com';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

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
