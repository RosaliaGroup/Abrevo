const { google } = require('googleapis');

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
    const dateStr = `${data.preferred_date} ${data.preferred_time} GMT-0500`;
    startDateTime = new Date(dateStr);
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
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

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
    console.log('Incoming data:', JSON.stringify(data));

    const name = data.full_name || data.name || 'Guest';
    let phone = data.phone || data.caller_phone || '';
    if (phone && !phone.startsWith('+')) phone = '+1' + phone;
    const email = data.email || data.caller_email || '';
    const type = data.type || data.appointment_type || 'Appointment';
    const date = data.preferred_date || data.date || '';
    const time = data.preferred_time || data.time || '';

    // 1. Create Google Calendar event
    let calendarEvent = null;
    try {
      calendarEvent = await createCalendarEvent(client, { ...data, phone });
    } catch (err) {
      console.error('Calendar error:', err.message);
    }

    // 2. Text caller confirmation
    if (phone) {
      const callerMsg = `Appointment confirmed!\n\n📍 ${type}\n📅 ${date} at ${time}\n\nQuestions? Call us at (862) 777-9789`;
      const callerResult = await sendSMS(phone, callerMsg);
      console.log('Caller SMS result:', JSON.stringify(callerResult));
    }

    // 3. Text Ana with full details
    const teamMsg = `New Booking!\n\nName: ${name}\nPhone: ${phone}\nProperty: ${type}\nDate: ${date} at ${time}\nBudget: ${data.budget || 'N/A'}\nArea: ${data.preferred_area || 'N/A'}\nMove-In: ${data.move_in_date || 'N/A'}\nIncome: ${data.income_qualifies || 'N/A'}\nCredit: ${data.credit_qualifies || 'N/A'}`;
    const teamResult = await sendSMS(client.notifyPhone, teamMsg);
    console.log('Team SMS result:', JSON.stringify(teamResult));

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
