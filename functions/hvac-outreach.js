// hvac-outreach.js
// Bulk outreach for Mechanical Enterprise HVAC leads
// Reads from hvac_leads table, triggers Vapi call + SMS + email per lead
// POST body: { batch_size?: number, dry_run?: boolean, mode?: "call"|"sms"|"email"|"all" }
// Netlify scheduled function — can also be triggered manually from dashboard

const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPI_KEY = process.env.VAPI_KEY || '064f441d-a388-4404-8b6c-05e91e90f1ff';
const TEXTBELT_KEY = process.env.TEXTBELT_KEY || '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// HVAC-specific Vapi config — uses Jessica assistant (CINC outbound)
// TODO: Replace JESSICA_ASSISTANT_ID with a dedicated HVAC assistant if created
const HVAC_ASSISTANT_ID = process.env.HVAC_ASSISTANT_ID || '35f4e4a2-aabc-47be-abfc-630cf6a85d58';
const HVAC_PHONE_ID = process.env.HVAC_PHONE_ID || '2e2b6713-f631-4e9e-95fa-3418ecc77c0a';

// Booking links
const HVAC_BOOKING_URL = 'https://abrevo.co/booking-form-hvac.html';
const HVAC_RESCHEDULE_URL = 'https://abrevo.co/reschedule-form-hvac.html';

// Notification
const ANA_PHONE = '+16462269189';
const HVAC_EMAIL = 'sales@mechanicalenterprise.com';
const FROM_EMAIL = process.env.GMAIL_USER || 'inquiries@rosaliagroup.com';

// ── BUSINESS HOURS ──
function isBusinessHours() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const hour = et.getHours();
  if (day >= 1 && day <= 5) return hour >= 9 && hour < 18;
  if (day === 6) return hour >= 10 && hour < 17;
  return false; // No Sunday calls
}

// ── NORMALIZE PHONE ──
function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.toString().replace(/\D/g, '');
  if (p.length === 10) p = '+1' + p;
  else if (p.length === 11 && !p.startsWith('+')) p = '+' + p;
  return p.length >= 11 ? p : null;
}

// ── VALID EMAIL CHECK ──
function isValidEmail(email) {
  if (!email) return false;
  if (email.includes('placeholder.mwbe')) return false;
  if (email.includes('noemail-')) return false;
  if (!email.includes('@') || !email.includes('.')) return false;
  return true;
}

// ── SEND SMS ──
async function sendSMS(phone, message) {
  if (!phone) return { success: false, error: 'No phone' };
  try {
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
    });
    const result = await res.json();
    console.log(`SMS to ${phone}:`, result.success ? 'OK' : result.error);
    return result;
  } catch (err) {
    console.error('SMS error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── TRIGGER VAPI CALL ──
async function triggerCall(phone, name, address) {
  if (!VAPI_KEY) return { success: false, error: 'No VAPI_KEY' };
  try {
    const res = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VAPI_KEY}`,
      },
      body: JSON.stringify({
        phoneNumberId: HVAC_PHONE_ID,
        assistantId: HVAC_ASSISTANT_ID,
        customer: {
          number: phone,
          name: name || undefined,
        },
        assistantOverrides: {
          variableValues: {
            lead_name: name || '',
            lead_address: address || '',
            booking_link: HVAC_BOOKING_URL,
            lead_source: 'HVAC Target List',
            company: 'Mechanical Enterprise',
          },
        },
      }),
    });
    const data = await res.json();
    console.log(`Vapi call to ${phone}:`, data.id ? 'TRIGGERED' : JSON.stringify(data).substring(0, 100));
    return { success: !!data.id, callId: data.id, error: data.message };
  } catch (err) {
    console.error('Vapi error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── GENERATE AI EMAIL ──
async function generateEmail(name, address, income, yearBuilt) {
  const firstName = (name || '').split(' ')[0] || 'there';
  
  const prompt = `You are the outreach team for Mechanical Enterprise, a top HVAC company in North Jersey.
Write a SHORT personalized email to a homeowner about a FREE HVAC assessment.

Key facts:
- Name: ${firstName}
- Address: ${address || 'North Jersey'}
- Home built: ${yearBuilt || 'unknown year'}
- Income bracket: ${income || 'not specified'}
- We offer FREE home energy assessments
- NJ rebates up to $16,000 available on new HVAC systems
- Same-day service available
- Book online: ${HVAC_BOOKING_URL}

Write a warm, brief email (under 90 words) that:
1. Addresses them by first name
2. Mentions their home may qualify for rebates based on when it was built
3. Offers a free assessment with no obligation
4. Includes the booking link
5. Signs off as: Mechanical Enterprise | (862) 419-1763 | sales@mechanicalenterprise.com

Write ONLY the email body, no subject line.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch (err) {
    console.error('AI email error:', err.message);
    return null;
  }
}

// ── SEND EMAIL ──
async function sendEmail(toEmail, toName, body) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: FROM_EMAIL, pass: process.env.GMAIL_PASS },
  });
  const firstName = (toName || '').split(' ')[0] || 'there';
  await transporter.sendMail({
    from: `"Mechanical Enterprise" <${FROM_EMAIL}>`,
    to: toEmail,
    subject: `Free HVAC Assessment — ${firstName}, your home may qualify for rebates`,
    text: body,
  });
}

