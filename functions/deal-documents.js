/**
 * functions/deal-documents.js
 *
 * Documents attached to a deal — upload, list, download, acknowledge.
 *
 *   POST   ?deal=<id>&kind=<kind>   multipart-ish raw body → store a file
 *   GET    ?deal=<id>               → list, with short-lived signed URLs
 *   POST   ?action=ack              → record a disclosure acknowledgement
 *   DELETE ?id=<doc>                → remove (blocked once the deal is locked)
 *
 * STORAGE
 * Files go to the PRIVATE `deal-documents` bucket. Nothing is ever served from
 * a public URL — reads are 5-minute signed links generated per request, so a
 * link that leaks is useless within the hour and a bucket listing reveals
 * nothing.
 *
 * THE LOCK
 * Once `deals.submitted_at` is set, documents cannot be added or removed. That
 * is the point of submitting: the paperwork on file is the paperwork that was
 * there when the deal closed.
 */

const { requireSession, requireCsrf } = require('./_lib/operatorGate');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'deal-documents';

const KINDS = new Set([
  'disclosure', 'listing_agreement', 'sale_agreement', 'referral_agreement',
  'lease', 'application', 'id', 'other',
]);

// What must be on file before a deal of this shape can be submitted.
const REQUIRED = {
  rental: {
    landlord: ['listing_agreement', 'disclosure', 'lease'],
    tenant: ['disclosure', 'application', 'lease'],
  },
  sale: {
    seller: ['listing_agreement', 'sale_agreement', 'disclosure'],
    buyer: ['sale_agreement', 'disclosure'],
  },
  referral: {
    referral_partner: ['referral_agreement'],
  },
};

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function H(extra) {
  return Object.assign(
    { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    extra || {}
  );
}

async function sb(path, opts) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, Object.assign({ headers: H({ 'Content-Type': 'application/json' }) }, opts || {}));
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.status === 204 ? null : r.json();
}

/** A locked deal's paperwork is frozen — that is what submitting means. */
async function isLocked(dealId) {
  const rows = await sb(`deals?id=eq.${encodeURIComponent(dealId)}&select=submitted_at&limit=1`);
  return Array.isArray(rows) && rows[0] && rows[0].submitted_at;
}

exports.handler = async (event) => {
  const session = requireSession(event);
  if (!session.ok) return json(session.status || 401, { ok: false, error: 'unauthorized' });
  if (!SUPABASE_KEY) return json(500, { ok: false, error: 'server_not_configured' });

  const qs = event.queryStringParameters || {};
  const dealId = String(qs.deal || '').trim();

  try {
    // ---- list ----
    if (event.httpMethod === 'GET') {
      if (!dealId) return json(400, { ok: false, error: 'deal_required' });
      const docs = await sb(`deal_documents?deal_id=eq.${encodeURIComponent(dealId)}&select=*&order=created_at.asc`);

      // Sign each stored file for 5 minutes. Long-lived links end up pasted into
      // emails and chat, and outlive the reason they were created.
      for (const d of docs || []) {
        if (!d.storage_path) continue;
        try {
          const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${d.storage_path}`, {
            method: 'POST', headers: H({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ expiresIn: 300 }),
          });
          const j = await r.json();
          d.url = j.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
        } catch (e) { d.url = null; }
      }

      const deal = await sb(`deals?id=eq.${encodeURIComponent(dealId)}&select=deal_type,client_role,submitted_at&limit=1`);
      const d0 = Array.isArray(deal) && deal[0] ? deal[0] : {};
      const required = (REQUIRED[d0.deal_type] && REQUIRED[d0.deal_type][d0.client_role]) || [];
      const have = new Set((docs || []).filter((x) => x.storage_path || x.acknowledged).map((x) => x.kind));
      return json(200, {
        ok: true,
        data: docs || [],
        required,
        missing: required.filter((k) => !have.has(k)),
        locked: Boolean(d0.submitted_at),
      });
    }

    if (event.httpMethod === 'DELETE') {
      if (!requireCsrf(event, session.token)) return json(403, { ok: false, error: 'csrf_failed' });
      const id = String(qs.id || '').trim();
      if (!id) return json(400, { ok: false, error: 'id_required' });
      const rows = await sb(`deal_documents?id=eq.${encodeURIComponent(id)}&select=deal_id,storage_path&limit=1`);
      const doc = Array.isArray(rows) ? rows[0] : null;
      if (!doc) return json(404, { ok: false, error: 'not_found' });
      if (await isLocked(doc.deal_id)) return json(403, { ok: false, error: 'deal_locked' });

      if (doc.storage_path) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${doc.storage_path}`, { method: 'DELETE', headers: H() });
      }
      await sb(`deal_documents?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: H({ Prefer: 'return=minimal' }) });
      return json(200, { ok: true });
    }

    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
    if (!requireCsrf(event, session.token)) return json(403, { ok: false, error: 'csrf_failed' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return json(400, { ok: false, error: 'invalid_json' }); }

    // ---- acknowledge (no file) ----
    if (qs.action === 'ack') {
      const id = String(body.dealId || '').trim();
      if (!id || !KINDS.has(body.kind)) return json(400, { ok: false, error: 'bad_request' });
      if (await isLocked(id)) return json(403, { ok: false, error: 'deal_locked' });
      await sb('deal_documents', {
        method: 'POST',
        headers: H({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({
          deal_id: id, kind: body.kind, label: body.label || null,
          acknowledged: true, acknowledged_by: session.user || 'operator',
          acknowledged_at: new Date().toISOString(),
        }),
      });
      return json(200, { ok: true });
    }

    // ---- upload ----
    // The browser sends base64 rather than multipart: Netlify functions receive
    // the body as a string, and reimplementing multipart parsing to save ~33%
    // of bandwidth on a 25MB cap is not a good trade.
    const id = String(body.dealId || '').trim();
    if (!id || !KINDS.has(body.kind)) return json(400, { ok: false, error: 'bad_request' });
    if (await isLocked(id)) return json(403, { ok: false, error: 'deal_locked' });
    if (!body.data || !body.fileName) return json(400, { ok: false, error: 'file_required' });

    const buf = Buffer.from(String(body.data).split(',').pop(), 'base64');
    if (buf.length > 25 * 1024 * 1024) return json(400, { ok: false, error: 'file_too_large' });

    // Path includes the deal id so a listing can never mix deals, and a random
    // suffix so two files with the same name don't collide.
    const safe = String(body.fileName).replace(/[^\w.\-]/g, '_').slice(-80);
    const path = `${id}/${body.kind}-${Date.now()}-${safe}`;

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: H({ 'Content-Type': body.contentType || 'application/octet-stream' }),
      body: buf,
    });
    if (!up.ok) {
      const t = await up.text().catch(() => '');
      console.error('[deal-documents] upload failed:', up.status, t.slice(0, 160));
      return json(500, { ok: false, error: 'upload_failed', detail: t.slice(0, 120) });
    }

    await sb('deal_documents', {
      method: 'POST',
      headers: H({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({
        deal_id: id, kind: body.kind, label: body.label || null,
        storage_path: path, file_name: body.fileName, file_size: buf.length,
        uploaded_by: session.user || 'operator',
      }),
    });
    console.log(`[deal-documents] stored ${body.kind} for deal ${id} (${buf.length} bytes)`);
    return json(200, { ok: true });
  } catch (err) {
    console.error('[deal-documents] failed:', err.message);
    return json(500, { ok: false, error: 'failed', detail: err.message });
  }
};

module.exports.REQUIRED = REQUIRED;
