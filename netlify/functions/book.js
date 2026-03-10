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
const transporter = nodemailer.createTransport({
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

async function createCalendarEvent(client, data) {
  const auth = new google.auth.GoogleAuth({
    credentials: client.googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  // Parse date and time - force EST timezone
  let startDateTime;
  try {
    // Parse as EST explicitly
    const dateStr = `${data.preferred_date} ${data.preferred_time} EST`;
    startDateTime = new Date(dateStr);

    // If still invalid, try another format
    if (isNaN(startDateTime.getTime())) {
      startDateTime = new Date(`${data.preferred_date} ${data.preferred_time}`);
    }

    // Fallback to tomorrow at noon
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

  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  // Get property address - use property_address field if available, fallback to type
  const propertyAddress = data.property_address || data.type || 'Appointment';
  
  // Format: Caller Name - Building Address
  const summary = `${data.full_name || 'Guest'} - ${propertyAddress}`;

  const description = `
Phone: ${data.phone || 'N/A'}
Email: ${data.email || 'N/A'}
Budget: ${data.budget || 'N/A'}
Apartment Size: ${data.apartment_size || 'N/A'}
Property: ${propertyAddress}
Move-In Date: ${data.move_in_date || 'N/A'}
Income Qualifies: ${data.income_qualifies || 'N/A'}
Credit Qualifies: ${data.credit_qualifies || 'N/A'}

Notes:
${data.additional_notes || 'N/A'}
  `.trim();

  const event = await calendar.events.insert({
    calendarId: client.calendarId,
    resource: {
      summary,
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
    console.log('Booking data received:', JSON.stringify(data));

    // Get property address for notifications
    const propertyAddress = data.property_address || data.type || 'the property';

    // 1. Create Google Calendar event
    let calendarEvent = null;
    try {
      calendarEvent = await createCalendarEvent(client, data);
      console.log('Calendar event created:', calendarEvent?.id);
    } catch (err) {
      console.error('Calendar error:', err.message);
    }

    // 2. Send SMS to caller
    if (data.phone) {
      const callerMsg = `Your appointment is confirmed!\n\n${propertyAddress}\n${data.preferred_date} at ${data.preferred_time}\n\nRosalia Group will be in touch. See you then!`;
      try {
        const smsResult = await sendSMS(data.phone, callerMsg);
        console.log('Caller SMS sent:', smsResult.success);
      } catch (err) {
        console.error('Caller SMS error:', err.message);
      }
    }

    // 3. Send SMS to team
    const teamMsg = `New Booking!\n\nName: ${data.full_name}\nPhone: ${data.phone}\nEmail: ${data.email}\nProperty: ${propertyAddress}\nDate: ${data.preferred_date} at ${data.preferred_time}\nBudget: ${data.budget}\nSize: ${data.apartment_size}\nMove-In: ${data.move_in_date}\nIncome: ${data.income_qualifies}\nCredit: ${data.credit_qualifies}\n\nNotes: ${data.additional_notes}`;
    try {
      const teamSmsResult = await sendSMS(client.notifyPhone, teamMsg);
      console.log('Team SMS sent:', teamSmsResult.success);
    } catch (err) {
      console.error('Team SMS error:', err.message);
    }

    // 4. Send email confirmation to caller (CC inquiries@rosaliagroup.com)
    if (data.email) {
      const emailHtml = `
        <h2>Appointment Confirmed</h2>
        <p>Dear ${data.full_name},</p>
        <p>Your showing at <strong>${propertyAddress}</strong> is confirmed for:</p>
        <p><strong>${data.preferred_date} at ${data.preferred_time}</strong></p>
        <p>Budget: ${data.budget}<br>
        Apartment Size: ${data.apartment_size}<br>
        Move-In Date: ${data.move_in_date}</p>
        <p>We look forward to seeing you!</p>
        <p>Best regards,<br>Rosalia Group<br>(862) 333-1681</p>
      `;

      try {
        // Send to caller and CC to inquiries
        await transporter.sendMail({
          from: '"Rosalia Group" <ana@rosaliagroup.com>',
          to: data.email,
          cc: 'inquiries@rosaliagroup.com',
          subject: 'Appointment Confirmed - Rosalia Group',
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
