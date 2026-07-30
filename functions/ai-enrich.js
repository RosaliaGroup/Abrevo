/**
 * functions/ai-enrich.js
 *
 * Finds a lead's social profiles and web presence with Claude + web search.
 *
 * CHANGE (Jul 29): the result is now PERSISTED to the lead record. Previously
 * this endpoint returned JSON that social.html cached in localStorage
 * (`abrevo_enrich_cache`), which meant enrichment lived in one operator's
 * browser: invisible to the rest of the team, unreadable by crm.html, and lost
 * whenever that cache cleared. Results now write to public.leads so the CRM can
 * show them on the lead's record.
 *
 * Accepts an optional `lead_id`. When absent, the lead is matched on the last 10
 * digits of the phone, then on email — the canonical matching order used by
 * findExistingLead() in respondrosalia.js.
 *
 * Env: ANTHROPIC_API_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL (optional).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CONFIDENCE = new Set(['low', 'medium', 'high']);

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

/** Resolve which lead this enrichment belongs to. Returns an id or null. */
async function resolveLeadId({ lead_id, email, phone }) {
  if (lead_id) return lead_id;
  if (!SUPABASE_KEY) return null;

  const digits = String(phone || '').replace(/\D/g, '');
  const last10 = digits.length >= 10 ? digits.slice(-10) : null;

  try {
    if (last10) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${last10}*&select=id&order=created_at.desc&limit=1`,
        { headers: sbHeaders() }
      );
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0].id;
    }
    if (email) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&select=id&order=created_at.desc&limit=1`,
        { headers: sbHeaders() }
      );
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0].id;
    }
  } catch (e) {
    console.warn('[ai-enrich] lead lookup failed:', e.message);
  }
  return null;
}

/** Write the enrichment onto the lead. Best-effort; never throws. */
async function saveEnrichment(leadId, result) {
  if (!leadId || !SUPABASE_KEY) return { saved: false, reason: 'no_target' };
  try {
    const mentions = Array.isArray(result.web_mentions) ? result.web_mentions : [];
    const confidence = CONFIDENCE.has(String(result.confidence || '').toLowerCase())
      ? String(result.confidence).toLowerCase()
      : 'low';

    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: sbHeaders(),
      body: JSON.stringify({
        linkedin_url: result.linkedin || null,
        facebook_url: result.facebook || null,
        instagram_url: result.instagram || null,
        web_mentions: mentions.length ? mentions : null,
        enrich_confidence: confidence,
        enriched_at: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[ai-enrich] save failed (${res.status}): ${body.slice(0, 200)}`);
      return { saved: false, reason: `http_${res.status}` };
    }
    return { saved: true };
  } catch (e) {
    console.warn('[ai-enrich] save error:', e.message);
    return { saved: false, reason: 'error' };
  }
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { name, email, phone, lead_id } = JSON.parse(event.body || '{}');
  if (!name) return { statusCode: 400, headers, body: JSON.stringify({ error: 'name required' }) };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for the social media profiles and web presence of this person. Name: "${name}", Email: "${email || 'unknown'}", Phone: "${phone || 'unknown'}". Find their LinkedIn URL, Facebook profile URL, Instagram handle, and any notable web mentions. Return as JSON with fields: linkedin, facebook, instagram, web_mentions (array of strings), confidence (low/medium/high).`
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('');

  let result;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    result = jsonMatch ? JSON.parse(jsonMatch[0]) : { linkedin: null, facebook: null, instagram: null, web_mentions: [], confidence: 'low' };
  } catch (e) {
    result = { linkedin: null, facebook: null, instagram: null, web_mentions: [text], confidence: 'low' };
  }

  // Persist so the whole team — and the CRM — can see it.
  const leadId = await resolveLeadId({ lead_id, email, phone });
  const save = await saveEnrichment(leadId, result);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ...result, lead_id: leadId, saved: save.saved }),
  };
};
