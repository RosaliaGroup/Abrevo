const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPI_KEY = process.env.VAPI_KEY;
const VAPI_ASSISTANT_ID = '1cae5323-6b83-4434-8461-6330472da140';
const VAPI_PHONE_ID = '2e2b6713-f631-4e9e-95fa-3418ecc77c0a';
const JESSICA_ASSISTANT_ID = '35f4e4a2-aabc-47be-abfc-630cf6a85d58';
const JESSICA_PHONE_ID = '2e2b6713-f631-4e9e-95fa-3418ecc77c0a';
const { sendSMS } = require('./lib/sms');
const { isSkipNumber } = require('./lib/skipNumbers');
const { cleanName } = require('./lib/leadName');
const ANA_PHONE = '+16462269189';
const BOOKING_FORM_URL = 'https://book.rosaliagroup.com/book';
const IRON65_BOOKING_URL = 'https://book.rosaliagroup.com/iron65';

// Max call attempts before giving up
const MAX_CALL_ATTEMPTS = 5;
// Minimum hours between call attempts. Was 2, which meant a lead who never
// answered received five calls and five texts inside a single afternoon.
const MIN_HOURS_BETWEEN_CALLS = 24;

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
    // Stop calling anyone who has engaged or moved down the funnel. The old
    // filter named survey_completed/needs_specialist, which no longer exist
    // after the FUB ladder migration — leads at 'contacted' or 'appt_set'
    // were still being picked up.
    // Rosalia-side only. Without this a Mechanical Enterprise lead gets called by
    // Alex, Rosalia's LEASING assistant, and texted a Rosalia apartment booking
    // link — the wrong brand entirely. 1,100 mechanical leads sit in this table.
    `client=neq.mechanical&` +
    `status=neq.dnc&` +
    `status=neq.contacted&` +
    `status=neq.appt_set&` +
    `status=neq.applied&` +
    `status=neq.rented&` +
    `name=not.eq.Follow Up Boss&` +
    `name=not.ilike.*HEALTHCHECK*&` +
    `name=not.ilike.*Test*&` +
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
      // They booked: that's Appointment Set on the ladder, not just "contacted".
      await updateLeadStatus(lead.id, 'appt_set', lead.call_attempts || 0);
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

// Permanently exclude a lead from calling/texting (own business line, etc.).
async function markDnc(leadId) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ status: 'dnc' }),
  });
}

// Placeholders that live in leads.property but aren't buildings — naming these
// in a text would read as nonsense ("your inquiry about Real Estate Inquiry").
const NON_BUILDING = /^(real estate inquiry|mechanical enterprise|general|inquiry|n\/a|unknown)/i;

/**
 * The building to name in a message, or null to fall back to generic wording.
 * 35% of leads have no property at all, so the fallback is the common path.
 */
function buildingLabel(property) {
  const p = String(property || '').trim().replace(/\s+/g, ' ');
  if (!p || p.length > 48 || NON_BUILDING.test(p)) return null;
  // Form fragments leak into these columns ("2C. Pet Description: no pets.").
  // Real building names never contain a colon or semicolon, so that's a
  // reliable tell that we're looking at a chunk of a form, not an address.
  if (/[:;]/.test(p) || /pet\s*(description|type)/i.test(p)) return null;
  return p;
}

