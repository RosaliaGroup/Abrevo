const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';

// All possible time slots
const ALL_SLOTS = ['10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM'];

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    // Fetch all future bookings
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?select=preferred_date,preferred_time&order=preferred_date.asc`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const bookings = await res.json();

    // Build map: { "March 22, 2026": ["2:00 PM", "3:00 PM"] }
    const bookedByDate = {};
    for (const b of bookings) {
      if (!b.preferred_date || !b.preferred_time) continue;
      if (!bookedByDate[b.preferred_date]) bookedByDate[b.preferred_date] = [];
      bookedByDate[b.preferred_date].push(b.preferred_time);
    }

    // Build fully booked dates (all 8 slots taken)
    const fullyBookedDates = [];
    for (const [date, slots] of Object.entries(bookedByDate)) {
      if (ALL_SLOTS.every(s => slots.includes(s))) {
        fullyBookedDates.push(date);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ bookedByDate, fullyBookedDates }),
    };
  } catch (err) {
    console.error('Availability error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
