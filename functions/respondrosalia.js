const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANA_PHONE = '+16462269189';
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';

// -- DETECT BUYER vs RENTAL --
function detectCategory(lead) {
  const source = (lead.source || '').toLowerCase();
  const message = (lead.message || '').toLowerCase();
  const pipeline = (lead.pipeline || '').toLowerCase();
  const price = Number(lead.price) || 0;

  if (pipeline.includes('buyer') || pipeline.includes('seller')) return 'buyer';
  if (price > 100000) return 'buyer';
  if (/buy|purchas|mortgage|pre.approv|down payment|sell.*before|closing/i.test(message)) return 'buyer';
  if (source.includes('avail') || source.includes('resipointe')) return 'rental';
  if (/rent|lease|apartment|unit|tenant|move.in|monthly/i.test(message)) return 'rental';
  if (/iron.?pointe|market.?st|madison.?st|elks|hobson/i.test(lead.property || '')) return 'rental';
  return price > 0 ? 'buyer' : 'rental';
}

async function generateReply(lead) {
  const category = lead.category || detectCategory(lead);
  const bookingLink = `${BOOKING_FORM_URL}${lead.phone ? '?phone=' + encodeURIComponent(lead.phone) : ''}`;
  const firstName = lead.name?.split(' ')[0] || 'there';

  let prompt;

  if (category === 'buyer') {
    prompt = `You are Ana Haynes, Licensed Realtor at Rosalia Group in New Jersey. You help buyers and sellers across Newark, Jersey City, East Orange, Elizabeth, and surrounding areas.

A new BUYER lead came in. Write a SHORT personalized email reply that:
1. Greets them by first name: "${firstName}"
2. Thanks them for their interest in real estate in New Jersey
3. Mentions you specialize in the area and would love to help them find the right home
4. Invites them to schedule a quick call or meeting: ${bookingLink}
5. Signs off as: Ana Haynes | Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com

Source: ${lead.source || 'online inquiry'}
Message: ${lead.message || 'Interested in properties'}
Price range: ${lead.price ? '$' + Number(lead.price).toLocaleString() : 'not specified'}
Timeframe: ${lead.timeframe || 'not specified'}

Under 120 words. Warm, professional, not salesy. No bullet points. Reply with ONLY the email body.`;

  } else {
    const isIronPointe = /iron.?pointe|resipointe|madison/i.test(lead.property || '');
    const building = isIronPointe ? 'Iron Pointe' : (lead.property || 'our available rentals');
    const isApplication = lead.type === 'application';

    prompt = `You are Ana Haynes, Leasing Manager at Rosalia Group in New Jersey. You manage rentals across Newark, Jersey City, East Orange, Elizabeth, and Orange NJ.

${isApplication ? 'A renter has COMPLETED A RENTAL APPLICATION.' : 'A new rental inquiry came in.'} Write a SHORT personalized email reply that:
1. Greets them by first name: "${firstName}"
2. ${isApplication ? 'Thanks them for completing their application, says you will review within 24 hours' : `Thanks them for their interest in ${building}`}
3. ${isApplication ? 'Explains next steps: review, possible interview, lease signing' : `Invites them to schedule a tour: ${bookingLink}`}
4. ${lead.budget ? `Acknowledges their budget of ${lead.budget}` : ''}
5. Signs off as: Ana Haynes | Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com

Property: ${building}
Message: ${lead.message || 'Interested in renting'}
${lead.bedrooms ? 'Bedrooms: ' + lead.bedrooms : ''}
${lead.budget ? 'Budget: ' + lead.budget : ''}

Under 120 words. Warm, professional, not salesy. No bullet points. Reply with ONLY the email body.`;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function generateFollowUp(lead, followUpNumber) {
  const category = lead.category || detectCategory(lead);
  const first = lead.name?.split(' ')[0] || 'there';
  const prop = lead.property || (category === 'buyer' ? 'your dream home' : 'the property');
  const bookingLink = `${BOOKING_FORM_URL}${lead.phone ? '?phone=' + encodeURIComponent(lead.phone) : ''}`;

  if (category === 'buyer') {
    const msgs = {
      1: `Hi ${first}, just following up from Ana at Rosalia Group! Are you still looking for a home in NJ? I'd love to help -- schedule a quick call: ${bookingLink} -- (551) 249-9795`,
      2: `Hi ${first}, last follow up from Ana at Rosalia Group. The market is moving fast -- if you're still looking, I'm here to help: ${bookingLink}`,
    };
    return msgs[followUpNumber] || msgs[1];
  } else {
    const msgs = {
      1: `Hi ${first}, just following up on your inquiry about ${prop}! We still have availability. Schedule a tour: ${bookingLink} -- Ana, Rosalia Group (551) 249-9795`,
      2: `Hi ${first}, last follow up from Ana at Rosalia Group -- ${prop} is still available but going fast. Book a tour: ${bookingLink}`,
    };
    return msgs[followUpNumber] || msgs[1];
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

async function findExistingLead(email, phone) {
  if (email) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[0];
  }
  if (phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${cleanPhone}*&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[0];
  }
  return null;
}

async function saveOrUpdateLead(lead, emailReply) {
  const category = lead.category || detectCategory(lead);
  const existing = await findExistingLead(lead.email, lead.phone);

  if (existing) {
    console.log('Existing lead found:', existing.id, '-- merging');
    const newNote = `[${new Date().toLocaleDateString()}] ${lead.source || 'inquiry'}: ${lead.message || 'no message'}`;
    const mergedNotes = existing.notes ? existing.notes + '\n' + newNote : newNote;
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        notes: mergedNotes,
        replied_at: new Date().toISOString(),
        email_reply: emailReply,
        phone: existing.phone || lead.phone || null,
      }),
    });
    return existing;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      name: lead.name || null,
      email: lead.email || null,
      phone: lead.phone || null,
      source: lead.source || null,
      message: lead.message || null,
      property: lead.property || null,
      client: 'rosalia',
      status: lead.type === 'application' ? 'applied' : 'new',
      replied_at: new Date().toISOString(),
      follow_up_count: 0,
      email_reply: emailReply,
      notes: [
        `Category: ${category}`,
        lead.budget && `Budget: ${lead.budget}`,
        lead.bedrooms && `Bedrooms: ${lead.bedrooms}`,
        lead.price && `Price: $${lead.price}`,
        lead.timeframe && `Timeframe: ${lead.timeframe}`,
      ].filter(Boolean).join(' | ') || null,
    }),
  });
  const text = await res.text();
  console.log('Supabase insert:', res.status, text.substring(0, 200));
  try {
    const saved = JSON.parse(text);
    return Array.isArray(saved) ? saved[0] : saved;
  } catch (e) {
    return null;
  }
}

