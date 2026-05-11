const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const TEXTBELT_KEY = process.env.TEXTBELT_KEY || '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';
const BOOKING_FORM_URL = 'https://book.rosaliagroup.com/iron65';
const FUB_BASE = 'https://api.followupboss.com/v1';
const FUB_AUTH = 'Basic ' + Buffer.from((process.env.FUB_API_KEY || '') + ':').toString('base64');

const VAPI_KEY = process.env.VAPI_KEY || '064f441d-a388-4404-8b6c-05e91e90f1ff';
const JESSICA_PHONE_ID = '2e2b6713-f631-4e9e-95fa-3418ecc77c0a';
const JESSICA_OUTBOUND_ASSISTANT_ID = '35f4e4a2-aabc-47be-abfc-630cf6a85d58';

async function fetchNewFUBLeads(hoursBack = 24) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  
  // FUB doesn't support createdAfter filter -- fetch recent and filter by date
  const res = await fetch(
    `${FUB_BASE}/people?sort=created&direction=desc&limit=50`,
    {
      headers: {
        Authorization: FUB_AUTH,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FUB API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const allPeople = data.people || [];
  const people = allPeople.filter(p => {
    if (!p.created) return false;
    return new Date(p.created) >= since;
  });
  console.log('FUB: ' + allPeople.length + ' total, ' + people.length + ' within last ' + hoursBack + 'h');
  return people;
}

// -- SAVE LEAD TO SUPABASE --
async function saveToSupabase(fubPerson) {
  // Extract fields from FUB person object
  const name = [fubPerson.firstName, fubPerson.lastName].filter(Boolean).join(' ') || null;
  const email = fubPerson.emails?.[0]?.value || null;
  const phone = fubPerson.phones?.[0]?.value || null;
  const source = fubPerson.source || fubPerson.leadSource || 'fub';
  const message = fubPerson.backgroundInfo || fubPerson.notes || null;
  const property = fubPerson.propertyAddress || null;
  const price = fubPerson.price || null;
  const stage = fubPerson.stage || null;
  const assignedTo = fubPerson.assignedTo?.name || null;

  // Normalize phone
  let normalizedPhone = null;
  if (phone) {
    let p = phone.toString().replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11) p = '+' + p;
    normalizedPhone = p;
  }

  // Check for existing lead by email
  if (email) {
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await checkRes.json();
    if (Array.isArray(existing) && existing.length > 0) {
      // Update existing
      const existingLead = existing[0];
      const newNote = `[${new Date().toLocaleDateString()}] FUB sync: stage=${stage || 'N/A'}, source=${source}`;
      const mergedNotes = existingLead.notes ? existingLead.notes + '\n' + newNote : newNote;
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${existingLead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          notes: mergedNotes,
          phone: existingLead.phone || normalizedPhone,
          source: source,
        }),
      });
      console.log('Updated existing lead:', existingLead.id, name);
      return { ...existingLead, _action: 'updated' };
    }
  }

  // Check by phone
  if (normalizedPhone) {
    const cleanPhone = normalizedPhone.replace(/\D/g, '');
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${cleanPhone}*&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await checkRes.json();
    if (Array.isArray(existing) && existing.length > 0) {
      console.log('Found by phone:', existing[0].id, name);
      return { ...existing[0], _action: 'found_by_phone' };
    }
  }

  // Insert new lead
  const notes = [
    `Source: FUB`,
    source && `Lead source: ${source}`,
    stage && `Stage: ${stage}`,
    price && `Price: $${Number(price).toLocaleString()}`,
    assignedTo && `Assigned to: ${assignedTo}`,
    `FUB ID: ${fubPerson.id}`,
  ].filter(Boolean).join(' | ');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      name,
      email,
      phone: normalizedPhone,
      source: source || 'fub',
      message,
      property: property || 'Iron 65',
      client: 'iron65',
      status: 'new',
      replied_at: new Date().toISOString(),
      follow_up_count: 0,
      notes,
    }),
  });

  const text = await res.text();
  console.log('Supabase insert:', res.status, name);
  try {
    const saved = JSON.parse(text);
    const record = Array.isArray(saved) ? saved[0] : saved;
    return { ...record, _action: 'created' };
  } catch (e) { return null; }
}

// -- NOTIFY ANA --

// Send SMS to lead
async function sendSMSToLead(phone, leadName) {
  if (!phone || !TEXTBELT_KEY) return;
  const firstName = (leadName || '').split(' ')[0] || 'there';
  const msg = `Hi ${firstName}! Alex from Iron 65 Luxury Apartments here. We received your inquiry and would love to show you our brand new building in Newark's Ironbound District. Book your tour: ${BOOKING_FORM_URL}`;
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: msg, key: TEXTBELT_KEY }),
    });
    console.log('SMS sent to lead:', phone);
  } catch(e) { console.error('SMS error:', e.message); }
}

