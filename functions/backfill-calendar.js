const { google } = require('googleapis');

const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';

const BOOKINGS = [
  {
    name: 'Owen L Barry',
    date: '2026-03-26',
    time: '12:00 PM',
    property: 'Iron 65 — 65 Mcwhorter St, Newark NJ',
    size: '1BR',
    phone: '+19733563539',
    email: 'owenbarry1@gmail.com',
  },
  {
    name: 'Wanting Sun',
    date: '2026-03-27',
    time: '12:00 PM',
    property: '502 Market St Newark NJ',
    size: '1BR',
    phone: '+13479896058',
    email: 'sunwanting1996@gmail.com',
  },
  {
    name: 'Xsavian Nunez',
    date: '2026-03-28',
    time: '12:00 PM',
    property: 'Iron 65 — 65 Mcwhorter St, Newark NJ',
    size: '1BR',
    phone: '+19737807808',
    email: 'xsavian.nunez7@gmail.com',
  },
  {
    name: 'Vanessa Nielsen',
    date: '2026-04-09',
    time: '5:00 PM',
    property: '502 Market St Newark NJ',
    size: '1BR',
    phone: '+12017368691',
    email: 'vanessamvnielsen@gmail.com',
  },
  {
    name: 'Vanessa Nielsen',
    date: '2026-04-09',
    time: '4:00 PM',
    property: '77 Christie St The Ballantine Newark NJ',
    size: '1BR',
    phone: '+12017368691',
    email: 'vanessamvnielsen@gmail.com',
  },
];

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const calendar = google.calendar({ version: 'v3', auth });

  const results = [];

  for (const booking of BOOKINGS) {
    try {
      // Parse date
      const [year, month, day] = booking.date.split('-').map(Number);

      // Parse time
      const timeParts = booking.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
      let hours = parseInt(timeParts[1]);
      const minutes = parseInt(timeParts[2]);
      const period = timeParts[3].toUpperCase();
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;

      // Create date in Eastern Time (UTC-4 EDT)
      const startDateTime = new Date(Date.UTC(year, month - 1, day, hours + 4, minutes, 0));
      const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

      const summary = `${booking.name} - ${booking.property}`;
      const description = `Phone: ${booking.phone}\nEmail: ${booking.email}\nApartment Size: ${booking.size}\nProperty: ${booking.property}\n\n[Backfilled event]`;

      const calEvent = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        resource: {
          summary,
          description,
          start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
          end: { dateTime: endDateTime.toISOString(), timeZone: 'America/New_York' },
        },
      });

      results.push({ name: booking.name, date: booking.date, time: booking.time, property: booking.property, status: 'created', eventId: calEvent.data.id });
      console.log(`Created event for ${booking.name}:`, calEvent.data.id);
    } catch (err) {
      results.push({ name: booking.name, date: booking.date, time: booking.time, property: booking.property, status: 'error', error: err.message });
      console.error(`Error creating event for ${booking.name}:`, err.message);
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results }),
  };
};
