const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const { sendSMS } = require('./lib/sms');
const { getBookingLink } = require('./lib/propertyMedia');
const { fubAccounts, DEFAULT_ACCT_LABEL } = require('./lib/fubAccounts');
const { cleanName } = require('./lib/leadName');
const BOOKING_FORM_URL = 'https://book.rosaliagroup.com/iron65';
const FUB_BASE = 'https://api.followupboss.com/v1';

const VAPI_KEY = process.env.VAPI_KEY;
const JESSICA_PHONE_ID = '2e2b6713-f631-4e9e-95fa-3418ecc77c0a';
const JESSICA_OUTBOUND_ASSISTANT_ID = '35f4e4a2-aabc-47be-abfc-630cf6a85d58';

// Warn when a FUB account is running low on API budget (shared header check).
function logRateLimit(res, acctLabel) {
  const rem = res.headers.get('x-ratelimit-remaining') || res.headers.get('x-rate-limit-remaining');
  if (rem != null && Number(rem) < 20) {
    console.warn(`FUB rate limit low (${acctLabel}): ${rem} remaining`);
  }
}

async function fetchNewFUBLeads(hoursBack, auth, acctLabel) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  // FUB doesn't support createdAfter filter -- fetch recent and filter by date
  const res = await fetch(
    `${FUB_BASE}/people?sort=created&direction=desc&limit=50`,
    {
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FUB API error ${res.status} (${acctLabel}): ${err}`);
  }

  logRateLimit(res, acctLabel);
  const data = await res.json();
  const allPeople = data.people || [];
  const people = allPeople.filter(p => {
    if (!p.created) return false;
    return new Date(p.created) >= since;
  });
  console.log('FUB (' + acctLabel + '): ' + allPeople.length + ' total, ' + people.length + ' within last ' + hoursBack + 'h');
  // Tag each person with its source account for downstream routing/traceability.
  people.forEach(p => { p._acct = acctLabel; });
  return people;
}

// Pull recent leads from every configured FUB account. Accounts with an unset
// key are skipped with a warning (never crash the whole sync).
async function fetchAllAccounts(hoursBack) {
  const people = [];
  for (const acct of fubAccounts()) {
    if (!acct.auth) {
      console.warn(`FUB account ${acct.label}: key unset -- skipping`);
      continue;
    }
    try {
      const ppl = await fetchNewFUBLeads(hoursBack, acct.auth, acct.label);
      people.push(...ppl);
    } catch (e) {
      console.error(`FUB account ${acct.label} pull error:`, e.message);
    }
  }
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
  const acct = fubPerson._acct || DEFAULT_ACCT_LABEL;

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
      // Phone-arrival: the row had no phone and FUB now supplies one.
      const phoneArrived = !existingLead.phone && !!normalizedPhone;
      const newNote = `[${new Date().toLocaleDateString()}] FUB sync: acct=${acct}, stage=${stage || 'N/A'}, source=${source}`;
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
      return { ...existingLead, phone: existingLead.phone || normalizedPhone, _action: 'updated', _phoneArrived: phoneArrived, _newPhone: normalizedPhone };
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
    `Account: ${acct}`,
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
      status: 'lead',
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

// Agent-based routing (single rule across both FUB accounts): leads assigned to
// Felipe OR the "Rosalia Group Listings" house assignee get Rosalia Group
// treatment with a property-specific booking link; everyone else (including
// unassigned) keeps the Iron 65 treatment.
function isRosaliaLead(assignedTo) {
  const a = (assignedTo || '').toLowerCase();
  return a.includes('felipe') || a.includes('rosalia');
}

// Send SMS to lead. Dedupes on leads.outreach_sms_at so a lead is texted once
// across the created / phone-arrived / sweep paths (fubsync runs every minute).
async function sendSMSToLead(leadId, phone, leadName, property, assignedTo) {
  if (!phone) return;

  // Backstop: skip if this lead was already texted.
  if (leadId) {
    try {
      const chk = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=outreach_sms_at`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await chk.json();
      if (Array.isArray(rows) && rows[0] && rows[0].outreach_sms_at) {
        console.log('SMS skip (already sent):', leadId, phone);
        return;
      }
    } catch (e) { /* if the check fails, fall through and attempt the send */ }
  }

  const firstName = (leadName || '').split(' ')[0] || 'there';
  let msg;
  if (isRosaliaLead(assignedTo)) {
    msg = `Hi ${firstName}! Rosalia Group here — we got your inquiry${property ? ' about ' + property : ''}. Book a tour: ${getBookingLink(property, phone)}`;
  } else {
    msg = `Hi ${firstName}! Alex from Iron 65 Luxury Apartments here. We received your inquiry and would love to show you our brand new building in Newark's Ironbound District. Book your tour: ${BOOKING_FORM_URL}`;
  }
  const result = await sendSMS(phone, msg, { optOut: true });
  console.log('SMS sent to lead:', phone, result.success);

  // Stamp on success so the dedupe/sweep never re-texts this lead.
  if (result.success && leadId) {
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ outreach_sms_at: new Date().toISOString() }),
    });
  }
}