// ── UPDATE HVAC LEAD STATUS ──
async function updateLeadStatus(id, status, extra = {}) {
  await fetch(`${SUPABASE_URL}/rest/v1/hvac_leads?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      status,
      updated_at: new Date().toISOString(),
      ...extra,
    }),
  });
}

// ── FETCH LEADS TO CONTACT ──
async function getLeadsToContact(batchSize = 10) {
  // Get leads that are still 'new' — not yet called/texted/emailed
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/hvac_leads?status=eq.new&order=created_at.asc&limit=${batchSize}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const leads = await res.json();
  return Array.isArray(leads) ? leads : [];
}

// ── MAIN HANDLER ──
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    const batchSize = body.batch_size || 10;
    const dryRun = body.dry_run || false;
    const mode = body.mode || 'all'; // "call" | "sms" | "email" | "all"

    if (!isBusinessHours() && !body.force) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          skipped: true,
          reason: 'Outside business hours (Mon–Fri 9AM–6PM, Sat 10AM–5PM ET). Pass force:true to override.',
        }),
      };
    }

    const leads = await getLeadsToContact(batchSize);
    console.log(`Found ${leads.length} leads to contact (batch_size=${batchSize}, mode=${mode})`);

    if (leads.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'No new leads to contact', contacted: 0 }) };
    }

    const results = [];

    for (const lead of leads) {
      const phone = normalizePhone(lead.phone);
      const name = lead.name || '';
      const address = lead.page || ''; // 'page' column holds the address
      const email = isValidEmail(lead.email) ? lead.email : null;
      
      // Parse income and year built from message field
      const msg = lead.message || '';
      const yearMatch = msg.match(/Year Built:\s*(\d{4})/);
      const incomeMatch = msg.match(/Income:\s*([^|]+)/);
      const yearBuilt = yearMatch ? yearMatch[1] : null;
      const income = incomeMatch ? incomeMatch[1].trim() : null;

      const result = { id: lead.id, name, phone, email, call: null, sms: null, email: null };

      if (dryRun) {
        result.dry_run = true;
        results.push(result);
        continue;
      }

      // ── CALL ──
      if ((mode === 'all' || mode === 'call') && phone) {
        result.call = await triggerCall(phone, name, address);
        await new Promise(r => setTimeout(r, 1000)); // 1s between calls
      }

      // ── SMS ──
      if ((mode === 'all' || mode === 'sms') && phone) {
        const smsMsg = `Hi ${name.split(' ')[0] || 'there'}! This is Mechanical Enterprise in NJ. Your home at ${address || 'your property'} may qualify for up to $16,000 in NJ HVAC rebates. Book a FREE assessment: ${HVAC_BOOKING_URL} — (862) 419-1763`;
        result.sms = await sendSMS(phone, smsMsg);
        await new Promise(r => setTimeout(r, 300));
      }

      // ── EMAIL ──
      if ((mode === 'all' || mode === 'email') && email) {
        try {
          const emailBody = await generateEmail(name, address, income, yearBuilt);
          if (emailBody) {
            await sendEmail(email, name, emailBody);
            result.email = { success: true };
          }
        } catch (err) {
          result.email = { success: false, error: err.message };
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // ── UPDATE STATUS ──
      const contacted = result.call?.success || result.sms?.success || result.email?.success;
      if (contacted) {
        const now = new Date().toISOString();
        const extra = { last_contacted_at: now };
        if (result.call?.success)  extra.call_triggered_at = now;
        if (result.sms?.success)   extra.sms_sent_at = now;
        if (result.email?.success) extra.email_sent_at = now;
        await updateLeadStatus(lead.id, 'contacted', extra);
      }

      results.push(result);
    }

    // Summary
    const called = results.filter(r => r.call?.success).length;
    const texted = results.filter(r => r.sms?.success).length;
    const emailed = results.filter(r => r.email?.success).length;
    const contacted = results.filter(r => r.call?.success || r.sms?.success || r.email?.success).length;

    console.log(`Done — Called: ${called}, Texted: ${texted}, Emailed: ${emailed}`);

    // Notify Ana
    if (!dryRun && contacted > 0) {
      await sendSMS(ANA_PHONE, `HVAC Outreach complete!\nBatch: ${leads.length} leads\nCalled: ${called}\nTexted: ${texted}\nEmailed: ${emailed}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        batch: leads.length,
        called,
        texted,
        emailed,
        contacted,
        dry_run: dryRun,
        results: results.map(r => ({ id: r.id, name: r.name, call: r.call?.success, sms: r.sms?.success, email: r.email?.success })),
      }),
    };

  } catch (err) {
    console.error('hvac-outreach error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
