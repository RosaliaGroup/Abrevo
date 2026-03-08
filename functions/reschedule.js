const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';

// Load Google credentials from environment variable
const CREDENTIALS = JSON.parse(process.env.GOOGLE_CALENDAR_CREDENTIALS || '{}');

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
    const { phone, new_date, new_time, property } = body;

    const client = event.queryStringParameters?.client || 'rosalia';
    const notifyPhone = '+16462269189'; // Ana's phone

    console.log('📞 Reschedule request:', { phone, new_date, new_time, property, client });

    if (!phone || !new_date || !new_time) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: phone, new_date, new_time' }),
      };
    }

    // Normalize phone number
    let normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+1' + normalizedPhone;
    }

    // Find existing booking(s) for this phone number
    let supabaseQuery = `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(normalizedPhone)}&order=created_at.desc`;
    
    // If property is specified, only get bookings for that property
    if (property) {
      supabaseQuery += `&type=eq.${encodeURIComponent(property)}`;
    }

    const findResponse = await fetch(supabaseQuery, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    const existingBookings = await findResponse.json();
    console.log('🔍 Found bookings:', existingBookings.length);

    if (!existingBookings || existingBookings.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'No booking found for this phone number' + (property ? ` and property: ${property}` : '') }),
      };
    }

    // Use the most recent booking
    const booking = existingBookings[0];
    const {
      id: bookingId,
      full_name,
      email,
      type,
      budget,
      apartment_size,
      move_in_date,
      income_qualifies,
      credit_qualifies,
      calendar_event_id,
    } = booking;

    console.log('📝 Rescheduling booking:', bookingId, 'for', full_name);

    // Get ALL bookings for this phone to check for other appointments
    const allBookingsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(normalizedPhone)}&order=created_at.desc`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const allBookings = await allBookingsResponse.json();

    // Find OTHER properties (excluding current one being rescheduled)
    const otherProperties = allBookings
      .filter(b => b.id !== bookingId && b.type !== type)
      .map(b => b.type)
      .filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates

    const additional_notes = otherProperties.length > 0
      ? `Caller also has appointments at: ${otherProperties.join(', ')}`
      : null;

    // Update Google Calendar event
    const auth = new google.auth.GoogleAuth({
      credentials: CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    const calendar = google.calendar({ version: 'v3', auth });

    const eventStartTime = new Date(`${new_date} ${new_time}`);
    const eventEndTime = new Date(eventStartTime.getTime() + 30 * 60000); // 30 min

    const updatedEvent = {
      summary: `${full_name} — ${type}`,
      description: `RESCHEDULED APPOINTMENT\n\nPhone: ${normalizedPhone}\nEmail: ${email}\nBudget: ${budget}\nApartment Size: ${apartment_size}\nMove-In Date: ${move_in_date}\nIncome: ${income_qualifies}\nCredit: ${credit_qualifies}${additional_notes ? `\n\nNotes: ${additional_notes}` : ''}`,
      start: { dateTime: eventStartTime.toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: eventEndTime.toISOString(), timeZone: 'America/New_York' },
      attendees: [{ email }],
    };

    if (calendar_event_id) {
      await calendar.events.update({
        calendarId: CALENDAR_ID,
        eventId: calendar_event_id,
        resource: updatedEvent,
        sendUpdates: 'all',
      });
      console.log('📅 Calendar event updated:', calendar_event_id);
    }

    // Update in Supabase (only update this specific booking by ID)
    const updateResponse = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        preferred_date: new_date,
        preferred_time: new_time,
        additional_notes,
      }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('❌ Supabase update error:', errorText);
      throw new Error(`Supabase error: ${errorText}`);
    }

    console.log('💾 Updated in Supabase');

    // Send SMS confirmation to caller
    const callerSmsBody = `Hi ${full_name}! Your showing at ${type} has been rescheduled to ${new_date} at ${new_time}. Ana will contact you 1 day before. Questions? Call (201) 449-6850. - Rosalia Group`;
    
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: normalizedPhone,
        message: callerSmsBody,
        key: TEXTBELT_KEY,
      }),
    });

    console.log('📱 SMS sent to caller:', normalizedPhone);

    // Send SMS notification to Ana
    const anaSmsBody = `Rescheduled!\n${full_name}\n${type}\nNEW: ${new_date} at ${new_time}\nPhone: ${normalizedPhone}\nBudget: ${budget}\nIncome: ${income_qualifies}\nCredit: ${credit_qualifies}${additional_notes ? `\nNotes: ${additional_notes}` : ''}`;
    
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: notifyPhone,
        message: anaSmsBody,
        key: TEXTBELT_KEY,
      }),
    });

    console.log('📱 SMS notification sent to Ana:', notifyPhone);

    // Send email notification to inquiries@rosaliagroup.com
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: 'inquiries@rosaliagroup.com',
      subject: 'Appointment Rescheduled',
      text: `
Appointment Rescheduled

Name: ${full_name}
Phone: ${normalizedPhone}
Email: ${email}
Property: ${type}
NEW Date & Time: ${new_date} at ${new_time}
Budget: ${budget}
Apartment Size: ${apartment_size}
Move-In Date: ${move_in_date}
Income Qualifies: ${income_qualifies}
Credit Qualifies: ${credit_qualifies}${additional_notes ? `\n\nNotes: ${additional_notes}` : ''}
      `.trim(),
    };

    await transporter.sendMail(mailOptions);
    console.log('📧 Email sent to inquiries@rosaliagroup.com');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Appointment rescheduled successfully',
        new_date,
        new_time,
      }),
    };

  } catch (error) {
    console.error('❌ Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
```

**Key changes:**

1. ✅ **Property-specific reschedule**: Added `property` parameter - only reschedules appointments for that specific property
2. ✅ **Query filter**: If property is provided, filters Supabase query by both phone AND property
3. ✅ **Uses booking ID**: Updates only the specific booking by ID (line 126) instead of all bookings with that phone number
4. ✅ **Gets all bookings**: Fetches ALL appointments for that phone to find other properties
5. ✅ **Creates notes**: Adds notes about other appointments to calendar description, email, and SMS
6. ✅ **Saves notes**: Updates `additional_notes` in Supabase

**Also need to update the Vapi `rescheduleAppointment` tool:**

Add the `property` parameter to the tool in Vapi dashboard:
- Go to your reschedule tool
- Add field: `property` (string, optional)

**Update Alex's prompt to pass property when rescheduling:**

In the RESCHEDULE FLOW, change Step 8 to:
```
Step 8 — If confirmed, call rescheduleAppointment with: 
- phone
- new_date (format: April 7 2026)
- new_time (format: 4:00 PM)
- property (the property name they said in Step 2)
