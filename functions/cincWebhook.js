const CINC_API_KEY = 'NAA216B4596B72F42AC93BC45A74E49B03B';
const RESPOND_URL = 'https://silver-ganache-1ee2ca.netlify.app/.netlify/functions/respondToLead';
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PHONE_ID = process.env.VAPI_PHONE_ID;       // outbound phone number ID in Vapi
const JESSICA_ASSISTANT_ID = process.env.JESSICA_ASSISTANT_ID; // Iron 65 Inbound assistant ID

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    console.log('CINC webhook received:', JSON.stringify(body));

    // CINC sends lead data in different formats depending on event type
    // Support both direct lead object and wrapped event
    const leadData = body.lead || body.contact || body;

    const lead = {
      name: [leadData.first_name, leadData.last_name].filter(Boolean).join(' ') || leadData.name || null,
      email: leadData.email || null,
      phone: leadData.phone || leadData.cell_phone || leadData.phone_number || null,
      message: leadData.message || leadData.notes || leadData.inquiry || null,
      property: leadData.property_address || leadData.search_area || leadData.interest || 'Real Estate Inquiry',
      source: 'cinc',
      type: 'inquiry',
    };

    console.log('Parsed CINC lead:', JSON.stringify(lead));

    if (!lead.email && !lead.phone) {
      console.log('No contact info found in CINC payload');
      return { statusCode: 200, headers, body: JSON.stringify({ received: true, skipped: 'no contact info' }) };
    }

    // 1 — Fire respondToLead (email reply + SMS + save to Supabase + notify Ana)
    const replyRes = await fetch(RESPOND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reply', lead }),
    });
    const replyData = await replyRes.json();
    console.log('respondToLead result:', JSON.stringify(replyData));

    // 2 — Trigger Vapi outbound call if phone available
    if (lead.phone && VAPI_API_KEY && VAPI_PHONE_ID && JESSICA_ASSISTANT_ID) {
      let phone = lead.phone.replace(/\D/g, '');
      if (phone.length === 10) phone = '+1' + phone;
      else if (phone.length === 11) phone = '+' + phone;

      const callRes = await fetch('https://api.vapi.ai/call/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VAPI_API_KEY}` },
        body: JSON.stringify({
          phoneNumberId: VAPI_PHONE_ID,
          assistantId: JESSICA_ASSISTANT_ID,
          customer: {
            number: phone,
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
      console.log('Vapi outbound call:', JSON.stringify(callData));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        received: true,
        lead_id: replyData.lead_id || null,
        email_sent: !!replyData.email_reply,
        call_triggered: !!(lead.phone && VAPI_API_KEY),
      }),
    };

  } catch (err) {
    console.error('cincWebhook error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
