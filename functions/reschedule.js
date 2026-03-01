const { google } = require('googleapis');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';
const ANA_PHONE = '+16462269189';

async function sendSMS(phone, message) {
  const response = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
  });
  return response.json();
}

async function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

async function deleteCalendarEvent(eventId) {
  try {
    const calendar = await getCalendarClient();
    await calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId,
    });
    console.log('Deleted calendar event:', eventId);
  } catch (err) {
    console.error('Delete calendar event error:', err.message);
  }
}

async function createCalendarEvent(booking, new_date, new_time) {
  const calendar = await getCalendarClient();

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

  const description = [
    'RESCHEDULED APPOINTMENT',
    '',
    'Phone: ' + (booking.phone || 'N/A'),
    'Email: ' + (booking.email || 'N/A'),
    'Budget: ' + (booking.budget || 'N/A'),
    'Apartment Size: ' + (booking.apartment_size || 'N/A'),
    'Preferred Area: ' + (booking.preferred_area || 'N/A'),
    'Move-In Date: ' + (booking.move_in_date || 'N/A'),
    'Income Qualifies: ' + (booking.income_qualifies || 'N/A'),
    'Credit Qualifies: ' + (booking.credit_qualifies || 'N/A'),
    '',
    'Notes:',
    (booking.additional_notes || 'N/A'),
  ].join('\n');

  const event = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: {
      summary: booking.type || 'Appointment',
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
    const { phone, new_date, new_time } = JSON.parse(event.body || '{}');

    if (!phone || !new_date || !new_time) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'phone, new_date, and new_time are required' }) };
    }

    let normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedPhone.startsWith('+')) normalizedPhone = '+1' + normalizedPhone;

    // Find latest booking
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(normalizedPhone)}&order=created_at.desc&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const bookings = await findRes.json();

    if (!bookings || bookings.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, message: 'No existing booking found.' }) };
    }

    const booking = bookings[0];

    // 1. Delete original calendar event if it exists
    if (booking.calendar_event_id) {
      await deleteCalendarEvent(booking.calendar_event_id);
    }

    // 2. Create new calendar event with full caller info
    let newCalendarEvent = null;
    try {
      newCalendarEvent = await createCalendarEvent(booking, new_date, new_time);
      console.log('New calendar event created:', newCalendarEvent.id);
    } catch (err) {
      console.error('Calendar create error:', err.message);
    }

    // 3. Update Supabase with new date, time, and new calendar event ID
    await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          preferred_date: new_date,
          preferred_time: new_time,
          calendar_event_id: newCalendarEvent?.id || null,
        }),
      }
    );

    // 4. Text caller — rescheduled confirmation
    const callerMsg = `Appointment rescheduled!\n\n📍 ${booking.type}\n📅 ${new_date} at ${new_time}\n\nQuestions? Call us at (862) 333-1681`;
    const callerResult = await sendSMS(normalizedPhone, callerMsg);
    console.log('Caller SMS:', JSON.stringify(callerResult));

    // 5. Text Ana — rescheduled notification
    const teamMsg = `Rescheduled!\n\nName: ${booking.full_name}\nPhone: ${normalizedPhone}\nProperty: ${booking.type}\nNew Date: ${new_date} at ${new_time}\nBudget: ${booking.budget || 'N/A'}\nSize: ${booking.apartment_size || 'N/A'}\nMove-In: ${booking.move_in_date || 'N/A'}`;
    const teamResult = await sendSMS(ANA_PHONE, teamMsg);
    console.log('Team SMS:', JSON.stringify(teamResult));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: `Rescheduled to ${new_date} at ${new_time}` }),
    };

  } catch (err) {
    console.error('Reschedule error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
