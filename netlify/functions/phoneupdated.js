// phoneupdated.js
// Triggered by Supabase webhook when a lead's phone number is updated
// Validates the number then fires an Alex outbound call

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/rosalia-booking';

// Vapi assistant IDs
const ASSISTANTS = {
  luxury: '1cae5323-6b83-4434-8461-6330472da140',   // Alex - Luxury Portfolio
  general: '53245859-6ed5-467f-b557-88456ee2f10b',  // Alex - General Rentals
};
const OUTBOUND_PHONE_ID = '339c7317-ab98-4696-8ac3-9c71349557cd';

// ── FAKE / INVALID NUMBER PATTERNS TO SKIP ──
const FAKE_PATTERNS = [
  /^(\+1)?5555555555$/,         // 555-555-5555
  /^(\+1)?0000000000$/,         // all zeros
  /^(\+1)?1111111111$/,         // all ones
  /^(\+1)?1234567890$/,         // sequential
  /^(\+1)?9999999999$/,         // all nines
  /^(\+1)?(\d)\1{9}$/,          // any repeated digit 10x (e.g. 2222222222)
  /^(\+1)?555\d{7}$/,           // any 555-xxxx (TV fake numbers)
  /^(\+1)?000/,                 // starts with 000
];

function isFakeNumber(phone) {
  const digits = phone.replace(/\D/g, '');
  // Must be 10 or 11 digits
  if (digits.length < 10 || digits.length > 11) return true;
  // Strip leading 1 for pattern matching
  const ten = digits.length === 11 ? digits.slice(1) : digits;
  const normalized = '+1' + ten;
  return FAKE_PATTERNS.some(pattern => pattern.test(normalized) || pattern.test(ten));
}

function normalizePhone(phone) {
  let digits = phone.toString().replace(/\D/g, '');
  if (digits.length === 10) digits = '1' + digits;
  return '+' + digits;
}

function detectCategory(lead) {
  const source = (lead.source || '').toLowerCase();
  const message = (lead.message || '').toLowerCase();
  const pipeline = (lead.pipeline || '').toLowerCase();
  const price = Number(lead.price) || 0;

  if (pipeline.includes('buyer') || pipeline.includes('seller')) return 'buyer';
  if (price > 100000) return 'buyer';
  if (/buy|purchas|mortgage|pre.approv|down payment/i.test(message)) return 'buyer';
  if (/iron.?pointe|ballantine|iron.?65|resipointe/i.test(lead.property || '')) return 'luxury';
  if (/rent|lease|apartment|unit|tenant|move.in|monthly/i.test(message)) return 'general';
  return 'general';
}

function isBusinessHours() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const hour = et.getHours() + et.getMinutes() / 60;
  if (day === 0 || day === 6) return hour >= 11 && hour < 17;
  return hour >= 10 && hour < 18;
}

async function sendSMS(phone, message) {
  try {
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
    });
    return res.json();
  } catch (err) {
    console.error('SMS error:', err.message);
    return { success: false };
  }
}

async function triggerVapiCall(phone, name, category, property, source) {
  const assistantId = category === 'luxury' ? ASSISTANTS.luxury : ASSISTANTS.general;

  const res = await fetch('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VAPI_API_KEY}`,
    },
    body: JSON.stringify({
      phoneNumberId: OUTBOUND_PHONE_ID,
      assistantId,
      customer: {
        number: phone,
        name: name || undefined,
      },
      assistantOverrides: {
        variableValues: {
          lead_name: name || '',
          lead_property: property || '',
          lead_source: source || 'rosalia',
        },
      },
    }),
  });

  const data = await res.json();
  console.log('Vapi call result:', JSON.stringify(data));
  return data;
}

async function updateLeadStatus(leadId, notes) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      last_follow_up_at: new Date().toISOString(),
      notes,
    }),
  });
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');

    // Supabase sends: { type: "UPDATE", table: "leads", record: {...}, old_record: {...} }
    const { type, record, old_record, test } = body;

    console.log('phoneupdated webhook fired:', type);
    console.log('New record phone:', record?.phone);
    console.log('Old record phone:', old_record?.phone);

    // Only process UPDATE events
    if (!test && type !== 'UPDATE') {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'not an update event' }) };
    }

    const newPhone = record?.phone;
    const oldPhone = old_record?.phone;

    // Only proceed if phone actually changed
    if (!newPhone || newPhone === oldPhone) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'phone unchanged' }) };
    }

    // Normalize
    const phone = normalizePhone(newPhone);
    console.log('Normalized phone:', phone);

    // Validate — skip fake/test numbers
    if (isFakeNumber(phone)) {
      console.log('FAKE NUMBER detected — skipping call:', phone);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ skipped: 'fake or invalid number', phone }),
      };
    }

    const lead = record;
    const name = lead.name || '';
    const firstName = name.split(' ')[0] || 'there';
    const category = detectCategory(lead);
    const property = lead.property || '';
    const source = lead.source || 'rosalia';

    console.log(`Lead: ${name} | Phone: ${phone} | Category: ${category} | Property: ${property}`);

    const withinHours = isBusinessHours();
    console.log('Business hours:', withinHours);

    let callTriggered = false;
    let smsSent = false;

    if (withinHours && VAPI_API_KEY) {
      // Trigger Alex call
      try {
        await triggerVapiCall(phone, name, category, property, source);
        callTriggered = true;
        console.log('✓ Alex call triggered for updated phone:', phone);

        // Update lead notes
        const noteText = `[${new Date().toLocaleDateString()}] Phone updated → Alex called (${phone})`;
        const existingNotes = lead.notes || '';
        await updateLeadStatus(lead.id, existingNotes ? existingNotes + '\n' + noteText : noteText);

      } catch (err) {
        console.error('Vapi call failed:', err.message);
        // Fall back to SMS
        const bookingLink = `${BOOKING_FORM_URL}?phone=${encodeURIComponent(phone)}`;
        const smsText = `Hi ${firstName}! This is Ana from Rosalia Group. I'd love to help you find your perfect apartment. Check our available units. You can book an appointment here: https://bit.ly/4uma2Oj/rosalia-tour — (862) 419-1814`;
        const smsResult = await sendSMS(phone, smsText);
        smsSent = smsResult.success;
        console.log('Fallback SMS result:', JSON.stringify(smsResult));
      }
    } else {
      // Outside hours — send SMS intro instead
      const bookingLink = `${BOOKING_FORM_URL}?phone=${encodeURIComponent(phone)}`;
      const smsText = `Hi ${firstName}! This is Ana from Rosalia Group. I'd love to help you find your perfect apartment. Check our available units. You can book an appointment here: https://bit.ly/4uma2Oj/rosalia-tour — (862) 419-1814`;
      const smsResult = await sendSMS(phone, smsText);
      smsSent = smsResult.success;
      console.log('Outside hours SMS result:', JSON.stringify(smsResult));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        phone,
        call_triggered: callTriggered,
        sms_sent: smsSent,
        within_hours: withinHours,
      }),
    };

  } catch (err) {
    console.error('phoneupdated error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