// Send AI email to lead
async function sendEmailToLead(email, leadName, source, property, assignedTo, phone) {
  if (!email || email.includes('incomplete-') || !ANTHROPIC_KEY) return;
  try {
    const firstName = (leadName || '').split(' ')[0] || 'there';
    const rosalia = isRosaliaLead(assignedTo);

    let prompt, fromName, subject;
    if (rosalia) {
      const bookingLink = getBookingLink(property, phone);
      prompt = `Write a short warm email (max 3 sentences) to ${firstName} who just inquired${property ? ' about ' + property : ''} with Rosalia Group, a luxury apartment group in Newark NJ, from ${source || 'an ad'}. Ask for their move-in timeline and best phone number. End with booking link: ${bookingLink}. No markdown. Sign off as: Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com`;
      fromName = 'Rosalia Group Leasing';
      subject = 'Your Rosalia Group Inquiry -- Let\'s Schedule Your Tour';
    } else {
      prompt = `Write a short warm email (max 3 sentences) to ${firstName} who just inquired about Iron 65 Luxury Apartments in Newark NJ from ${source || 'an ad'}. They are interested in luxury apartments. Ask for their move-in timeline and best phone number. End with booking link: ${BOOKING_FORM_URL}. No markdown. Sign off as: Iron 65 Leasing Team | (862) 333-1681 | inquiries@rosaliagroup.com`;
      fromName = 'Iron 65 Leasing Team';
      subject = 'Your Iron 65 Inquiry -- Let\'s Schedule Your Tour';
    }

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
      from: `"${fromName}" <${GMAIL_USER}>`,
      to: email,
      subject,
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
        customer: { number: phone, name: cleanName(leadName, 40) || undefined },
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

// Business-hours gate for the Jessica outbound call (Eastern Time).
function callAllowedNow() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const etHour = nowET.getHours();
  const etDay = nowET.getDay();
  if (etDay >= 1 && etDay <= 5) return etHour >= 9 && etHour < 18;
  if (etDay === 6) return etHour >= 10 && etHour < 17;
  if (etDay === 0) return etHour >= 11 && etHour < 17;
  return false;
}

// Extract an assigned agent name from a lead's notes ("Assigned to: X"), used
// as a fallback for sweep rows where the FUB assignment isn't a column value.
function assignedFromNotes(notes) {
  const m = (notes || '').match(/Assigned to:\s*([^|\n]+)/i);
  return m ? m[1].trim() : null;
}

// Shared SMS + business-hours call for one lead. NOT email -- email is only
// sent on the created path (already-created leads were emailed at intake). SMS
// dedupes via outreach_sms_at, so this is safe to run across all three paths.
async function smsAndCall(lead) {
  if (lead.phone) {
    await sendSMSToLead(lead.id, lead.phone, lead.name, lead.property, lead.assignedTo);
    if (callAllowedNow()) {
      await triggerJessicaCall(lead.phone, lead.name);
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ called_at: new Date().toISOString(), status: 'contacted' }),
      });
    }
  }
  await new Promise(r => setTimeout(r, 1000));
}

