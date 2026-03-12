const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';
const ANA_PHONE = '+2014970225';
const NOTIFY_EMAIL = 'inquiries@rosaliagroup.com';

// Email transporter using Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

async function sendEmail(to, subject, html) {
  try {
    const info = await transporter.sendMail({
      from: `"Rosalia Group Bookings" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log('Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('Email error:', err.message);
    return { success: false, error: err.message };
  }
}

async function sendSMS(phone, message) {
  const res = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
  });
  return res.json();
}

async function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

async function deleteEventById(calendar, eventId) {
  try {
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
    console.log('Deleted event by ID:', eventId);
  } catch (err) {
    console.error('Delete by ID error:', err.message);
  }
}

async function deleteEventsByName(calendar, name) {
  try {
    const now = new Date();
    const future = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      q: name,
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
    });
    const events = res.data.items || [];
    console.log(`Found ${events.length} events matching name: ${name}`);
    for (const ev of events) {
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: ev.id });
      console.log('Deleted event:', ev.id, ev.summary);
    }
  } catch (err) {
    console.error('Delete by name error:', err.message);
  }
}

async function createCalendarEvent(calendar, booking, new_date, new_time) {
  let startDateTime;
  try {
    startDateTime = new Date(`${new_date} ${new_time} GMT-0400`);
    if (isNaN(startDateTime.getTime())) startDateTime = new Date(`${new_date} ${new_time}`);
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
    'Move-In Date: ' + (booking.move_in_date || 'N/A'),
    'Income: ' + (booking.income_qualifies || 'N/A'),
    'Credit: ' + (booking.credit_qualifies || 'N/A'),
  ].join('\n');

  const event = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: {
      summary: `${booking.full_name || 'Guest'} — ${booking.type || 'Appointment'}`,
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
    const { phone, new_date, new_time } = JSON.parse(event.body || '{}');
    if (!phone || !new_date || !new_time) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'phone, new_date, new_time required' }) };
    }

    let normalizedPhone = phone.toString().replace(/\D/g, '');
    if (!normalizedPhone.startsWith('+')) normalizedPhone = '+1' + normalizedPhone;
    console.log('Reschedule for phone:', normalizedPhone);

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
    console.log('Found booking:', booking.id, 'calendar_event_id:', booking.calendar_event_id);

    const calendar = await getCalendarClient();

    // Delete old calendar event(s)
    if (booking.calendar_event_id) {
      await deleteEventById(calendar, booking.calendar_event_id);
    }
    if (booking.full_name) {
      await deleteEventsByName(calendar, booking.full_name);
    }

    // Create new calendar event
    let newEvent = null;
    try {
      newEvent = await createCalendarEvent(calendar, booking, new_date, new_time);
      console.log('New calendar event created:', newEvent.id);
    } catch (err) {
      console.error('Create calendar error:', err.message);
    }

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
        body: JSON.stringify({
          preferred_date: new_date,
          preferred_time: new_time,
          calendar_event_id: newEvent?.id || null,
        }),
      }
    );

    // Text caller
    const callerMsg = `Appointment rescheduled!\n\n📍 ${booking.type}\n📅 ${new_date} at ${new_time}\n\nQuestions? Call (862) 333-1681`;
    const r1 = await sendSMS(normalizedPhone, callerMsg);
    console.log('Caller SMS:', JSON.stringify(r1));

    // Text Ana
    const teamMsg = `Rescheduled!\n\nName: ${booking.full_name}\nPhone: ${normalizedPhone}\nProperty: ${booking.type}\nNew Date: ${new_date} at ${new_time}\nBudget: ${booking.budget || 'N/A'}\nSize: ${booking.apartment_size || 'N/A'}\nMove-In: ${booking.move_in_date || 'N/A'}\nIncome: ${booking.income_qualifies || 'N/A'}\nCredit: ${booking.credit_qualifies || 'N/A'}`;
    const r2 = await sendSMS(ANA_PHONE, teamMsg);
    console.log('Team SMS:', JSON.stringify(r2));

    // Email to team (backup)
    const emailSubject = `🔄 Appointment Rescheduled - ${booking.full_name}`;
    const emailBody = `
      <h2>Appointment Rescheduled</h2>
      <table style="border-collapse: collapse; width: 100%;">
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Name:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.full_name}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Phone:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${normalizedPhone}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Email:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.email || 'N/A'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Property:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.type}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>New Date & Time:</strong></td><td style="padding: 8px; border: 1px solid #ddd; background-color: #fff3cd;">${new_date} at ${new_time}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Budget:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.budget || 'N/A'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Apartment Size:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.apartment_size || 'N/A'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Move-In Date:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.move_in_date || 'N/A'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Income Qualifies:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.income_qualifies || 'N/A'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Credit Qualifies:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.credit_qualifies || 'N/A'}</td></tr>
      </table>
      <p><em>New calendar event ID: ${newEvent?.id || 'N/A'}</em></p>
    `;
    
    const emailResult = await sendEmail(NOTIFY_EMAIL, emailSubject, emailBody);
    console.log('Team email:', JSON.stringify(emailResult));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: `Rescheduled to ${new_date} at ${new_time}` }) };

  } catch (err) {
    console.error('Reschedule error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
