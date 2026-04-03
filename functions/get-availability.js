const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Iron 65 time slots (hourly, matching booking form)
const ALL_SLOTS = ['10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM'];

// Check if a property string refers to Iron 65
function isIron65(type) {
  if (!type) return false;
  const t = type.toLowerCase();
  return t.includes('iron 65') || t.includes('mcwhorter') || t.includes('65 mcwhorter');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    // Fetch all bookings with type info so we can filter to Iron 65 only
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?select=preferred_date,preferred_time,type&order=preferred_date.asc`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const bookings = await res.json();

    // Build map of booked Iron 65 slots: { "April 3, 2026": ["10:00 AM", "2:00 PM"] }
    const bookedByDate = {};
    for (const b of bookings) {
      if (!b.preferred_date || !b.preferred_time) continue;
      if (!isIron65(b.type)) continue;
      if (!bookedByDate[b.preferred_date]) bookedByDate[b.preferred_date] = [];
      bookedByDate[b.preferred_date].push(b.preferred_time);
    }

    // Dates where all 8 Iron 65 slots are taken
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
