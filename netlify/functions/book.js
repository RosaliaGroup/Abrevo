const { google } = require('googleapis');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';

async function saveToSupabase(data, calendarEventId) {
  let phone = String(data.phone || '').replace(/\D/g, '');
  if (phone.length === 10) phone = '+1' + phone;
  else if (phone.length === 11 && phone.startsWith('1')) phone = '+' + phone;
  else if (phone.length === 12 && phone.startsWith('11')) phone = '+1' + phone.slice(2);
  else if (!phone.startsWith('+')) phone = '+' + phone;

  const row = {
    full_name: data.full_name || null,
    phone,
    email: data.email || null,
    type: data.property_address || 'Iron 65, Newark NJ',
    preferred_date: data.preferred_date || null,
    preferred_time: data.preferred_time || null,
    budget: data.budget || null,
    apartment_size: data.apartment_size || null,
    move_in_date: data.move_in_date || null,
    income_qualifies: data.income_qualifies || null,
    credit_qualifies: data.credit_qualifies || null,
    additional_notes: data.additional_notes || null,
    client: data.client || 'rosalia',
    calendar_event_id: calendarEventId || null,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const result = await res.json();
  console.log('Supabase save:', JSON.stringify(result));
  return result;
}


// Client configurations
const CLIENTS = {
  rosalia: {
    calendarId: '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com',
    notifyPhone: '+16462269189',
    notifyName: 'Ana',
    teamName: 'Rosalia Group',
    googleCredentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  }
};

const TEXTBELT_KEY = '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';

async function sendSMS(phone, message) {
  const response = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      message,
      key: TEXTBELT_KEY,
    }),
  });
  return response.json();
}

async function createCalendarEvent(client, data) {
  const auth = new google.auth.GoogleAuth({
    credentials: client.googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  // Parse date and time â€” handle various formats from Alex
  let startDateTime;
  try {
    // Try direct parse first
    startDateTime = new Date(`${data.preferred_date} ${data.preferred_time}`);
    if (isNaN(startDateTime.getTime())) {
      // Try with EST timezone hint
      startDateTime = new Date(`${data.preferred_date} ${data.preferred_time} EST`);
    }
    if (isNaN(startDateTime.getTime())) {
      // Fallback: use tomorrow at noon
      startDateTime = new Date();
      startDateTime.setDate(startDateTime.getDate() + 1);
      startDateTime.setHours(12, 0, 0, 0);
    }
  } catch(e) {
    startDateTime = new Date();
    startDateTime.setDate(startDateTime.getDate() + 1);
    startDateTime.setHours(12, 0, 0, 0);
  }
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000); // 30 min

  const description = `
Phone: ${data.phone || 'N/A'}
Email: ${data.email || 'N/A'}
Budget: ${data.budget || 'N/A'}
Apartment Size: ${data.apartment_size || 'N/A'}
Preferred Area: ${data.preferred_area || 'N/A'}
Move-In Date: ${data.move_in_date || 'N/A'}
Income Qualifies: ${data.income_qualifies || 'N/A'}
Credit Qualifies: ${data.credit_qualifies || 'N/A'}

Notes:
${data.additional_notes || 'N/A'}
  `.trim();

  const event = await calendar.events.insert({
    calendarId: client.calendarId,
    resource: {
      summary: data.type || 'Appointment',
      description,
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/New_York' },
    },
  });

  return event.data;
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
    const clientId = event.queryStringParameters?.client || 'rosalia';
    const client = CLIENTS[clientId];

    if (!client) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown client' }) };
    }

    const data = JSON.parse(event.body || '{}');

    // 1. Create Google Calendar event
    let calendarEvent = null;
    try {
      calendarEvent = await createCalendarEvent(client, data);
    } catch (err) {
      console.error('Calendar error:', err.message);
    }

    // 2. Text the caller confirmation

    // Save to Supabase so reschedule can find it
    try {
      await saveToSupabase(data, calendarEvent?.id);
    } catch (err) {
      console.error('Supabase error:', err.message);
    }

    if (data.phone) {
      const callerMsg = `Your appointment is confirmed!\n\n${data.type || 'Appointment'}\n${data.preferred_date} at ${data.preferred_time}\n\n${client.teamName} will be in touch to coordinate. See you then!`;
      await sendSMS(data.phone, callerMsg);
    }

    // 3. Text Ana/team with full details
    const teamMsg = `New Booking!\n\nName: ${data.full_name}\nPhone: ${data.phone}\nEmail: ${data.email}\nProperty: ${data.type}\nDate: ${data.preferred_date} at ${data.preferred_time}\nBudget: ${data.budget}\nArea: ${data.preferred_area}\nMove-In: ${data.move_in_date}\nIncome: ${data.income_qualifies}\nCredit: ${data.credit_qualifies}\n\nNotes: ${data.additional_notes}`;
    await sendSMS(client.notifyPhone, teamMsg);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, eventId: calendarEvent?.id }),
    };

  } catch (err) {
    console.error('Booking error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