// Safety-net sweep: any non-Mechanical lead with a phone but no outreach_sms_at,
// created in the last 7 days, gets routed outreach. Catches phones added by ANY
// path (manual Supabase entry, CINC merge, FUB update). The `client` column is
// inconsistently populated (iron65, building addresses, NULL, even corrupted
// rows), so we can't allowlist Rosalia; instead we EXCLUDE Mechanical/HVAC
// (client='mechanical') -- the only thing that must never be texted here.
// PostgREST neq drops NULLs, so NULL client is explicitly re-included. Capped at
// 10/run so a backlog drains gradually instead of blasting texts at once.
async function sweepPendingPhones() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let rows = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?phone=not.is.null&outreach_sms_at=is.null` +
      `&created_at=gt.${encodeURIComponent(sevenDaysAgo)}` +
      `&or=(client.neq.mechanical,client.is.null)` +
      `&order=created_at.asc&limit=10` +
      `&select=id,name,phone,property,assigned_to,notes`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    rows = await res.json();
    if (!Array.isArray(rows)) rows = [];
  } catch (e) { console.error('Sweep query error:', e.message); return; }

  console.log('FUB sweep: ' + rows.length + ' pending phone lead(s)');
  for (const row of rows) {
    try {
      const assignedTo = row.assigned_to || assignedFromNotes(row.notes);
      const lead = { id: row.id, name: row.name, phone: row.phone, property: row.property || null, assignedTo };
      console.log('FUB sweep outreach:', lead.name, '| agent:', assignedTo || 'unassigned', '→', isRosaliaLead(assignedTo) ? 'rosalia' : 'iron65');
      await smsAndCall(lead);
    } catch (e) { console.error('Sweep outreach error:', e.message); }
  }
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
        // Which account fired this webhook: configure each FUB account's webhook
        // URL as /fubsync?acct=<label>. Missing param -> the default account so
        // the existing webhook keeps working until dashboards are updated.
        person._acct = event.queryStringParameters?.acct || DEFAULT_ACCT_LABEL;
        people = [person];
      } else {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: 'No person data in webhook', body_keys: Object.keys(body) }),
        };
      }
    } else {
      // GET mode -- pull from every configured FUB account
      const hoursBack = parseInt(event.queryStringParameters?.hours || '24');
      console.log(`Fetching FUB leads from last ${hoursBack} hours (all accounts)...`);
      people = await fetchAllAccounts(hoursBack);
      console.log(`Found ${people.length} people across FUB accounts`);
    }

    const results = { created: 0, updated: 0, skipped: 0, errors: 0 };
    const newLeads = [];
    const phoneArrivedLeads = [];

    for (const person of people) {
      try {
        const saved = await saveToSupabase(person);
        if (saved?._action === 'created') {
          results.created++;
          newLeads.push({
            id: saved.id, name: saved.name, email: saved.email, phone: saved.phone, source: saved.source,
            property: person.propertyAddress || null,
            assignedTo: person.assignedTo?.name || null,
            acct: person._acct || DEFAULT_ACCT_LABEL,
          });
        } else if (saved?._action === 'updated') {
          results.updated++;
          // Phone arrived on an existing lead -> text it on this pass.
          if (saved._phoneArrived) {
            phoneArrivedLeads.push({
              id: saved.id, name: saved.name,
              phone: saved._newPhone || saved.phone,
              property: person.propertyAddress || null,
              assignedTo: person.assignedTo?.name || null,
              acct: person._acct || DEFAULT_ACCT_LABEL,
            });
          }
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
          const isRosalia = isRosaliaLead(lead.assignedTo);
          console.log('FUB route:', lead.name, '| acct:', lead.acct || DEFAULT_ACCT_LABEL, '| agent:', lead.assignedTo || 'unassigned', '→', isRosalia ? 'rosalia' : 'iron65');

          // Send AI email if they have an email
          if (lead.email && !lead.email.includes('incomplete-')) {
            await sendEmailToLead(lead.email, lead.name, lead.source, lead.property, lead.assignedTo, lead.phone);
          }
          // SMS (deduped + stamped) + business-hours call
          await smsAndCall(lead);
        } catch(e) { console.error('Lead outreach error:', e.message); }
      }
    }

    // Late-arriving phone numbers on existing leads: same routing, SMS + call.
    for (const lead of phoneArrivedLeads) {
      try {
        const isRosalia = isRosaliaLead(lead.assignedTo);
        console.log('FUB phone-arrived outreach:', lead.name, '| acct:', lead.acct || DEFAULT_ACCT_LABEL, '| agent:', lead.assignedTo || 'unassigned', '→', isRosalia ? 'rosalia' : 'iron65');
        await smsAndCall(lead);
      } catch(e) { console.error('Phone-arrived outreach error:', e.message); }
    }

    // Safety-net sweep for phones added by any other path.
    await sweepPendingPhones();

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
