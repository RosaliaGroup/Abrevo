const { requireInternalToken, NO_CORS } = require('./_internal-auth');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  // Server-to-server only (Vapi/IVR caller lookup). Returns caller PII via the
  // privileged service-role key, so it MUST NOT be browser-callable. Not scheduled.
  const headers = NO_CORS;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  // INTERNAL token required (default-deny) BEFORE method checks, body parsing, or
  // any privileged Supabase query. Vapi must send X-Internal-Token (see rollout note).
  const gate = requireInternalToken(event);
  if (!gate.ok) return gate.response;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const { phone } = JSON.parse(event.body || '{}');

    if (!phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Phone required' }) };
    }

    // Normalize phone
    let normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedPhone.startsWith('+')) normalizedPhone = '+1' + normalizedPhone;

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(normalizedPhone)}&order=created_at.desc&limit=5`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const bookings = await response.json();
    console.log('Lookup result:', JSON.stringify(bookings));

    if (!bookings || bookings.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ found: false, message: 'No previous bookings found for this caller.' }),
      };
    }

    const latest = bookings[0];
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: true,
        caller_name: latest.full_name,
        email: latest.email,
        last_booking: {
          type: latest.type,
          date: latest.preferred_date,
          time: latest.preferred_time,
          property: latest.type,
          move_in_date: latest.move_in_date,
          budget: latest.budget,
        },
        all_bookings: bookings,
      }),
    };

  } catch (err) {
    console.error('Lookup error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
