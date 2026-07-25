// sendForm.js -- texts the caller a booking or reschedule form link.
//
// Rosalia + Iron 65 now send via Telnyx (functions/lib/sms.js) from the
// registered number +12014269354.
//
// The HVAC branch is deliberately left on its original Textbelt path.
// Mechanical runs its own sender (mechanicalenterprise.com), and its
// behaviour here must not change.
//
// Returns honest results: `success` now reflects whether the SMS actually
// sent. Previously it was hardcoded true, which is why a 13-day Textbelt
// outage showed as "Completed successfully" on every call.

const { sendSMS: sendViaTelnyx } = require('./lib/sms');

const TEXTBELT_KEY = process.env.TEXTBELT_KEY;
const SITE_URL = 'https://book.rosaliagroup.com';

// Legacy sender -- HVAC only, unchanged.
async function sendViaTextbelt(phone, message) {
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
    const isHVAC = (property || '').toLowerCase().includes('hvac') ||
                   (property || '').toLowerCase().includes('mechanical') ||
                   (property || '').toLowerCase().includes('mechanical enterprise');

    const isReschedule = type === 'reschedule';

    let formUrl;
    if (isHVAC) {
      formUrl = isReschedule
        ? 'https://book.mechanicalenterprise.com/hvac-reschedule'
        : 'https://book.mechanicalenterprise.com/hvac';
    } else if (isReschedule) {
      formUrl = isIron65
        ? 'https://book.rosaliagroup.com/iron65-reschedule'
        : 'https://book.rosaliagroup.com/reschedule';
    } else {
      formUrl = isIron65
        ? 'https://book.rosaliagroup.com/iron65'
        : 'https://book.rosaliagroup.com/book';
    }

    const firstName = (name || '').split(' ')[0] || 'there';
    const actionText = isReschedule ? 'reschedule your tour' : 'book your tour';
    const brandName = isHVAC ? 'Mechanical Enterprise' : (isIron65 ? 'Iron 65' : 'Rosalia Group');

    const message = `Hi ${firstName}! ${brandName} here. Here's your link to ${actionText}: ${formUrl}`;

    const provider = isHVAC ? 'textbelt' : 'telnyx';
    console.log(`sendForm -> ${provider} | ${formUrl}`);

    const result = isHVAC
      ? await sendViaTextbelt(phone, message)
      : await sendViaTelnyx(phone, message, { optOut: true });

    const smsSent = result && result.success === true;
    const errText = smsSent ? null : String((result && result.error) || 'SMS failed to send');

    if (!smsSent) console.error(`sendForm FAILED via ${provider}: ${errText}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: smsSent,
        smsSent,
        provider,
        formUrl,
        messageId: (result && result.id) || null,
        error: errText,
        message: smsSent ? 'Form link sent successfully' : `SMS failed to send: ${errText}`,
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
