const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// Client configurations
const CLIENTS = {
  rosalia: {
    calendarId: '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com',
    notifyPhone: '+12014970225',
    notifyEmail: 'inquiries@rosaliagroup.com',
    notifyName: 'Ana',
    teamName: 'Rosalia Group',
    googleCredentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  }
};

const TEXTBELT_KEY = '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';

// Email transporter
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

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
  const result = await response.json();
  console.log('SMS response:', JSON.stringify(result));
  return result;
}

async function findEventByPhone(client, phone) {
  const auth = new google.auth.GoogleAuth({
    credentials: client.googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  // Search for events with this phone number in the next 60 days
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const response = await calendar.events.list({
    calendarId: client.calendarId,
    timeMin,
    timeMax,
    q: phone.replace('+', ''),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = response.data.items || [];
  
  // Find the first upcoming event with this phone number
  for (const event of events) {
    if (event.description && event.description.includes(phone)) {
      return event;
    }
  }

  return null;
}

async function rescheduleEvent(client, eventId, newDate, newTime, propertyAddress) {
  const auth = new google.auth.GoogleAuth({
    credentials: client.googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  // Get the existing event
  const event = await calendar.events.get({
    calendarId: client.calendarId,
    eventId: eventId,
  });

  // Parse new date and time
  let startDateTime;
  try {
    const dateStr = `${newDate} ${newTime} EST`;
    startDateTime = new Date(dateStr);

    if (isNaN(startDateTime.getTime())) {
      startDateTime = new Date(`${newDate} ${newTime}`);
    }

    if (isNaN(startDateTime.getTime())) {
      throw new Error('Invalid date/time');
    }
  } catch(e) {
    throw new Error(`Could not parse date/time: ${newDate} ${newTime}`);
  }

  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  // Update the event with new time and property address
  const updatedEvent = {
    ...event.data,
    start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
    end: { dateTime: endDateTime.toISOString(), timeZone: 'America/New_York' },
  };

  // Update summary if property address is provided
  if (propertyAddress) {
    const namePart = event.data.summary.split(' - ')[0] || 'Guest';
    updatedEvent.summary = `${namePart} - ${propertyAddress}`;
    
    // Update property in description
    if (updatedEvent.description) {
      updatedEvent.description = updatedEvent.description.replace(
        /Property: .*/,
        `Property: ${propertyAddress}`
      );
    }
  }

  const result = await calendar.events.update({
    calendarId: client.calendarId,
    eventId: eventId,
    resource: updatedEvent,
  });

  return result.data;
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
    console.log('Reschedule data received:', JSON.stringify(data));

    const { phone, new_date, new_time, property_address } = data;

    if (!phone || !new_date || !new_time) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: phone, new_date, new_time' })
      };
    }

    // Find the existing event
    const existingEvent = await findEventByPhone(client, phone);

    if (!existingEvent) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'No upcoming appointment found for this phone number' })
      };
    }

    console.log('Found existing event:', existingEvent.id);

    // Get property address - use provided one or extract from existing event
    const propertyAddress = property_address || 
                           (existingEvent.summary.split(' - ')[1]) || 
                           'Appointment';

    // Reschedule the event
    const updatedEvent = await rescheduleEvent(
      client,
      existingEvent.id,
      new_date,
      new_time,
      propertyAddress
    );

    console.log('Event rescheduled:', updatedEvent.id);

    // Extract customer info from existing event
    const phoneMatch = existingEvent.description?.match(/Phone: ([^\n]+)/);
    const emailMatch = existingEvent.description?.match(/Email: ([^\n]+)/);
    const nameMatch = existingEvent.summary?.split(' - ')[0];

    const customerPhone = phoneMatch ? phoneMatch[1] : phone;
    const customerEmail = emailMatch ? emailMatch[1] : null;
    const customerName = nameMatch || 'Guest';

    // Send SMS to caller
    if (customerPhone && customerPhone !== 'N/A') {
      const callerMsg = `Your appointment has been rescheduled!\n\n${propertyAddress}\n${new_date} at ${new_time}\n\nRosalia Group will see you then!`;
      try {
        const smsResult = await sendSMS(customerPhone, callerMsg);
        console.log('Caller SMS sent:', smsResult.success);
      } catch (err) {
        console.error('Caller SMS error:', err.message);
      }
    }

    // Send SMS to team
    const teamMsg = `Appointment Rescheduled!\n\nName: ${customerName}\nPhone: ${customerPhone}\nEmail: ${customerEmail}\nProperty: ${propertyAddress}\nNew Date: ${new_date} at ${new_time}`;
    try {
      const teamSmsResult = await sendSMS(client.notifyPhone, teamMsg);
      console.log('Team SMS sent:', teamSmsResult.success);
    } catch (err) {
      console.error('Team SMS error:', err.message);
    }

    // Send email confirmation
    if (customerEmail && customerEmail !== 'N/A') {
      const emailHtml = `
        <h2>Appointment Rescheduled</h2>
        <p>Dear ${customerName},</p>
        <p>Your showing at <strong>${propertyAddress}</strong> has been rescheduled to:</p>
        <p><strong>${new_date} at ${new_time}</strong></p>
        <p>We look forward to seeing you!</p>
        <p>Best regards,<br>Rosalia Group<br>(862) 333-1681</p>
      `;

      try {
        await transporter.sendMail({
          from: '"Rosalia Group" <ana@rosaliagroup.com>',
          to: customerEmail,
          cc: 'inquiries@rosaliagroup.com',
          subject: 'Appointment Rescheduled - Rosalia Group',
          html: emailHtml,
        });
        console.log('Email sent to caller');
      } catch (err) {
        console.error('Email error:', err.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        eventId: updatedEvent.id,
        message: 'Appointment rescheduled successfully'
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