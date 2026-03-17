const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;

const REASONS = {
  price: 'Price was too high',
  found_other: 'Found another place',
  location: "Location didn't work",
  size: "Unit size wasn't right",
  qualify: "Didn't meet qualification requirements",
  tour: 'Tour experience',
  timing: "Timing wasn't right",
  other: 'Other reason',
};

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { leadId, leadName, reason, comments } = JSON.parse(event.body || '{}');
    const reasonText = REASONS[reason] || reason || 'Not specified';

    // Save to Supabase
    if (leadId) {
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          status: 'survey_completed',
          notes: `Survey: ${reasonText}${comments ? ' | Comment: ' + comments : ''}`,
        }),
      });
    }

    // Email Ana with the feedback
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
    await transporter.sendMail({
      from: `"Rosalia AI System" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject: `Survey Response: ${leadName || 'Lead'} -- ${reasonText}`,
      text: `Survey feedback received!\n\nLead: ${leadName || 'Unknown'}\nReason: ${reasonText}\nComments: ${comments || 'None'}\n\nLead ID: ${leadId || 'N/A'}`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Survey error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
