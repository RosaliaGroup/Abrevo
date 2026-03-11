// ─────────────────────────────────────────────
// outbound.js — Rosalia Group Outbound Call Trigger
// Triggers Alex (Vapi) to call any lead from any source
// POST body: { phone, name, email, source, property, category }
// category: "luxury" | "general" (defaults to "general")
// ─────────────────────────────────────────────

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';

// Vapi config per category
const VAPI_CONFIG = {
  luxury: {
    assistantId: '1cae5323-6b83-4434-8461-6330472da140', // Rosalia Luxury Portfolio Outbound
    phoneNumberId: '339c7317-ab98-4696-8ac3-9c71349557cd',
    label: 'Luxury Portfolio',
  },
  general: {
    assistantId: '53245859-6ed5-467f-b557-88456ee2f10b', // Rosalia General Rentals Outbound
    phoneNumberId: '339c7317-ab98-4696-8ac3-9c71349557cd',
    label: 'General Rentals',
  },
};

// ── BUSINESS HOURS (Eastern Time) ──
function isBusinessHours() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const time = et.getHours() + et.getMinutes() / 60;
  if (day === 0) return time >= 10 && time < 17; // Sunday
  if (day === 6) return time >= 10 && time < 17; // Saturday
  return time >= 9 && time < 18;                  // Weekday
}

// ── NORMALIZE PHONE ──
function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.toString().replace(/\D/g, '');
  if (p.length === 10) p = '+1' + p;
  else if (p.length === 11 && !p.startsWith('+')) p = '+' + p;
  return p;
}

// ── SEND SMS ──
async function sendSMS(phone, message) {
  if (!phone) return null;
  try {
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
    });
    const result = await res.json();
    console.log('SMS to', phone, ':', result.success ? 'SUCCESS' : 'FAILED', result);
    return result;
  } catch (err) {
    console.error('SMS error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── TRIGGER VAPI OUTBOUND CALL ──
async function triggerCall(phone, name, config, leadMeta = {}) {
  if (!VAPI_API_KEY) {
    console.error('Missing VAPI_API_KEY');
    return { success: false, error: 'Missing VAPI_API_KEY' };
  }

  try {
    const res = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VAPI_API_KEY}`,
      },
      body: JSON.stringify({
        phoneNumberId: config.phoneNumberId,
        assistantId: config.assistantId,
        customer: {
          number: phone,
          name: name || undefined,
        },
        assistantOverrides: {
          variableValues: {
            lead_name: name || '',
            lead_property: leadMeta.property || '',
            lead_source: leadMeta.source || 'rosalia',
            lead_email: leadMeta.email || '',
            booking_link: leadMeta.bookingLink || BOOKING_FORM_URL,
          },
        },
      }),
    });

    const data = await res.json();
    console.log('Vapi call triggered:', JSON.stringify(data));
    return { success: !data.error, callId: data.id, error: data.error };
  } catch (err) {
    console.error('Vapi call error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── VOICEMAIL / NO-ANSWER TEXT ──
// Mirrors Alex's voicemail script + booking link
function buildNoAnswerSMS(name, bookingLink) {
  const first = name?.split(' ')[0] || 'there';
  return `Hi ${first} — this is Alex from Rosalia Group. I tried reaching you about luxury apartments in New Jersey. We have brand new buildings in Newark and Orange with balconies, backyards, rooftop access, and stunning finishes — starting at $1,999/mo with up to 2 months free right now. Availability is very limited! Book a tour here: ${bookingLink} or call us at (862) 419-1814.`;
}

// ── INTERESTED LEAD TEXT ──
// Sent when lead confirms interest on live call
function buildInterestedSMS(name, bookingLink) {
  const first = name?.split(' ')[0] || 'there';
  return `Hi ${first}! Here's your tour booking link for Rosalia Group: ${bookingLink}\n\nAs soon as we receive your booking we'll be in touch to confirm everything. See you soon! — Alex, Rosalia Group (862) 419-1814`;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      phone,
      name,
      email,
      source = 'manual',
      property = '',
      category = 'general', // "luxury" | "general"
      action = 'call',      // "call" | "text_interested" | "text_no_answer"
    } = body;

    if (!phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'phone is required' }) };
    }

    const normalizedPhone = normalizePhone(phone);
    const config = VAPI_CONFIG[category] || VAPI_CONFIG.general;
    const bookingLink = `${BOOKING_FORM_URL}${normalizedPhone ? '?phone=' + encodeURIComponent(normalizedPhone) : ''}`;
    const leadMeta = { property, source, email, bookingLink };

    console.log('Outbound request:', { action, category, phone: normalizedPhone, name, source });

    // ── ACTION: text_interested (sent by Alex during live call) ──
    if (action === 'text_interested') {
      const msg = buildInterestedSMS(name, bookingLink);
      const smsResult = await sendSMS(normalizedPhone, msg);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, action: 'text_interested', sms: smsResult }),
      };
    }

    // ── ACTION: text_no_answer (sent after missed call) ──
    if (action === 'text_no_answer') {
      const msg = buildNoAnswerSMS(name, bookingLink);
      const smsResult = await sendSMS(normalizedPhone, msg);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, action: 'text_no_answer', sms: smsResult }),
      };
    }

    // ── ACTION: call (default) ──
    const withinHours = isBusinessHours();

    if (!withinHours) {
      // Outside business hours — send text instead
      const msg = buildNoAnswerSMS(name, bookingLink);
      const smsResult = await sendSMS(normalizedPhone, msg);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          action: 'text_outside_hours',
          message: 'Outside business hours — SMS sent instead of call',
          sms: smsResult,
        }),
      };
    }

    // Trigger the call
    const callResult = await triggerCall(normalizedPhone, name, config, leadMeta);

    // If call fails, fall back to SMS
    if (!callResult.success) {
      console.warn('Call failed — falling back to SMS');
      const msg = buildNoAnswerSMS(name, bookingLink);
      const smsResult = await sendSMS(normalizedPhone, msg);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          action: 'text_fallback',
          callError: callResult.error,
          sms: smsResult,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        action: 'call',
        callId: callResult.callId,
        category: config.label,
        phone: normalizedPhone,
      }),
    };

  } catch (err) {
    console.error('Outbound error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