// Send AI email to lead
async function sendEmailToLead(email, leadName, source) {
  if (!email || email.includes('incomplete-') || !ANTHROPIC_KEY) return;
  try {
    const firstName = (leadName || '').split(' ')[0] || 'there';
    const prompt = `Write a short warm email (max 3 sentences) to ${firstName} who just inquired about Iron 65 Luxury Apartments in Newark NJ from ${source || 'an ad'}. They are interested in luxury apartments. Ask for their move-in timeline and best phone number. End with booking link: ${BOOKING_FORM_URL}. No markdown. Sign off as: Iron 65 Leasing Team | (862) 333-1681 | inquiries@rosaliagroup.com`;
    
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    const emailBody = data.content?.[0]?.text || '';
    if (!emailBody) return;

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
    await transporter.sendMail({
      from: `"Iron 65 Leasing Team" <${GMAIL_USER}>`,
      to: email,
      subject: 'Your Iron 65 Inquiry -- Let\'s Schedule Your Tour',
      text: emailBody,
    });
    console.log('Email sent to lead:', email);
  } catch(e) { console.error('Email to lead error:', e.message); }
}

// Trigger Jessica outbound call
async function triggerJessicaCall(phone, leadName) {
  if (!phone || !VAPI_KEY) return;
  try {
    const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const res = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VAPI_KEY}` },
      body: JSON.stringify({
        phoneNumberId: JESSICA_PHONE_ID,
        assistantId: JESSICA_OUTBOUND_ASSISTANT_ID,
        customer: { number: phone, name: leadName || undefined },
        assistantOverrides: {
          variableValues: {
            today: today,
            call_type: 'outbound',
            property: 'Iron 65',
          },
        },
      }),
    });
    const data = await res.json();
    console.log('Jessica call triggered:', data.id || data.error);
    return data.id;
  } catch(e) { console.error('Call error:', e.message); }
}

async function notifyAna(newLeads) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
    const names = newLeads.slice(0, 3).map(l => `- ${l.name} (${l.source || 'FUB'})`).join('\n');
    await transporter.sendMail({
      from: `"Rosalia AI System" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject: `${newLeads.length} New FUB Lead(s)`,
      text: `New leads from Follow Up Boss:\n\n${names}${newLeads.length > 3 ? `\n...and ${newLeads.length - 3} more` : ''}`,
    });
  } catch (err) { console.error('Email notify error:', err.message); }
}


// -- HANDLER --
// Two modes:
// 1. GET /fubsync -- manual trigger or scheduled (pulls last 24h from FUB)
// 2. POST /fubsync -- FUB webhook (single person payload)
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    let people = [];

    if (event.httpMethod === 'POST') {
      // FUB webhook mode -- receives a single person event
      const body = JSON.parse(event.body || '{}');
      console.log('FUB webhook received:', JSON.stringify(body).substring(0, 300));

      // FUB webhook wraps person in event.person or event.data
      const person = body.person || body.data || body;
      if (person && (person.id || person.firstName || person.emails)) {
        people = [person];
      } else {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'No person data in webhook', body_keys: Object.keys(body) }),
        };
      }
    } else {
      // GET mode -- pull from FUB API
      const hoursBack = parseInt(event.queryStringParameters?.hours || '24');
      console.log(`Fetching FUB leads from last ${hoursBack} hours...`);
      people = await fetchNewFUBLeads(hoursBack);
      console.log(`Found ${people.length} people in FUB`);
    }

    const results = { created: 0, updated: 0, skipped: 0, errors: 0 };
    const newLeads = [];

    for (const person of people) {
      try {
        const saved = await saveToSupabase(person);
        if (saved?._action === 'created') {
          results.created++;
          newLeads.push({ id: saved.id, name: saved.name, email: saved.email, phone: saved.phone, source: saved.source });
        } else if (saved?._action === 'updated') {
          results.updated++;
        } else {
          results.skipped++;
        }
      } catch (err) {
        console.error('Error saving person:', err.message);
        results.errors++;
      }
    }

    // Notify Ana only if new leads were created
    if (newLeads.length > 0) {
      await notifyAna(newLeads);
      
      // For each new lead: send email, SMS, and trigger call during business hours
      for (const lead of newLeads) {
        try {
          // Send AI email if they have an email
          if (lead.email && !lead.email.includes('incomplete-')) {
            await sendEmailToLead(lead.email, lead.name, lead.source);
          }
          // Send SMS if they have a phone
          if (lead.phone) {
            await sendSMSToLead(lead.phone, lead.name);
          }
          // Trigger Jessica call during business hours
          if (lead.phone) {
            const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
            const etHour = nowET.getHours();
            const etDay = nowET.getDay();
            let callAllowed = false;
            if (etDay >= 1 && etDay <= 5) callAllowed = etHour >= 9 && etHour < 18;
            else if (etDay === 6) callAllowed = etHour >= 10 && etHour < 17;
            else if (etDay === 0) callAllowed = etHour >= 11 && etHour < 17;
            if (callAllowed) {
              await triggerJessicaCall(lead.phone, lead.name);
              // Mark as called
              await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
                body: JSON.stringify({ called_at: new Date().toISOString(), status: 'contacted' }),
              });
            }
          }
          await new Promise(r => setTimeout(r, 1000));
        } catch(e) { console.error('Lead outreach error:', e.message); }
      }
    }

    console.log('Sync results:', JSON.stringify(results));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        total_from_fub: people.length,
        results,
      }),
    };

  } catch (err) {
    console.error('fubsync error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
