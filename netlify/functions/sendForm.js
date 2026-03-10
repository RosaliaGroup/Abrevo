const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const BASE_URL = 'https://silver-ganache-1ee2ca.netlify.app';

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const { phone, name, property, type } = JSON.parse(event.body || '{}');
    if (!phone) return { statusCode: 200, headers, body: JSON.stringify({ smsSent: false }) };
    let normalized = phone.toString().replace(/\D/g, '');
    if (normalized.length === 10) normalized = '+1' + normalized;
else if (normalized.length === 11 && normalized.startsWith('1')) normalized = '+' + normalized;
else if (!normalized.startsWith('+')) normalized = '+' + normalized;
    const encodedPhone = encodeURIComponent(normalized);
    const isReschedule = type === 'reschedule';
    const link = isReschedule
      ? `${BASE_URL}/reschedule-form.html?phone=${encodedPhone}`
      : `${BASE_URL}/booking-form.html?phone=${encodedPhone}`;
    const firstName = name ? name.split(' ')[0] : 'there';
    const propertyName = property || 'Iron 65';
    const message = isReschedule
      ? `Hi ${firstName}! Reschedule your tour at ${propertyName}: ${link} — Rosalia Group (862) 333-1681`
      : `Hi ${firstName}! Book your tour at ${propertyName}: ${link} — Rosalia Group (862) 333-1681`;
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: normalized, message, key: TEXTBELT_KEY }),
    });
    const result = await res.json();
    console.log('Textbelt:', JSON.stringify(result));
    return { statusCode: 200, headers, body: JSON.stringify({ smsSent: result.success === true, bookingLink: link, quotaRemaining: result.quotaRemaining }) };
  } catch (err) {
    console.error('sendForm error:', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ smsSent: false, error: err.message }) };
  }
};