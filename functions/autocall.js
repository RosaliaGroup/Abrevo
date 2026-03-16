const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPI_KEY = process.env.VAPI_KEY || '064f441d-a388-4404-8b6c-05e91e90f1ff';
const VAPI_ASSISTANT_ID = '1cae5323-6b83-4434-8461-6330472da140';
const VAPI_PHONE_ID = process.env.VAPI_PHONE_ID || '2e2b6713-f631-4e9e-95fa-3418ecc77c0a';
const JESSICA_ASSISTANT_ID = process.env.JESSICA_ASSISTANT_ID || '35f4e4a2-aabc-47be-abfc-630cf6a85d58';
const JESSICA_PHONE_ID = '8e91b213-7224-4246-b98c-07e5a384a7ca';
const TEXTBELT_KEY = process.env.TEXTBELT_KEY;
const ANA_PHONE = '+16462269189';
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-rosalia';
const IRON65_BOOKING_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';

// Max call attempts before giving up
const MAX_CALL_ATTEMPTS = 5;
// Minimum hours between call attempts
const MIN_HOURS_BETWEEN_CALLS = 2;

function isBusinessHours() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const hour = et.getHours();
  if (day >= 1 && day <= 5) return hour >= 9 && hour < 18;
  if (day === 6) return hour >= 10 && hour < 17;
  if (day === 0) return hour >= 11 && hour < 17;
  return false;
}

async function findLeadsToCall() {
  const now = new Date();
  // Minimum time since last call attempt (2 hours)
  const minLastCall = new Date(now - MIN_HOURS_BETWEEN_CALLS * 60 * 60 * 1000).toISOString();

  // Find leads that:
  // 1. Have a phone number
  // 2. Haven't been contacted (status != contacted)
  // 3. Haven't exceeded max attempts
  // 4. Either never called OR last called > 2 hours ago
  // 5. Don't already have a booking
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?` +
    `phone=not.is.null&` +
    `status=neq.contacted&` +
    `status=neq.rented&` +
    `status=neq.survey_completed&` +
    `or=(call_attempts.is.null,call_attempts.lt.${MAX_CALL_ATTEMPTS})&` +
    `or=(last_call_at.is.null,last_call_at.lt.${minLastCall})&` +
    `limit=5&order=created_at.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const leads = await res.json();
  if (!Array.isArray(leads)) return [];

  // Filter out leads that already have a booking
  const filtered = [];
  for (const lead of leads) {
    if (!lead.phone) continue;
    // Check if lead already has a booking
    const phone = lead.phone.replace(/\D/g, '');
    const bookingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?phone=eq.%2B${phone}&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const bookings = await bookingRes.json();
    if (Array.isArray(bookings) && bookings.length > 0) {
      console.log(`Skipping ${lead.name} - already has a booking`);
      // Mark as contacted so we stop calling
      await updateLeadStatus(lead.id, 'contacted', lead.call_attempts || 0);
      continue;
    }
    filtered.push(lead);
  }
  return filtered;
}

async function updateLeadStatus(leadId, status, attempts) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({
      last_call_at: new Date().toISOString(),
      call_attempts: attempts,
      status: status,
      called_at: new Date().toISOString(),
    }),
  });
}

async function sendSMS(phone, leadName, bookingUrl, attemptNumber) {
  if (!TEXTBELT_KEY) return;
  let p = phone.replace(/\D/g, '');
  if (p.length === 10) p = '+1' + p;
  else if (p.length === 11 && !p.startsWith('+')) p = '+' + p;
  const firstName = (leadName || '').split(' ')[0] || 'there';
  
  // Vary the message based on attempt number
  let msg;
  if (attemptNumber === 1) {
    msg = `Hi ${firstName}! Alex from Rosalia Group here â€” tried reaching you about your apartment inquiry. Book your tour anytime: ${bookingUrl}`;
  } else if (attemptNumber === 2) {
    msg = `Hi ${firstName}! Alex from Rosalia Group again. Still have great apartments available for you. Book here: ${bookingUrl}`;
  } else {
    msg = `Hi ${firstName}! Rosalia Group here â€” we have limited units available. Don't miss out! Book your tour: ${bookingUrl}`;
  }

  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: p, message: msg, key: TEXTBELT_KEY }),
    });
    console.log(`SMS attempt ${attemptNumber} sent to ${p}`);
  } catch (err) {
    console.error('SMS error:', err.message);
  }
}

async function triggerCall(phone, leadName, assistantId, phoneId, property) {
  try {
    const propertyContext = property
      ? `\n\nIMPORTANT: This lead inquired specifically about ${property}. Focus ONLY on this property.`
      : '';
    const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });

    const res = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VAPI_KEY}` },
      body: JSON.stringify({
        phoneNumberId: phoneId || VAPI_PHONE_ID,
        assistantId: assistantId || VAPI_ASSISTANT_ID,
        customer: { number: phone, name: leadName || undefined },
        assistantOverrides: {
          model: {
            messages: [{ role: 'system', content: `TODAY IS ${today}. Tomorrow = ${tomorrow}. You are making an OUTBOUND call â€” do NOT ask for the caller phone number, you already have it.${propertyContext}` }],
          },
        },
      }),
    });
    const data = await res.json();
    console.log('Vapi call result:', data.id || JSON.stringify(data).substring(0, 100));
    return data.id || null;
  } catch (err) {
    console.error('Vapi call error:', err.message);
    return null;
  }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    if (!isBusinessHours()) {
      const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
      console.log('Outside business hours:', now);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Outside business hours' }) };
    }

    const leads = await findLeadsToCall();
    console.log(`Found ${leads.length} lead(s) to call`);

    const results = { called: 0, skipped: 0, errors: 0 };

    for (const lead of leads) {
      try {
        const isIron65 = lead.client === 'iron65';
        const assistantId = isIron65 ? JESSICA_ASSISTANT_ID : VAPI_ASSISTANT_ID;
        const phoneId = isIron65 ? JESSICA_PHONE_ID : VAPI_PHONE_ID;
        const bookingUrl = isIron65 ? IRON65_BOOKING_URL : BOOKING_FORM_URL;
        const attempts = (lead.call_attempts || 0) + 1;

        console.log(`Calling: ${lead.name} | ${lead.phone} | attempt ${attempts}/${MAX_CALL_ATTEMPTS}`);

        // Trigger call
        const callId = await triggerCall(lead.phone, lead.name, assistantId, phoneId, lead.property);

        // Send SMS after every missed call attempt
        await sendSMS(lead.phone, lead.name, bookingUrl, attempts);

        // Update lead - mark call attempt but keep status as 'new' until they answer
        const newStatus = attempts >= MAX_CALL_ATTEMPTS ? 'contacted' : lead.status || 'new';
        await updateLeadStatus(lead.id, newStatus, attempts);

        if (attempts >= MAX_CALL_ATTEMPTS) {
          console.log(`${lead.name} reached max attempts (${MAX_CALL_ATTEMPTS}) - stopping calls`);
        }

        results.called++;
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`Error calling ${lead.name}:`, err.message);
        results.errors++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, leadsFound: leads.length, results }),
    };
  } catch (err) {
    console.error('autocall error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
