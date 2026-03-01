const { google } = require('googleapis');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';

const ANA_PHONE = '+16462269189';

const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';

async function sendSMS(phone, message) {
  const response = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
  });
  return response.json();
}

async function updateCalendarEvent(booking, new_date, new_time) {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  let startDateTime;
  try {
    startDateTime = new Date(`${new_date} ${new_time} GMT-0400`);
    if (isNaN(startDateTime.getTime())) {
      startDateTime = new Date(`${new_date} ${new_time}`);
    }
  } catch(e) {
    startDateTime = new Date();
    startDateTime.setDate(startDateTime.getDate() + 1);
    startDateTime.setHours(12, 0, 0, 0);
  }
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  // Search for existing event by summary and original date
  const eventsRes = await calendar.events.list({
    calendarId: CALENDAR_ID,
    q: booking.full_name,
    timeMin: new Date('2026-01-01').toISOString(),
    timeMax: new Date('2027-01-01').toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = eventsRes.data.items || [];
  const existingEvent = events.find(e => e.summary === booking.type);

  if (existingEvent) {
    // Update existing event
    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId: existingEvent.id,
      sendUpdates: 'all',
      resource: {
        start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
        end: { dateTime: endDateTime.toISOString(), timeZone: 'America/New_York' },
      },
    });
    console.log('Calendar event updated:', existingEvent.id);
  } else {
    // Create new event if original not found
    await calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: 'all',
      resource: {
        summary: booking.type,
        start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
        end: { dateTime: endDateTime.toISOString(), timeZone: 'America/New_York' },
        attendees: booking.email ? [{ email: booking.email }] : [],
      },
    });
    console.log('New calendar event created for reschedule');
  }
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

    let normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedPhone.startsWith('+')) normalizedPhone = '+1' + normalizedPhone;

    // Find latest booking
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
        body: JSON.stringify({ success: false, message: 'No existing booking found.' }),
      };
    }

    const booking = bookings[0];

    // Update Supabase
    await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ preferred_date: new_date, preferred_time: new_time }),
      }
    );
    console.log('Supabase updated');

    // Update Google Calendar
    try {
      await updateCalendarEvent(booking, new_date, new_time);
    } catch(err) {
      console.error('Calendar update error:', err.message);
    }

    // Text caller — reschedule confirmation
    const callerMsg = `Appointment rescheduled!\n\n📍 ${booking.type}\n📅 ${new_date} at ${new_time}\n\nQuestions? Call us at (201) 449-6850`;
    const callerResult = await sendSMS(normalizedPhone, callerMsg);
    console.log('Caller SMS:', JSON.stringify(callerResult));

    // Text Ana — reschedule notification
    const anaMsg = `Rescheduled Appointment!\n\nName: ${booking.full_name}\nPhone: ${normalizedPhone}\nProperty: ${booking.type}\nNew Date: ${new_date} at ${new_time}`;
    const anaResult = await sendSMS(ANA_PHONE, anaMsg);
    console.log('Ana SMS:', JSON.stringify(anaResult));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: `Rescheduled to ${new_date} at ${new_time}` }),
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
