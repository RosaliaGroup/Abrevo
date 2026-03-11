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
