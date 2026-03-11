const { google } = require('googleapis');

const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';

async function deleteMariaEvents() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const future = new Date('2026-12-31');

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    q: 'Maria Garcia',
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: true,
  });

  const events = res.data.items || [];
  console.log(`Found ${events.length} Maria Garcia events`);

  for (const event of events) {
    console.log(`Deleting: ${event.summary} on ${event.start.dateTime}`);
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: event.id });
  }

  console.log(`Deleted ${events.length} events`);
}

deleteMariaEvents().catch(console.error);