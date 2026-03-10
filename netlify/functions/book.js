const { google } = require('googleapis');

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

const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';

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

  let hours = 10, minutes = 0;
  try {
    const timeStr = (data.preferred_time || '10:00 AM').trim();
    const [timePart, meridiem] = timeStr.split(' ');
    [hours, minutes] = timePart.split(':').map(Number);
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
  } catch(e) { hours = 10; minutes = 0; }

  let startDateTime = new Date(data.preferred_date);
  if (isNaN(startDateTime.getTime())) startDateTime = new Date();
  startDateTime.setHours(hours, minutes, 0, 0);
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  const propertyAddress = data.property_address || data.type || 'Iron 65, Newark NJ';
  const summary = `${data.full_name || 'Guest'} - ${propertyAddress}`;
  const description = [
    `Phone: ${data.phone || 'N/A'}`,
    `Email: ${data.email || 'N/A'}`,
    `Budget: ${data.budget || 'N/A'}`,
    `Apartment Size: ${data.apartment_size || 'N/A'}`,
    `Move-In Date: ${data.move_in_date || 'N/A'}`,
    `Income: ${data.income_qualifies || 'N/A'}`,
    `Credit: ${data.credit_qualifies || 'N/A'}`,
    `Notes: ${data.additional_notes || 'N/A'}`,
  ].join('\n');

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
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const clientId = event.queryStringParameters?.client || 'rosalia';
    const client = CLIENTS[clientId];
    if (!client) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown client' }) };

    const data = JSON.parse(event.body || '{}');
    const propertyAddress = data.property_address || data.type || 'Iron 65, Newark NJ';
    console.log('Booking:', data.full_name, data.preferred_date, data.preferred_time);

    let calendarEvent = null;
    try {
      calendarEvent = await createCalendarEvent(client, data);
      console.log('Calendar event created:', calendarEvent?.id);
    } catch (err) {
      console.error('Calendar error:', err.message);
    }

    if (data.phone) {
      const callerMsg = `Your tour is confirmed!\n\n${propertyAddress}\n${data.preferred_date} at ${data.preferred_time}\n\nSee you then! Questions? Call (862) 333-1681`;
      try { await sendSMS(data.phone, callerMsg); } catch(e) { console.error('Caller SMS error:', e.message); }
    }

    const teamMsg = `New Booking!\n\nName: ${data.full_name}\nPhone: ${data.phone}\nEmail: ${data.email}\nProperty: ${propertyAddress}\nDate: ${data.preferred_date} at ${data.preferred_time}\nBudget: ${data.budget}\nSize: ${data.apartment_size}\nMove-In: ${data.move_in_date}\nIncome: ${data.income_qualifies}\nCredit: ${data.credit_qualifies}`;
    try { await sendSMS(client.notifyPhone, teamMsg); } catch(e) { console.error('Team SMS error:', e.message); }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, eventId: calendarEvent?.id }) };
  } catch (err) {
    console.error('Booking error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};