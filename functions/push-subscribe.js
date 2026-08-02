/**
 * functions/push-subscribe.js
 *
 * Register a browser for background push, or remove it.
 *
 *   POST   { endpoint, keys:{ p256dh, auth } }  → store
 *   DELETE ?endpoint=...                        → remove
 *
 * Behind the operator session: a push subscription is tied to this CRM, and an
 * open endpoint would let anyone register a device to receive lead activity.
 */

const { requireSession, requireCsrf } = require('./_lib/operatorGate');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function sb(extra) {
  return Object.assign(
    { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    extra || {}
  );
}

exports.handler = async (event) => {
  const session = requireSession(event);
  if (!session.ok) return json(session.status || 401, { ok: false, error: 'unauthorized' });
  if (!SUPABASE_KEY) return json(500, { ok: false, error: 'server_not_configured' });

  // GET ?endpoint=... — is THIS device actually registered? The UI asks before
  // claiming alerts work; previously it reported success from the POST's status
  // code alone, which said nothing about whether a row existed.
  if (event.httpMethod === 'GET') {
    const endpoint = (event.queryStringParameters || {}).endpoint || '';
    if (!endpoint) return json(400, { ok: false, error: 'endpoint_required' });
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&select=id&limit=1`,
      { headers: sb() }
    );
    const rows = await r.json();
    return json(200, { ok: true, registered: Array.isArray(rows) && rows.length > 0 });
  }

  if (event.httpMethod === 'DELETE') {
    const endpoint = (event.queryStringParameters || {}).endpoint || '';
    if (!endpoint) return json(400, { ok: false, error: 'endpoint_required' });
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: 'DELETE', headers: sb({ Prefer: 'return=minimal' }),
    });
    return json(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  if (!requireCsrf(event, session.token)) return json(403, { ok: false, error: 'csrf_failed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'invalid_json' }); }

  const endpoint = String(body.endpoint || '');
  const p256dh = String((body.keys && body.keys.p256dh) || '');
  const auth = String((body.keys && body.keys.auth) || '');
  if (!endpoint || !p256dh || !auth) return json(400, { ok: false, error: 'incomplete_subscription' });
  // Only real push services. An arbitrary URL here would turn the sender into a
  // request forwarder pointed wherever the caller likes.
  if (!/^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|windows\.com|apple\.com)\//i.test(endpoint)) {
    return json(400, { ok: false, error: 'unrecognised_push_service' });
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
    method: 'POST',
    // merge-duplicates: re-registering the same device updates it rather than
    // erroring on the unique endpoint.
    headers: sb({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({
      endpoint, p256dh, auth,
      user_agent: String(event.headers['user-agent'] || '').slice(0, 200),
      failures: 0,
    }),
  });
  if (!res.ok) {
    // Return the reason, not just "could_not_store". A generic failure message
    // meant three rounds of guessing at a database error the server already had
    // in front of it.
    const detail = await res.text().catch(() => '');
    console.error('[push-subscribe] store failed:', res.status, detail.slice(0, 300));
    return json(500, { ok: false, error: 'could_not_store', status: res.status, detail: detail.slice(0, 200) });
  }
  console.log('[push-subscribe] device registered');
  return json(200, { ok: true });
};