async function updateLeadFollowUp(leadId, count) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ follow_up_count: count, last_follow_up_at: new Date().toISOString() }),
  });
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { action = 'reply', lead = {}, lead_id, follow_up_number = 1 } = body;

    const parsedLead = { ...lead };
    parsedLead.category = parsedLead.category || detectCategory(parsedLead);

    console.log('respondRosalia | Action:', action, '| Category:', parsedLead.category, '| Source:', parsedLead.source);
    console.log('Lead:', JSON.stringify({ name: parsedLead.name, email: parsedLead.email, phone: parsedLead.phone, property: parsedLead.property }));

    if (action === 'reply') {
      if (!parsedLead.email && !parsedLead.phone) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No email or phone found' }) };
      }

      const emailReply = await generateReply(parsedLead);
      console.log('Email reply length:', emailReply.length);

      const savedLead = await saveOrUpdateLead(parsedLead, emailReply);
      console.log('Lead saved/merged, id:', savedLead?.id);

      // SMS to lead -- no URLs (Textbelt whitelist pending)
      if (parsedLead.phone) {
        const smsText = parsedLead.category === 'buyer'
          ? `Hi ${parsedLead.name?.split(' ')[0] || 'there'}! This is Ana from Rosalia Group following up on your real estate inquiry. I'll reach out shortly -- (551) 249-9795.`
          : `Hi ${parsedLead.name?.split(' ')[0] || 'there'}! This is Ana from Rosalia Group following up on your rental inquiry. I'll reach out shortly -- (551) 249-9795.`;
        const smsResult = await sendSMS(parsedLead.phone, smsText);
        console.log('Lead SMS:', JSON.stringify(smsResult));
      }

      // Notify Ana -- no URLs
      const anaMsg = `New ${(parsedLead.category || 'lead').toUpperCase()} Lead! (${parsedLead.source || 'rosalia'})\nName: ${parsedLead.name || 'N/A'}\nEmail: ${parsedLead.email || 'N/A'}\nPhone: ${parsedLead.phone || 'N/A'}\nProperty: ${parsedLead.property || 'N/A'}`;
      const anaResult = await sendSMS(ANA_PHONE, anaMsg);
      console.log('Ana SMS:', JSON.stringify(anaResult));

      const subject = parsedLead.category === 'buyer'
        ? `Re: Your real estate inquiry -- Rosalia Group`
        : parsedLead.type === 'application'
        ? `Application received -- ${parsedLead.property || 'your property'}`
        : `Re: Your inquiry about ${parsedLead.property || 'the property'}`;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          email_reply: emailReply,
          subject,
          to_email: parsedLead.email,
          lead_id: savedLead?.id || null,
          category: parsedLead.category,
        }),
      };
    }

    if (action === 'follow_up') {
      const followUpText = await generateFollowUp(parsedLead, follow_up_number);
      if (parsedLead.phone) await sendSMS(parsedLead.phone, followUpText);
      if (lead_id) await updateLeadFollowUp(lead_id, follow_up_number);
      const subject = follow_up_number === 1
        ? `Following up -- ${parsedLead.property || 'your inquiry'}`
        : `Still interested? -- ${parsedLead.property || 'the property'}`;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, follow_up_text: followUpText, subject, to_email: parsedLead.email }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('respondRosalia error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
