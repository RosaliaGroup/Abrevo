const TEXTBELT_KEY = process.env.TEXTBELT_KEY || '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const SITE_URL = 'https://silver-ganache-1ee2ca.netlify.app';

async function sendSMS(phone, message) {
  let p = phone.toString().replace(/\D/g, '');
  if (p.length === 10) p = '+1' + p;
  else if (p.length === 11 && !p.startsWith('+')) p = '+' + p;
  const res = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: p, message, key: TEXTBELT_KEY }),
  });
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { phone, name, property, type } = body;

    if (!phone) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, smsSent: false, error: 'Phone number required' }),
      };
    }

    // Determine correct form URL based on property and type
    const isIron65 = (property || '').toLowerCase().includes('iron 65') ||
                     (property || '').toLowerCase().includes('mcwhorter') ||
                     (property || '').toLowerCase().includes('iron65');

    const isReschedule = type === 'reschedule';

    let formUrl;
    if (isReschedule) {
      formUrl = isIron65
        ? `${SITE_URL}/reschedule-form`
        : `${SITE_URL}/reschedule-rosalia`;
    } else {
      formUrl = isIron65
        ? `${SITE_URL}/booking-form`
        : `${SITE_URL}/booking-rosalia`;
    }

    const firstName = (name || '').split(' ')[0] || 'there';
    const actionText = isReschedule ? 'reschedule your tour' : 'book your tour';
    const brandName = isIron65 ? 'Iron 65' : 'Rosalia Group';

    const message = `Hi ${firstName}! ${brandName} here. Here's your link to ${actionText}: ${formUrl}`;

    console.log(`Sending form link to ${phone}: ${formUrl}`);
    const result = await sendSMS(phone, message);
    console.log('SMS result:', JSON.stringify(result));

    const smsSent = result?.success === true;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        smsSent,
        formUrl,
        message: smsSent ? 'Form link sent successfully' : 'SMS failed to send',
      }),
    };
  } catch (err) {
    console.error('sendForm error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, smsSent: false, error: err.message }),
    };
  }
};
