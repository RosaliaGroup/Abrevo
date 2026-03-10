const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const { phone, name, property } = JSON.parse(event.body || '{}');
    if (!phone) return { statusCode: 200, headers, body: JSON.stringify({ smsSent: false }) };
    let normalized = phone.toString().replace(/\D/g, '');
    if (!normalized.startsWith('+')) normalized = '+1' + normalized;
    const bookingLink = BOOKING_FORM_URL + '?phone=' + encodeURIComponent(normalized);
    const firstName = name ? name.split(' ')[0] : 'there';
    const message = 'Hi ' + firstName + '! Book your tour at ' + (property || 'Iron 65') + ' here: ' + bookingLink + ' — Rosalia Group (862) 333-1681';
    const res = await fetch('https://textbelt.com/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: normalized, message, key: TEXTBELT_KEY }) });
    const result = await res.json();
    console.log('Textbelt:', JSON.stringify(result));
    return { statusCode: 200, headers, body: JSON.stringify({ smsSent: result.success === true, bookingLink, quotaRemaining: result.quotaRemaining }) };
  } catch (err) {
    console.error(err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ smsSent: false, error: err.message }) };
  }
};