async function sendLeadSMS(phone, leadName, bookingUrl, attemptNumber, property) {
  const firstName = (leadName || '').split(' ')[0] || 'there';
  const b = buildingLabel(property);

  // Vary the message based on attempt number. Every variant names the building
  // the lead actually inquired about when we know it — a follow-up that just
  // says "your apartment inquiry" reads like a blast to someone who asked about
  // one specific address.
  let msg;
  if (attemptNumber === 1) {
    msg = b
      ? `Hi ${firstName}! Alex from Rosalia Group here -- tried reaching you about ${b}. Book your tour: ${bookingUrl}`
      : `Hi ${firstName}! Alex from Rosalia Group here -- tried reaching you about your apartment inquiry. Book your tour anytime: ${bookingUrl}`;
  } else if (attemptNumber === 2) {
    msg = b
      ? `Hi ${firstName}! Alex from Rosalia Group again. Still have availability at ${b}. Book here: ${bookingUrl}`
      : `Hi ${firstName}! Alex from Rosalia Group again. Still have great apartments available for you. Book here: ${bookingUrl}`;
  } else {
    msg = b
      ? `Hi ${firstName}! Rosalia Group here -- limited units left at ${b}. Book your tour: ${bookingUrl}`
      : `Hi ${firstName}! Rosalia Group here -- we have limited units available. Don't miss out! Book your tour: ${bookingUrl}`;
  }

  // 1h cooldown: readmail already texts a brand-new lead the moment their
  // email lands, and autocall picks the same lead up seconds later. Without
  // this they get two texts ~20s apart. The CALL still happens either way.
  const result = await sendSMS(phone, msg, { optOut: true, cooldownHours: 1 });
  console.log(`SMS attempt ${attemptNumber} sent to ${result.to || phone}: ${result.success}`);
  return result;
}

async function triggerCall(phone, leadName, assistantId, phoneId, property) {
  try {
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
          variableValues: {
            today: today,
            tomorrow: tomorrow,
            call_type: 'outbound',
            property: property || '',
            customer_name: leadName || '',
            customer_phone: phone,
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
        // Never call/text our own business, callback, or Telnyx sender lines.
        if (isSkipNumber(lead.phone)) {
          console.log(`autocall skip (own/business line): ${lead.name} | ${lead.phone} -> marking dnc`);
          await markDnc(lead.id);
          results.skipped++;
          continue;
        }

        // Matched loosely on purpose. The client column has historically held
        // 'Iron 65 - 65 McWhorter St, Newark NJ' as well as 'iron65', and an
        // exact comparison silently routed those 272 leads to Rosalia's
        // assistant and booking URL. The property is checked too, so a lead is
        // routed by which building they asked about even if client is wrong.
        const brand = `${lead.client || ''} ${lead.property || ''}`;
        const isIron65 = /iron\s*-?\s*65|mcwhorter/i.test(brand);
        const assistantId = isIron65 ? JESSICA_ASSISTANT_ID : VAPI_ASSISTANT_ID;
        const phoneId = isIron65 ? JESSICA_PHONE_ID : VAPI_PHONE_ID;
        const bookingUrl = isIron65 ? IRON65_BOOKING_URL : BOOKING_FORM_URL;
        const attempts = (lead.call_attempts || 0) + 1;

        // Vapi rejects customer.name > 40 chars; some leads have a whole form
        // body stuffed into name. Derive a clean, bounded name for the call.
        const callName = cleanName(lead.name, 40);
        if (callName !== String(lead.name || '').trim()) {
          console.log(`autocall: sanitized caller name (lead ${lead.id}): ${JSON.stringify(String(lead.name || '').slice(0, 80))} -> ${JSON.stringify(callName)}`);
        }

        console.log(`Calling: ${callName} | ${lead.phone} | attempt ${attempts}/${MAX_CALL_ATTEMPTS}`);

        // Trigger call
        const callId = await triggerCall(lead.phone, callName, assistantId, phoneId, lead.property);

        // Send SMS after every missed call attempt
        await sendLeadSMS(lead.phone, callName, bookingUrl, attempts, lead.property);

        // Placing a call is an ATTEMPT, however many times we try. 'contacted'
        // means the person actually engaged, and only an inbound reply proves
        // that — so it is set by telnyx-inbound, never here. Calling stops via
        // call_attempts >= MAX, not by faking a stage advance.
        const AHEAD = ['contacted', 'appt_set', 'applied', 'rented', 'dnc'];
        const newStatus = AHEAD.includes(lead.status) ? lead.status : 'attempted';
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
