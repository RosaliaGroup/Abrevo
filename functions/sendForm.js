// sendForm.js -- texts the caller a Rosalia Group / Iron 65 booking link,
// a reschedule link, or the TheGuarantors application link.
// Sends via Telnyx (functions/lib/sms.js) from +12014269354.
//
// ROSALIA ONLY. Mechanical uses its own endpoint
// (mechanicalenterprise.com); HVAC properties are refused here rather than
// guessed at, which previously sent Rosalia callers a Mechanical link.
//
// type parameter:
//   omitted        -> new booking link
//   "reschedule"   -> reschedule link
//   "guarantors"   -> TheGuarantors referral application link
//
// `success` reflects whether the SMS actually sent.

const { sendSMS } = require('./lib/sms');

const SITE_URL = 'https://book.rosaliagroup.com';

const GUARANTORS_URL =
  'https://app.theguarantors.com/referral/sign-up/ad295b820fb11b34ee2f5cc96f1acf659032ce4fd9280a9fa1f380582aeda1a2';

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
    const t = String(type || '').toLowerCase().trim();
    const isGuarantors = t === 'guarantors';
    const isReschedule = t === 'reschedule';

    // Refuse HVAC/Mechanical rather than sending a Rosalia link to an HVAC
    // caller. Skipped for guarantors, which is tenant-agnostic.
    if (!isGuarantors && /hvac|mechanical/.test(prop)) {
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
    const firstName = (name || '').split(' ')[0] || 'there';
    const brandName = isIron65 ? 'Iron 65' : 'Rosalia Group';

    let formUrl;
    let message;
    let kind;

    if (isGuarantors) {
      kind = 'guarantors';
      formUrl = GUARANTORS_URL;
      message =
        `Hi ${firstName}! ${brandName} here. Here's the link to apply with TheGuarantors — ` +
        `it's free to apply and you'll find out if you're approved before committing to anything: ${formUrl}`;
    } else {
      kind = isReschedule ? 'reschedule' : 'booking';
      formUrl = isReschedule
        ? (isIron65 ? URLS.iron65Reschedule : URLS.reschedule)
        : (isIron65 ? URLS.iron65 : URLS.book);
      const actionText = isReschedule ? 'reschedule your tour' : 'book your tour';
      message = `Hi ${firstName}! ${brandName} here. Here's your link to ${actionText}: ${formUrl}`;
    }

    console.log(`sendForm -> telnyx | ${kind} | ${brandName} | ${formUrl}`);

    const result = await sendSMS(phone, message, { optOut: true });
    const smsSent = result && result.success === true;
    const errText = smsSent ? null : String((result && result.error) || 'SMS failed to send');

    if (!smsSent) console.error(`sendForm FAILED (${kind}): ${errText}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: smsSent,
        smsSent,
        provider: 'telnyx',
        kind,
        brand: brandName,
        formUrl,
        messageId: (result && result.id) || null,
        error: errText,
        message: smsSent ? `${kind} link sent successfully` : `SMS failed to send: ${errText}`,
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
