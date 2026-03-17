// ---------------------------------------------
// followup.js -- 24hr Follow-Up Scheduler
// Called by a Netlify scheduled function or external cron
// Finds leads with no reply in 24hrs and triggers Alex call + SMS
// ---------------------------------------------

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';

const VAPI_CONFIG = {
  luxury: {
    assistantId: '1cae5323-6b83-4434-8461-6330472da140',
    phoneNumberId: '339c7317-ab98-4696-8ac3-9c71349557cd',
  },
  general: {
    assistantId: '53245859-6ed5-467f-b557-88456ee2f10b',
    phoneNumberId: '339c7317-ab98-4696-8ac3-9c71349557cd',
  },
};

// -- BUSINESS HOURS --
function isBusinessHours() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const time = et.getHours() + et.getMinutes() / 60;
  if (day === 0) return time >= 10 && time < 17;
  if (day === 6) return time >= 10 && time < 17;
  return time >= 9 && time < 18;
}

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.toString().replace(/\D/g, '');
  if (p.length === 10) p = '+1' + p;
  else if (p.length === 11 && !p.startsWith('+')) p = '+' + p;
  return p;
}

async function sendSMS(phone, message) {
  if (!phone) return null;
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

async function triggerVapiCall(phone, name, category, bookingLink, property) {
  const config = VAPI_CONFIG[category] || VAPI_CONFIG.general;
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
        customer: { number: phone, name: name || undefined },
        assistantOverrides: {
          variableValues: {
            lead_name: name || '',
            lead_property: property || '',
            booking_link: bookingLink,
          },
        },
      }),
    });
    const data = await res.json();
    return { success: !data.error, callId: data.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function updateLeadFollowUp(leadId, count) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      follow_up_count: count,
      last_follow_up_at: new Date().toISOString(),
    }),
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Only run during business hours
  if (!isBusinessHours()) {
    console.log('Outside business hours -- follow-up skipped');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ skipped: true, reason: 'outside business hours' }),
    };
  }

  try {
    // Find leads that:
    // 1. Have a phone number
    // 2. Have follow_up_count < 2 (max 2 follow-ups)
    // 3. Were created 24+ hours ago
    // 4. Status is still "new" (not converted, not booked)
    // 5. Last follow-up was either never or 24+ hours ago
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?status=eq.new&phone=not.is.null&follow_up_count=lt.2&created_at=lt.${cutoff}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const leads = await res.json();

    if (!Array.isArray(leads) || leads.length === 0) {
      console.log('No leads need follow-up');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ processed: 0, message: 'No leads need follow-up' }),
      };
    }

    // Filter: last_follow_up_at must be null OR 24+ hours ago
    const eligible = leads.filter(lead => {
      if (!lead.last_follow_up_at) return true;
      const lastFollowUp = new Date(lead.last_follow_up_at);
      return Date.now() - lastFollowUp.getTime() >= 24 * 60 * 60 * 1000;
    });

    console.log(`Found ${eligible.length} leads eligible for follow-up`);

    const results = [];

    for (const lead of eligible) {
      const phone = normalizePhone(lead.phone);
      if (!phone) continue;

      const followUpNumber = (lead.follow_up_count || 0) + 1;
      const bookingLink = `${BOOKING_FORM_URL}?phone=${encodeURIComponent(phone)}`;
      const first = lead.name?.split(' ')[0] || 'there';
      const prop = lead.property || '';

      // Detect luxury vs general based on property name
      const isLuxury = /iron.?pointe|market.?st|river.?pointe|556|486|502|elks/i.test(prop);
      const category = isLuxury ? 'luxury' : 'general';

      // Build follow-up SMS
      const smsMessages = {
        1: `Hi ${first} -- this is Alex from Rosalia Group following up on your apartment inquiry! We still have availability${prop ? ' at ' + prop : ''} and would love to show you around. Book a tour here: ${bookingLink} or call (862) 419-1814`,
        2: `Hi ${first} -- last follow-up from Alex at Rosalia Group. ${prop ? prop + ' is' : 'Units are'} still available but going fast. Book your tour: ${bookingLink}`,
      };

      const smsText = smsMessages[followUpNumber] || smsMessages[1];

      // 1. Trigger Vapi call
      const callResult = await triggerVapiCall(phone, lead.name, category, bookingLink, prop);
      console.log(`Follow-up call for lead ${lead.id}:`, callResult.success ? 'TRIGGERED' : 'FAILED');

      // 2. Send SMS regardless of call success
      const smsResult = await sendSMS(phone, smsText);
      console.log(`Follow-up SMS for lead ${lead.id}:`, smsResult?.success ? 'SENT' : 'FAILED');

      // 3. Update follow-up count in Supabase
      await updateLeadFollowUp(lead.id, followUpNumber);

      results.push({
        leadId: lead.id,
        name: lead.name,
        phone,
        followUpNumber,
        callTriggered: callResult.success,
        smsSent: smsResult?.success,
      });

      // Small delay between leads to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        processed: results.length,
        results,
      }),
    };

  } catch (err) {
    console.error('Follow-up error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
