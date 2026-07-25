// sendForm.js -- texts the caller their Rosalia Group / Iron 65 booking or
// reschedule link. Sends via Telnyx (functions/lib/sms.js) from +12014269354.
//
// ROSALIA ONLY. The old HVAC branch has been removed: neither Mechanical
// assistant uses this endpoint (both use MechanicalSendFormTelnyx against
// mechanicalenterprise.com), and a fuzzy property-string match was capable
// of sending a Rosalia caller a Mechanical Enterprise link. If an HVAC-ish
// property does arrive here it is refused loudly rather than guessed at.
//
// `success` reflects whether the SMS actually sent.

const { sendSMS } = require('./lib/sms');

const SITE_URL = 'https://book.rosaliagroup.com';

const URLS = {
  book: `${SITE_URL}/book`,
  reschedule: `${SITE_URL}/reschedule`,
  iron65: `${SITE_URL}/iron65`,
  iron65Reschedule: `${SITE_URL}/iron65-reschedule`,
};

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

    const prop = (property || '').toLowerCase();

    // Refuse HVAC/Mechanical rather than sending a Rosalia link to an HVAC
    // caller (or the reverse). Mechanical has its own endpoint.
    if (/hvac|mechanical/.test(prop)) {
      console.error(`sendForm REFUSED: HVAC property routed to Rosalia endpoint -- "${property}"`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          smsSent: false,
          error: 'wrong_tenant',
          message:
            'This endpoint sends Rosalia Group and Iron 65 links only. HVAC requests must use the Mechanical send-form endpoint.',
        }),
      };
    }

    const isIron65 = /iron ?65|mcwhorter/.test(prop);
    const isReschedule = type === 'reschedule';

    const formUrl = isReschedule
      ? (isIron65 ? URLS.iron65Reschedule : URLS.reschedule)
      : (isIron65 ? URLS.iron65 : URLS.book);

    const firstName = (name || '').split(' ')[0] || 'there';
    const actionText = isReschedule ? 'reschedule your tour' : 'book your tour';
    const brandName = isIron65 ? 'Iron 65' : 'Rosalia Group';

    const message = `Hi ${firstName}! ${brandName} here. Here's your link to ${actionText}: ${formUrl}`;

    console.log(`sendForm -> telnyx | ${brandName} | ${formUrl}`);

    const result = await sendSMS(phone, message, { optOut: true });
    const smsSent = result && result.success === true;
    const errText = smsSent ? null : String((result && result.error) || 'SMS failed to send');

    if (!smsSent) console.error(`sendForm FAILED: ${errText}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: smsSent,
        smsSent,
        provider: 'telnyx',
        brand: brandName,
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
