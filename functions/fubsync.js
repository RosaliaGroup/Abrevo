const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const FUB_API_KEY = 'fka_0BintMy4p0REoWnt6504EBuAzvPkD7gi0h';
const FUB_BASE = 'https://api.followupboss.com/v1';
const ANA_PHONE = '+16462269189';

// FUB auth header — Basic auth with API key as username, empty password
const FUB_AUTH = 'Basic ' + Buffer.from(FUB_API_KEY + ':').toString('base64');

// ── FETCH NEW LEADS FROM FUB ──
// Gets people created in the last 24 hours
async function fetchNewFUBLeads(hoursBack = 24) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  
  const res = await fetch(
    `${FUB_BASE}/people?sort=created&direction=desc&limit=20&createdAfter=${encodeURIComponent(since)}`,
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
  return data.people || [];
}

// ── SAVE LEAD TO SUPABASE ──
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
      property,
      client: 'rosalia',
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

// ── NOTIFY ANA ──
async function notifyAna(newLeads) {
  if (!newLeads.length) return;
  const msg = `FUB Sync: ${newLeads.length} new lead(s)\n` +
    newLeads.slice(0, 3).map(l => `• ${l.name} (${l.source || 'FUB'})`).join('\n');
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: ANA_PHONE, message: msg, key: TEXTBELT_KEY }),
    });
  } catch (err) { console.error('SMS error:', err.message); }
}

// ── HANDLER ──
// Two modes:
// 1. GET /fubsync — manual trigger or scheduled (pulls last 24h from FUB)
// 2. POST /fubsync — FUB webhook (single person payload)
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    let people = [];

    if (event.httpMethod === 'POST') {
      // FUB webhook mode — receives a single person event
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
      // GET mode — pull from FUB API
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
          newLeads.push({ name: saved.name, source: saved.source });
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
