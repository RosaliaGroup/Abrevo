const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';

async function sendSMS(phone, message) {
  const response = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
  });
  return response.json();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { phone, new_date, new_time } = JSON.parse(event.body || '{}');

    if (!phone || !new_date || !new_time) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'phone, new_date, and new_time are required' }) };
    }

    // Normalize phone
    let normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedPhone.startsWith('+')) normalizedPhone = '+1' + normalizedPhone;

    // Find latest booking for this phone
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(normalizedPhone)}&order=created_at.desc&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const bookings = await findRes.json();

    if (!bookings || bookings.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, message: 'No existing booking found for this phone number.' }),
      };
    }

    const booking = bookings[0];

    // Update booking in Supabase
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          preferred_date: new_date,
          preferred_time: new_time,
        }),
      }
    );
    const updated = await updateRes.json();
    console.log('Updated booking:', JSON.stringify(updated));

    // Send SMS confirmation
    if (normalizedPhone) {
      const msg = `Your appointment has been rescheduled!\n\n📍 ${booking.type}\n📅 ${new_date} at ${new_time}\n\nQuestions? Call us at (201) 449-6850`;
      const smsResult = await sendSMS(normalizedPhone, msg);
      console.log('SMS result:', JSON.stringify(smsResult));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Appointment rescheduled to ${new_date} at ${new_time}`,
        booking: updated[0],
      }),
    };

  } catch (err) {
    console.error('Reschedule error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
