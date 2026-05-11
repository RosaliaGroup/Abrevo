const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const ANA_PHONE = '+16462269189';

// ── PARSE FUB EMAIL BODY ──
// Handles format:
// "You've received a new lead named Sam Lippin from Facebook
//  (929) 523-3064
//  sam.lippin@gmail.com
//  Which residence layout are you most interested in?: loft_(starting_at_$2,999)
//  Ad: AD - 1  Ad Set: Rental Intent Ad  Campaign: Luxury Apartments Leads Campaign
//  Form: Winter Collection – Luxury Pre-Leasing Form  Platform: Instagram"

function parseFUBEmail(text) {
  if (!text) return null;

  const lead = {
    source: 'fub',
    client: 'rosalia',
  };

  // Name + source: "You've received a new lead named Sam Lippin from Facebook"
  const nameMatch = text.match(/new lead named ([^\n]+?) from ([^\n]+)/i);
  if (nameMatch) {
    lead.name = nameMatch[1].trim();
    lead.source = nameMatch[2].trim().toLowerCase(); // e.g. "facebook", "instagram"
  }

  // Phone: (929) 523-3064  or  9295233064  or  +19295233064
  const phoneMatch = text.match(/(\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4})/);
  if (phoneMatch) {
    let p = phoneMatch[1].replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11) p = '+' + p;
    lead.phone = p;
  }

  // Email
  const emailMatch = text.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    lead.email = emailMatch[1].trim();
  }

  // Property / layout interest — stop before "Ad:" if present on same line
  const layoutMatch = text.match(/(?:layout|interested in|unit|apartment)[^:]*:\s*([^\n]+)/i);
  if (layoutMatch) {
    // Stop at "Ad:" or "Campaign:" if they appear on the same line
    let prop = layoutMatch[1].trim();
    prop = prop.split(/\s+(?:Ad:|Campaign:|Form:|Platform:)/i)[0].trim();
    // Clean up underscores: "loft_(starting_at_$2,999)" → "loft (starting at $2,999)"
    lead.property = prop.replace(/_/g, ' ');
  }

  // Budget — extract price from layout string if present
  const priceMatch = text.match(/\$[\d,]+/);
  if (priceMatch) {
    lead.budget = priceMatch[0];
  }

  // Campaign / ad info → notes
  const notes = [];
  const adMatch = text.match(/Ad:\s*([^\n]+?)(?:\s+Ad Set:|$)/i);
  const adSetMatch = text.match(/Ad Set:\s*([^\n]+?)(?:\s+Campaign:|$)/i);
  const campaignMatch = text.match(/Campaign:\s*([^\n]+?)(?:\s+Form:|$)/i);
  const formMatch = text.match(/Form:\s*([^\n]+?)(?:\s+Platform:|$)/i);
  const platformMatch = text.match(/Platform:\s*([^\n]+)/i);

  if (adMatch) notes.push(`Ad: ${adMatch[1].trim()}`);
  if (adSetMatch) notes.push(`Ad Set: ${adSetMatch[1].trim()}`);
  if (campaignMatch) notes.push(`Campaign: ${campaignMatch[1].trim()}`);
  if (formMatch) notes.push(`Form: ${formMatch[1].trim()}`);
  if (platformMatch) {
    const platform = platformMatch[1].trim();
    notes.push(`Platform: ${platform}`);
    // Override source with platform if more specific
    if (['instagram', 'facebook', 'google', 'zillow'].includes(platform.toLowerCase())) {
      lead.source = platform.toLowerCase();
    }
  }

  lead.message = notes.join(' | ') || null;

  // Require at least name or email or phone
  if (!lead.name && !lead.email && !lead.phone) return null;

  return lead;
}

// ── SAVE TO SUPABASE ──
async function saveToSupabase(lead) {
  // Check for existing lead by email or phone
  if (lead.email) {
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(lead.email)}&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await checkRes.json();
    if (Array.isArray(existing) && existing.length > 0) {
      // Update existing — append new note
      const existingLead = existing[0];
      const newNote = `[${new Date().toLocaleDateString()}] FUB: ${lead.message || 'new inquiry'}`;
      const mergedNotes = existingLead.notes
        ? existingLead.notes + '\n' + newNote
        : newNote;
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${existingLead.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ notes: mergedNotes, source: lead.source }),
      });
      console.log('Updated existing lead:', existingLead.id);
      return { ...existingLead, _action: 'updated' };
    }
  }

  // Also check phone if no email match
  if (lead.phone) {
    const cleanPhone = lead.phone.replace(/\D/g, '');
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${cleanPhone}*&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await checkRes.json();
    if (Array.isArray(existing) && existing.length > 0) {
      console.log('Found existing lead by phone:', existing[0].id);
      return { ...existing[0], _action: 'found_by_phone' };
    }
  }

  // Insert new lead
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      name: lead.name || null,
      email: lead.email || null,
      phone: lead.phone || null,
      source: lead.source || 'fub',
      message: lead.message || null,
      property: lead.property || null,
      client: 'rosalia',
      status: 'new',
      replied_at: new Date().toISOString(),
      follow_up_count: 0,
      notes: [
        `Source: FUB email notification`,
        lead.budget && `Budget: ${lead.budget}`,
        lead.message,
      ].filter(Boolean).join(' | '),
    }),
  });

  const text = await res.text();
  console.log('Supabase insert:', res.status, text.substring(0, 200));

  try {
    const saved = JSON.parse(text);
    const record = Array.isArray(saved) ? saved[0] : saved;
    return { ...record, _action: 'created' };
  } catch (e) {
    return null;
  }
}

// ── NOTIFY ANA ──
async function notifyAna(lead, action) {
  if (!ANA_PHONE) return;
  const emoji = action === 'created' ? 'New' : 'Updated';
  const msg = `${emoji} FUB Lead!\nName: ${lead.name || 'N/A'}\nEmail: ${lead.email || 'N/A'}\nPhone: ${lead.phone || 'N/A'}\nSource: ${lead.source || 'N/A'}\nProperty: ${lead.property || 'N/A'}`;
  try {
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: ANA_PHONE, message: msg, key: TEXTBELT_KEY }),
    });
    const result = await res.json();
    console.log('Ana SMS:', result.success ? 'sent' : result.error);
  } catch (err) {
    console.error('SMS error:', err.message);
  }
}

// ── HANDLER ──
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    let emailText = '';

    // Accept multiple input formats:
    // 1. { "text": "You've received a new lead..." }  — raw text
    // 2. { "body": "..." }  — some email forwarders use this
    // 3. Plain string body
    const body = JSON.parse(event.body || '{}');
    emailText = body.text || body.body || body.email_text || body.plain || '';

    // Also accept multipart/form-data from email services like Zapier, Mailgun, SendGrid
    if (!emailText && event.body && !event.body.startsWith('{')) {
      emailText = event.body;
    }

    if (!emailText) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No email text provided. Send { "text": "..." }' }),
      };
    }

    console.log('Parsing FUB email, length:', emailText.length);
    console.log('Preview:', emailText.substring(0, 200));

    const lead = parseFUBEmail(emailText);

    if (!lead) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, message: 'Could not parse lead from email text' }),
      };
    }

    console.log('Parsed lead:', JSON.stringify(lead));

    const saved = await saveToSupabase(lead);
    console.log('Save result:', saved?._action, 'id:', saved?.id);

    await notifyAna(lead, saved?._action || 'created');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        action: saved?._action,
        lead_id: saved?.id,
        parsed: {
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          source: lead.source,
          property: lead.property,
        },
      }),
    };
  } catch (err) {
    console.error('parseFUBEmail error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
