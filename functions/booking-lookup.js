/**
 * functions/booking-lookup.js
 *
 * Return the booking behind a short code, so the reschedule form can pre-fill
 * itself instead of asking someone to retype their name, phone, email and
 * property — all of which we already know.
 *
 * PUBLIC BY NECESSITY, NARROW BY DESIGN
 * The person following this link is a lead, not an operator, so there's no
 * session to check. The protection is the code itself: 8 random hex characters
 * (4 bytes, ~4.3 billion combinations), unguessable in practice, and it only
 * ever reveals the one booking it belongs to.
 *
 * The response is deliberately minimal — the fields the form needs and nothing
 * else. No notes, no budget, no qualification answers, no ids.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const code = String((event.queryStringParameters || {}).code || '').trim();

  // Shape check before touching the database: the codes are hex, so anything
  // else is either a typo or someone probing.
  if (!/^[A-Fa-f0-9]{6,16}$/.test(code)) return json(400, { ok: false, error: 'bad_code' });
  if (!SUPABASE_KEY) return json(500, { ok: false, error: 'server_not_configured' });

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?short_code=ilike.${encodeURIComponent(code)}&select=full_name,phone,email,type,preferred_date,preferred_time&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await r.json();
    const b = Array.isArray(rows) ? rows[0] : null;
    if (!b) return json(404, { ok: false, error: 'not_found' });

    return json(200, {
      ok: true,
      booking: {
        full_name: b.full_name || '',
        phone: b.phone || '',
        email: b.email || '',
        property: b.type || '',
        current_date: b.preferred_date || '',
        current_time: b.preferred_time || '',
      },
    });
  } catch (err) {
    console.error('[booking-lookup] failed:', err.message);
    return json(500, { ok: false, error: 'lookup_failed' });
  }
};
