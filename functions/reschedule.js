const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// Configuration
const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';
const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';
const ANA_PHONE = '+12014970225';

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// Helper: Send SMS
async function sendSMS(phone, message) {
  try {
    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
    });
    const result = await response.json();
    console.log('SMS sent to', phone, ':', result.success ? 'SUCCESS' : 'FAILED');
    return result;
  } catch (err) {
    console.error('SMS error:', err.message);
    return { success: false, error: err.message };
  }
}

// Helper: Get calendar client
async function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

// Helper: Find and delete calendar events for specific property
async function deletePropertyEvents(calendar, callerName, propertyAddress) {
  try {
    const now = new Date();
    const future = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days ahead

    // Search for events matching caller name
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      q: callerName,
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
    });

    const events = res.data.items || [];
    console.log(`Found ${events.length} total events for ${callerName}`);

    // Filter events that match the specific property
    let deletedCount = 0;
    for (const event of events) {
      const summary = event.summary || '';
      const description = event.description || '';
      
      // Check if this event is for the property being rescheduled
      // Match against both summary and description
      if (summary.includes(propertyAddress) || description.includes(propertyAddress)) {
        await calendar.events.delete({
          calendarId: CALENDAR_ID,
          eventId: event.id,
        });
        console.log(`Deleted event for ${propertyAddress}:`, event.id, summary);
        deletedCount++;
      } else {
        console.log(`Kept event (different property):`, summary);
      }
    }

    console.log(`Deleted ${deletedCount} event(s) for ${propertyAddress}, kept ${events.length - deletedCount} other event(s)`);
    return deletedCount;

  } catch (err) {
    console.error('Error deleting calendar events:', err.message);
    return 0;
  }
}

// Helper: Create new calendar event
async function createCalendarEvent(calendar, booking, newDate, newTime) {
  let startDateTime;
  try {
    startDateTime = new Date(`${newDate} ${newTime} EST`);
    if (isNaN(startDateTime.getTime())) {
      startDateTime = new Date(`${newDate} ${newTime}`);
    }
    if (isNaN(startDateTime.getTime())) {
      throw new Error('Invalid date/time');
    }
  } catch (e) {
    console.error('Date parsing error:', e.message);
    throw new Error('Invalid date or time format');
  }

  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  const description = `
RESCHEDULED APPOINTMENT

Phone: ${booking.phone || 'N/A'}
Email: ${booking.email || 'N/A'}
Budget: ${booking.budget || 'N/A'}
Apartment Size: ${booking.apartment_size || 'N/A'}
Preferred Area: ${booking.preferred_area || 'N/A'}
Move-In Date: ${booking.move_in_date || 'N/A'}
Income: ${booking.income_qualifies || 'N/A'}
Credit: ${booking.credit_qualifies || 'N/A'}

Notes:
${booking.additional_notes || 'None'}
  `.trim();

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
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { phone, new_date, new_time, property } = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!phone || !new_date || !new_time) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: phone, new_date, new_time' }),
      };
    }

    // Normalize phone
    let normalizedPhone = phone.toString().replace(/\D/g, '');
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+1' + normalizedPhone;
    }

    console.log('Reschedule request:', { phone: normalizedPhone, new_date, new_time, property });

    // Find the booking in Supabase
    const findUrl = `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(normalizedPhone)}&order=created_at.desc`;
    const findRes = await fetch(findUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    const bookings = await findRes.json();

    if (!bookings || bookings.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, message: 'No booking found for this phone number' }),
      };
    }

    // If property specified, find the specific booking for that property
    let booking;
    if (property) {
      booking = bookings.find(b => 
        b.type && b.type.toLowerCase().includes(property.toLowerCase())
      );
      
      if (!booking) {
        console.log(`No booking found for property: ${property}. Available bookings:`, 
          bookings.map(b => b.type));
        // Fall back to most recent booking
        booking = bookings[0];
      } else {
        console.log(`Found booking for property: ${property}`);
      }
    } else {
      // No property specified, use most recent
      booking = bookings[0];
      console.log('No property specified, using most recent booking');
    }

    console.log('Selected booking:', booking.id, 'for property:', booking.type);

    // Get calendar client
    const calendar = await getCalendarClient();

    // Delete OLD calendar event(s) for THIS SPECIFIC PROPERTY ONLY
    const propertyToReschedule = property || booking.type;
    await deletePropertyEvents(calendar, booking.full_name, propertyToReschedule);

    // Create NEW calendar event
    let newEvent = null;
    try {
      newEvent = await createCalendarEvent(calendar, booking, new_date, new_time);
      console.log('New calendar event created:', newEvent.id);
    } catch (err) {
      console.error('Error creating calendar event:', err.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create calendar event: ' + err.message }),
      };
    }

    // Update Supabase record
    const updateUrl = `${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`;
    await fetch(updateUrl, {
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
    });

    console.log('Supabase updated for booking:', booking.id);

    // Send confirmation EMAIL to caller (CC inquiries)
    if (booking.email) {
      const emailHtml = `
        <h2>Appointment Rescheduled</h2>
        <p>Dear ${booking.full_name},</p>
        <p>Your showing at <strong>${booking.type}</strong> has been rescheduled to:</p>
        <p><strong>${new_date} at ${new_time}</strong></p>
        <p>Budget: ${booking.budget || 'N/A'}<br>
        Apartment Size: ${booking.apartment_size || 'N/A'}<br>
        Move-In Date: ${booking.move_in_date || 'N/A'}</p>
        <p>We look forward to seeing you!</p>
        <p>Best regards,<br>Rosalia Group<br>(862) 333-1681</p>
      `;

      try {
        await transporter.sendMail({
          from: '"Rosalia Group" <ana@rosaliagroup.com>',
          to: booking.email,
          cc: 'inquiries@rosaliagroup.com',
          subject: 'Appointment Rescheduled - Rosalia Group',
          html: emailHtml,
        });
        console.log('Reschedule email sent to:', booking.email, '+ CC inquiries');
      } catch (err) {
        console.error('Email error:', err.message);
      }
    }

    // Send SMS to CALLER
    const callerMsg = `Your appointment has been rescheduled!\n\n${booking.type || 'Appointment'}\n${new_date} at ${new_time}\n\nRosalia Group will be in touch. See you then!`;
    await sendSMS(normalizedPhone, callerMsg);

    // Send SMS to TEAM (Ana)
    const teamMsg = `Appointment Rescheduled!\n\nName: ${booking.full_name}\nPhone: ${normalizedPhone}\nEmail: ${booking.email || 'N/A'}\nProperty: ${booking.type}\nNEW Date: ${new_date} at ${new_time}\nBudget: ${booking.budget || 'N/A'}\nSize: ${booking.apartment_size || 'N/A'}\nMove-In: ${booking.move_in_date || 'N/A'}\nIncome: ${booking.income_qualifies || 'N/A'}\nCredit: ${booking.credit_qualifies || 'N/A'}`;
    await sendSMS(ANA_PHONE, teamMsg);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Rescheduled to ${new_date} at ${new_time}`,
        eventId: newEvent?.id,
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