const { google } = require('googleapis');

const CLIENTS = {
  rosalia: {
    calendarId: 'inquiries@rosaliagroup.com',
    notifyPhone: '+16462269189',
    notifyName: 'Ana',
    teamName: 'Rosalia Group',
    rescheduleLink: 'calendly.com/ana-rosaliagroup/apartment-tour-request',
    googleCredentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  }
};

const TEXTBELT_KEY = '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';

async function sendSMS(phone, message) {
  const response = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
  });
  return response.json();
}

async function createCalendarEvent(client, data) {
  const auth = new google.auth.GoogleAuth({
    credentials: client.googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  let startDateTime;
  try {
    startDateTime = new Date(`${data.preferred_date} ${data.preferred_time}`);
    if (isNaN(startDateTime.getTime())) {
      startDateTime = new Date(`${data.preferred_date} ${data.preferred_time} EST`);
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
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  // Log what we received for debugging
  console.log('Booking data received:', JSON.stringify(data));

  const description = `
Phone: ${data.phone || data.caller_phone || 'N/A'}
Email: ${data.email || data.caller_email || 'N/A'}
Budget: ${data.budget || 'N/A'}
Apartment Size: ${data.apartment_size || data.size || 'N/A'}
Preferred Area: ${data.preferred_area || data.area || 'N/A'}
Move-In Date: ${data.move_in_date || 'N/A'}
Income Qualifies: ${data.income_qualifies || 'N/A'}
Credit Qualifies: ${data.credit_qualifies || 'N/A'}

Notes:
${data.additional_notes || data.notes || 'N/A'}
  `.trim();

  const event = await calendar.events.insert({
    calendarId: client.calendarId,
    resource: {
      summary: data.type || data.appointment_type || 'Appointment',
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
    
    // Log all incoming data
    console.log('Incoming data:', JSON.stringify(data));

    const name = data.full_name || data.name || 'Guest';
    const phone = data.phone || data.caller_phone || '';
    const email = data.email || data.caller_email || '';
    const type = data.type || data.appointment_type || 'Appointment';
    const date = data.preferred_date || data.date || '';
    const time = data.preferred_time || data.time || '';

    // 1. Create Google Calendar event
    let calendarEvent = null;
    try {
      calendarEvent = await createCalendarEvent(client, { ...data, full_name: name, phone, email, type });
    } catch (err) {
      console.error('Calendar error:', err.message);
    }

    // 2. Text caller — clean confirmation
    if (phone) {
      const callerMsg = `Appointment confirmed!\n\n📍 ${type}\n📅 ${date} at ${time}\n\nNeed to reschedule? ${client.rescheduleLink}`;
      await sendSMS(phone, callerMsg);
    }

    // 3. Text Ana with full details
    const teamMsg = `New Booking!\n\nName: ${name}\nPhone: ${phone}\nEmail: ${email}\nProperty: ${type}\nDate: ${date} at ${time}\nBudget: ${data.budget || 'N/A'}\nArea: ${data.preferred_area || data.area || 'N/A'}\nMove-In: ${data.move_in_date || 'N/A'}\nIncome: ${data.income_qualifies || 'N/A'}\nCredit: ${data.credit_qualifies || 'N/A'}\n\nNotes: ${data.additional_notes || data.notes || 'N/A'}`;
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
