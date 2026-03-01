const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const BASE_URL = 'https://silver-ganache-1ee2ca.netlify.app';

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { phone, type } = JSON.parse(event.body || '{}');

    if (!phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'phone required' }) };
    }

    // Normalize phone
    let normalized = phone.toString().replace(/\D/g, '');
    if (!normalized.startsWith('+')) normalized = '+1' + normalized;

    // Determine form type (booking or reschedule)
    const formType = type === 'reschedule' ? 'reschedule' : 'booking';
    const formPath = formType === 'reschedule' ? '/reschedule-form' : '/booking-form';
    const formUrl = `${BASE_URL}${formPath}?phone=${encodeURIComponent(normalized)}`;

    const message = formType === 'reschedule'
      ? `Iron 65 — Reschedule your appointment here:\n${formUrl}\n\nQuestions? Call (862) 333-1681`
      : `Iron 65 — Complete your tour booking here:\n${formUrl}\n\nQuestions? Call (862) 333-1681`;

    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: normalized, message, key: TEXTBELT_KEY }),
    });
    const result = await res.json();
    console.log('sendForm SMS result:', JSON.stringify(result));

    if (result.success) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, formType, formUrl }) };
    } else {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: result.error }) };
    }

  } catch (err) {
    console.error('sendForm error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
