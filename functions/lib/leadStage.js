// functions/lib/leadStage.js
//
// When a lead replies, two things should happen on their record:
//
//   1. Their message is stored on the lead (last_inbound_at / preview), so the
//      CRM list can show what they last said without a query per row.
//   2. Their stage advances to 'contacted'.
//
// Why 'contacted' is set HERE and nowhere else: placing a call or sending a text
// is an ATTEMPT, and autocall marks those as 'attempted'. An inbound reply is the
// only proof that a real two-way conversation happened. Keeping the two apart is
// what makes "Contacted" a meaningful filter rather than a synonym for "we dialled".
//
// Everything is best-effort and never throws: this runs inside the Telnyx inbound
// webhook, and a database problem must not turn into a non-2xx, which would make
// Telnyx retry and duplicate the message.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Stages at or beyond real contact. A reply must never drag someone who has
// already applied or signed back down the funnel — and it must never silently
// undo a Do Not Contact.
const AT_OR_BEYOND_CONTACT = new Set(['contacted', 'appt_set', 'applied', 'rented', 'dnc']);

const PREVIEW_CHARS = 140;

function headers() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

/**
 * Record an inbound reply against the matching lead.
 *
 * @param {string} phone  sender, any format
 * @param {string} text   message body
 * @returns {Promise<{updated:boolean, leadId?:string, stage?:string, reason?:string}>}
 */
async function recordInboundOnLead(phone, text) {
  try {
    if (!SUPABASE_KEY) return { updated: false, reason: 'missing_key' };
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 10) return { updated: false, reason: 'bad_phone' };
    const last10 = digits.slice(-10);

    // Match on the last 10 digits — the convention used throughout the codebase,
    // since stored numbers vary between +1XXXXXXXXXX, XXXXXXXXXX and formatted.
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${last10}*&select=id,status&order=created_at.desc&limit=1`,
      { headers: headers() }
    );
    const rows = await findRes.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { updated: false, reason: 'no_matching_lead' };
    }
    const lead = rows[0];

    const patch = {
      last_inbound_at: new Date().toISOString(),
      last_inbound_preview: String(text || '').slice(0, PREVIEW_CHARS),
    };

    // Only advance; never move someone backwards.
    if (!AT_OR_BEYOND_CONTACT.has(lead.status)) {
      patch.status = 'contacted';
      patch.stage_changed_at = new Date().toISOString();
      patch.stage_changed_by = 'auto:reply';
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(lead.id)}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const b = await res.text();
      console.warn(`[leadStage] patch failed (${res.status}): ${b.slice(0, 160)}`);
      return { updated: false, reason: `http_${res.status}` };
    }

    console.log(`[leadStage] reply recorded | lead=${lead.id} | stage=${patch.status || lead.status}`);
    return { updated: true, leadId: lead.id, stage: patch.status || lead.status };
  } catch (err) {
    console.warn('[leadStage] error:', err.message);
    return { updated: false, reason: 'error' };
  }
}

module.exports = { recordInboundOnLead, AT_OR_BEYOND_CONTACT };
