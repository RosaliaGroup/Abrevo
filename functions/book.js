const { google } = require('googleapis');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';

const CLIENTS = {
  rosalia: {
    calendarId: '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com',
    notifyPhone: '+16462269189',
    googleCredentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  }
};

async function sendSMS(phone, message) {
  const res = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
  });
  return res.json();
}

async function saveToSupabase(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function createCalendarEvent(client, data) {
  const auth = new google.auth.GoogleAuth({
    credentials: client.googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const calendar = google.calendar({ version: 'v3', auth });

  let startDateTime;
  try {
    startDateTime = new Date(`${data.preferred_date} ${data.preferred_time} GMT-0400`);
    if (isNaN(startDateTime.getTime())) {
      startDateTime = new Date(`${data.preferred_date} ${data.preferred_time}`);
    }
    if (isNaN(startDateTime.getTime())) {
      startDateTime = new Date();
      startDateTime.setDate(startDateTime.getDate() + 1);
      startDateTime.setHours(12, 0, 0, 0);
    }
  } catch(e) {
    startDateTime = new Date();
    startDateTime.setDate(startDateTime.getDate() + 1);
    startDateTime.setHours(12, 0, 0, 0);
  }

  console.log('Date parsed:', startDateTime.toISOString());
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  const description = [
    'Phone: ' + (data.phone || 'N/A'),
    'Email: ' + (data.email || 'N/A'),
    'Budget: ' + (data.budget || 'N/A'),
    'Apartment Size: ' + (data.apartment_size || 'N/A'),
    'Preferred Area: ' + (data.preferred_area || 'N/A'),
    'Move-In Date: ' + (data.move_in_date || 'N/A'),
    'Income: ' + (data.income_qualifies || 'N/A'),
    'Credit: ' + (data.credit_qualifies || 'N/A'),
    '',
    'Notes: ' + (data.additional_notes || 'N/A'),
  ].join('\n');

  const event = await calendar.events.insert({
    calendarId: client.calendarId,
    resource: {
      summary: `${data.full_name || 'Guest'} — ${data.type || 'Appointment'}`,
      description,
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/New_York' },
    },
  });

  return event.data;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const clientId = event.queryStringParameters?.client || 'rosalia';
    const client = CLIENTS[clientId];
    if (!client) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown client' }) };

    const data = JSON.parse(event.body || '{}');
    console.log('Incoming booking data:', JSON.stringify(data));

    const name = data.full_name || 'Guest';
    let phone = (data.phone || '').toString().replace(/\D/g, '');
    if (phone && !phone.startsWith('+')) phone = '+1' + phone;
    const email = data.email || '';
    const type = data.type || 'Appointment';
    const date = data.preferred_date || '';
    const time = data.preferred_time || '';
    const income = data.income_qualifies || 'N/A';
    const credit = data.credit_qualifies || 'N/A';

    // 1. Create Google Calendar event
    let calendarEvent = null;
    try {
      calendarEvent = await createCalendarEvent(client, { ...data, phone, email });
      console.log('Calendar event created:', calendarEvent.id);
    } catch (err) {
      console.error('Calendar error:', err.message);
    }

    // 2. Save to Supabase
    try {
      const saved = await saveToSupabase({
        full_name: name, phone, email, type,
        preferred_date: date, preferred_time: time,
        budget: data.budget || null,
        apartment_size: data.apartment_size || null,
        preferred_area: data.preferred_area || null,
        move_in_date: data.move_in_date || null,
        income_qualifies: income !== 'N/A' ? income : null,
        credit_qualifies: credit !== 'N/A' ? credit : null,
        additional_notes: data.additional_notes || null,
        client: clientId,
        calendar_event_id: calendarEvent?.id || null,
      });
      console.log('Supabase saved:', JSON.stringify(saved));
    } catch (err) {
      console.error('Supabase error:', err.message);
    }

    // 3. Text caller
    if (phone) {
      const callerMsg = `Appointment confirmed!\n\n📍 ${type}\n📅 ${date} at ${time}\n\nQuestions? Call (862) 333-1681`;
      const r = await sendSMS(phone, callerMsg);
      console.log('Caller SMS:', JSON.stringify(r));
    }

    // 4. Text Ana
    const teamMsg = `New Booking!\n\nName: ${name}\nPhone: ${phone}\nEmail: ${email}\nProperty: ${type}\nDate: ${date} at ${time}\nBudget: ${data.budget || 'N/A'}\nSize: ${data.apartment_size || 'N/A'}\nMove-In: ${data.move_in_date || 'N/A'}\nIncome: ${income}\nCredit: ${credit}`;
    const r2 = await sendSMS(client.notifyPhone, teamMsg);
    console.log('Team SMS:', JSON.stringify(r2));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, eventId: calendarEvent?.id }) };

  } catch (err) {
    console.error('Booking error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
