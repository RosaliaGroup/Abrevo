const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const RESPOND_URL = 'https://silver-ganache-1ee2ca.netlify.app/.netlify/functions/respondRosalia';
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PHONE_ID = process.env.VAPI_PHONE_ID;
const JESSICA_ASSISTANT_ID = process.env.JESSICA_ASSISTANT_ID;
const ANA_PHONE = '+16462269189';
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/rosalia-booking';

// ── BUSINESS HOURS CHECK (Eastern Time) ──
// Weekdays: 9AM-6PM | Weekends: 10AM-5PM
function isBusinessHours() {
  const now = new Date();
  // Convert to Eastern Time
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const hour = et.getHours();
  const minute = et.getMinutes();
  const timeDecimal = hour + minute / 60;

  if (day === 0) { // Sunday
    return timeDecimal >= 10 && timeDecimal < 17;
  } else if (day === 6) { // Saturday
    return timeDecimal >= 10 && timeDecimal < 17;
  } else { // Weekday
    return timeDecimal >= 9 && timeDecimal < 18;
  }
}

async function sendSMS(phone, message) {
  if (!phone) return null;
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

async function saveLeadToSupabase(lead) {
  console.log('Saving to Supabase:', JSON.stringify(lead));

  // Check for existing lead by email or phone
  if (lead.email) {
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(lead.email)}&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await checkRes.json();
    console.log('Existing check result:', JSON.stringify(existing));
    if (Array.isArray(existing) && existing.length > 0) {
      console.log('Lead already exists:', lead.email);
      return existing[0];
    }
  }

  const payload = {
    name: lead.name || null,
    email: lead.email || null,
    phone: lead.phone || null,
    source: 'cinc',
    message: lead.message || null,
    property: lead.property || 'Real Estate Inquiry',
    client: 'rosalia',
    status: 'new',
    replied_at: new Date().toISOString(),
    follow_up_count: 0,
    notes: 'Source: CINC CRM',
  };

  console.log('Insert payload:', JSON.stringify(payload));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log('Supabase response status:', res.status);
  console.log('Supabase response body:', text);

  try {
    const saved = JSON.parse(text);
    return Array.isArray(saved) ? saved[0] : saved;
  } catch (e) {
    console.error('Supabase parse error:', e.message);
    return null;
  }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    console.log('CINC webhook received:', JSON.stringify(body));

    const leadData = body.lead || body.contact || body;

    let phone = leadData.phone || leadData.cell_phone || leadData.phone_number || null;
    if (phone) {
      phone = phone.toString().replace(/\D/g, '');
      if (phone.length === 10) phone = '+1' + phone;
      else if (phone.length === 11) phone = '+' + phone;
    }

    const lead = {
      name: [leadData.first_name, leadData.last_name].filter(Boolean).join(' ') || leadData.name || null,
      email: leadData.email || null,
      phone: phone,
      message: leadData.message || leadData.notes || null,
      property: leadData.property_address || leadData.search_area || leadData.domain_name || 'Real Estate Inquiry',
      source: leadData.lead_source || leadData.domain_name || 'cinc',
      price: leadData.median_price || leadData.price || 0,
      timeframe: leadData.timeframe || null,
      pipeline: leadData.pipeline || leadData.status || null,
      type: 'inquiry',
    };

    console.log('Parsed lead:', JSON.stringify(lead));

    if (!lead.email && !lead.phone) {
      console.log('No contact info — skipping');
      return { statusCode: 200, headers, body: JSON.stringify({ received: true, skipped: 'no contact info' }) };
    }

    // 1 — Save to Supabase always (regardless of business hours)
    const savedLead = await saveLeadToSupabase(lead);
    console.log('Saved lead ID:', savedLead?.id);

    const withinHours = isBusinessHours();
    console.log('Business hours:', withinHours);

    // 2 — Notify Ana always (SMS)
    const anaMsg = `New CINC Lead!\nName: ${lead.name || 'N/A'}\nEmail: ${lead.email || 'N/A'}\nPhone: ${lead.phone || 'N/A'}\nProperty: ${lead.property}${!withinHours ? '\n⏰ Outside business hours — call/text queued' : ''}`;
    const anaResult = await sendSMS(ANA_PHONE, anaMsg);
    console.log('Ana SMS:', JSON.stringify(anaResult));

    if (withinHours) {
      // 3 — SMS to lead with booking link
      if (lead.phone) {
        const bookingLink = `${BOOKING_FORM_URL}?phone=${encodeURIComponent(lead.phone)}`;
        const smsText = `Hi ${lead.name?.split(' ')[0] || 'there'}! Thanks for your interest in Rosalia Group rentals. View available apartments and schedule a tour: ${bookingLink} — Ana, Rosalia Group (551) 249-9795`;
        const smsResult = await sendSMS(lead.phone, smsText);
        console.log('Lead SMS:', JSON.stringify(smsResult));
      }

      // 4 — Trigger Vapi outbound call
      if (lead.phone && VAPI_API_KEY && VAPI_PHONE_ID && JESSICA_ASSISTANT_ID) {
        const callRes = await fetch('https://api.vapi.ai/call/phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VAPI_API_KEY}` },
          body: JSON.stringify({
            phoneNumberId: VAPI_PHONE_ID,
            assistantId: JESSICA_ASSISTANT_ID,
            customer: {
              number: lead.phone,
              name: lead.name || undefined,
            },
            assistantOverrides: {
              variableValues: {
                lead_name: lead.name || '',
                lead_property: lead.property || '',
                lead_source: 'CINC',
              },
            },
          }),
        });
        const callData = await callRes.json();
        console.log('Vapi call result:', JSON.stringify(callData));
      } else {
        console.log('Vapi skipped — missing:', { 
          hasPhone: !!lead.phone, 
          hasVapiKey: !!VAPI_API_KEY, 
          hasPhoneId: !!VAPI_PHONE_ID, 
          hasAssistantId: !!JESSICA_ASSISTANT_ID 
        });
      }
    } else {
      console.log('Outside business hours — SMS and call skipped');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        received: true,
        lead_id: savedLead?.id || null,
        within_hours: withinHours,
        sms_sent: withinHours && !!lead.phone,
        call_triggered: withinHours && !!lead.phone && !!VAPI_API_KEY,
      }),
    };

  } catch (err) {
    console.error('cincWebhook error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
