const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-rosalia';
const IRON65_BOOKING_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';
const JESSICA_ASSISTANT_ID = '35f4e4a2-aabc-47be-abfc-630cf6a85d58';
const JESSICA_PHONE_ID = '8e91b213-7224-4246-b98c-07e5a384a7ca';

// Find leads that have a phone number but haven't been called yet
// We track this with a 'called_at' column ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â if null, not called yet
async function findUncalledLeads() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?phone=not.is.null&called_at=is.null&status=neq.contacted&limit=5&order=created_at.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Mark lead as called
async function markCalled(leadId, callId) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      called_at: new Date().toISOString(),
      status: 'contacted',
      notes: `Alex called ${new Date().toLocaleDateString()}. Call ID: ${callId || 'N/A'}`,
    }),
  });
}

// Trigger Vapi outbound call
async function triggerCall(phone, leadName, assistantId, phoneId) {
  try {
    const res = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VAPI_KEY}`,
      },
      body: JSON.stringify({
        phoneNumberId: phoneId || VAPI_PHONE_ID,
        assistantId: assistantId || VAPI_ASSISTANT_ID,
        customer: {
          number: phone,
          name: leadName || undefined,
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

// Send SMS with booking link
async function sendSMS(phone, leadName, bookingUrl) {
  const firstName = leadName?.split(' ')[0] || 'there';
  const url = bookingUrl || BOOKING_FORM_URL;
  const msg = `Hi ${firstName}! This is Alex from Rosalia Group. We'd love to show you one of our apartments. Book a tour here: ${BOOKING_FORM_URL} | (862) 419-1814`;
  try {
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: msg, key: TEXTBELT_KEY }),
    });
    const result = await res.json();
    console.log('SMS result:', result.success ? 'sent' : result.error);
  } catch (err) {
    console.error('SMS error:', err.message);
  }
}

// Notify Ana
async function notifyAna(lead) {
  const msg = `Auto-calling lead!\nName: ${lead.name || 'N/A'}\nPhone: ${lead.phone}\nSource: ${lead.source || 'N/A'}\nAlex is calling now...`;
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: ANA_PHONE, message: msg, key: TEXTBELT_KEY }),
    });
  } catch (err) { console.error('Ana SMS error:', err.message); }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    // Business hours check (Eastern Time)
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = et.getHours();
    const day = et.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

    let allowed = false;
    if (day >= 1 && day <= 5) allowed = hour >= 9 && hour < 18;  // Mon-Fri 9am-6pm
    else if (day === 6) allowed = hour >= 10 && hour < 17;         // Sat 10am-5pm
    else if (day === 0) allowed = hour >= 11 && hour < 17;         // Sun 11am-5pm

    if (!allowed) {
      console.log('Outside business hours - skipping calls. Day:', day, 'Hour:', hour, 'ET');
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Outside business hours', day, hour }) };
    }

    console.log('autocall: checking for uncalled leads...');
    const leads = await findUncalledLeads();
    console.log(`Found ${leads.length} uncalled lead(s) with phone numbers`);

    const results = { called: 0, errors: 0 };

    for (const lead of leads) {
      try {
        console.log(`Calling: ${lead.name} | ${lead.phone} | source: ${lead.source} | client: ${lead.client}`);

        // Use Jessica for Iron 65 leads, Alex for all others
        const isIron65 = lead.client === 'iron65';
        const assistantId = isIron65 ? JESSICA_ASSISTANT_ID : VAPI_ASSISTANT_ID;
        const phoneId = isIron65 ? JESSICA_PHONE_ID : VAPI_PHONE_ID;
        const bookingUrl = isIron65 ? IRON65_BOOKING_URL : BOOKING_FORM_URL;

        // Trigger call
        const callId = await triggerCall(lead.phone, lead.name, assistantId, phoneId);

        // Send SMS with correct booking link
        await sendSMS(lead.phone, lead.name, bookingUrl);

        // Mark as called in Supabase
        await markCalled(lead.id, callId);

        // Notify Ana
        await notifyAna(lead);

        results.called++;
        console.log(`Done: ${lead.name}`);

      } catch (err) {
        console.error(`Error calling ${lead.name}:`, err.message);
        results.errors++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, leads_found: leads.length, results }),
    };

  } catch (err) {
    console.error('autocall error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
