const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    console.log('RAW body received:', JSON.stringify(body));

    const rawPhone = body.phone || body.customer_number || body.callerNumber || '';
    console.log('Raw phone received:', rawPhone);

    if (!rawPhone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Phone required', received: body }) };
    }

    // Try multiple normalizations
    const digits = rawPhone.replace(/\D/g, '');
    const withPlus1 = '+1' + digits.slice(-10);
    const withPlus = '+' + digits;

    console.log('Trying phones:', withPlus1, withPlus);

    // Try +1XXXXXXXXXX format first
    let response = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(withPlus1)}&order=created_at.desc&limit=5`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    let bookings = await response.json();
    console.log('Lookup result with', withPlus1, ':', JSON.stringify(bookings));

    // If nothing found try +XXXXXXXXXX
    if (!bookings || bookings.length === 0) {
      response = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(withPlus)}&order=created_at.desc&limit=5`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      bookings = await response.json();
      console.log('Lookup result with', withPlus, ':', JSON.stringify(bookings));
    }

    if (!bookings || bookings.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ found: false, message: 'No previous bookings found.', searched: [withPlus1, withPlus] }),
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
          budget: latest.budget,
          apartment_size: latest.apartment_size,
          move_in_date: latest.move_in_date,
          income_qualifies: latest.income_qualifies,
          credit_qualifies: latest.credit_qualifies,
        },
        all_bookings: bookings,
      }),
    };

  } catch (err) {
    console.error('Lookup error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
