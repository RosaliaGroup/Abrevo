const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';

const CLIENTS = {
  rosalia: {
    calendarId: CALENDAR_ID,
    notifyPhone: '+12014970225',
    notifyEmail: 'inquiries@rosaliagroup.com',
    teamName: 'Rosalia Group',
    teamPhone: '(862) 419-1814',
    googleCredentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  }
};

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

async function sendSMS(phone, message) {
  try {
    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
    });
    const result = await response.json();
    console.log('SMS result:', JSON.stringify(result));
    return result;
  } catch (e) {
    console.error('SMS error:', e.message);
    return { success: false, error: e.message };
  }
}

async function sendEmail({ to, cc, subject, text }) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });
    const result = await transporter.sendMail({ from: process.env.GMAIL_USER, to, cc, subject, text });
    console.log('Email sent:', result.messageId);
    return { success: true };
  } catch (e) {
    console.error('Email error:', e.message);
    return { success: false, error: e.message };
  }
}

async function addCalendarEvent(client, data, startDT, endDT) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: client.googleCredentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const calendar = google.calendar({ version: 'v3', auth });
    const event = {
      summary: `${data.full_name} - ${data.type || 'Apartment Tour'}`,
      location: data.type || '',
      description: [
        `Phone: ${data.phone}`,
        `Email: ${data.email}`,
        `Budget: ${data.budget}`,
        `Apartment Size: ${data.apartment_size}`,
        `Preferred Area: ${data.preferred_area || 'Not provided'}`,
        `Move-In Date: ${data.move_in_date}`,
        `Income Qualifies: ${data.income_qualifies}`,
        `Credit Qualifies: ${data.credit_qualifies}`,
        `Notes: ${data.additional_notes || 'None'}`,
      ].join('\n'),
      start: { dateTime: startDT.toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: endDT.toISOString(), timeZone: 'America/New_York' },
    };
    const result = await calendar.events.insert({ calendarId: client.calendarId, resource: event });
    console.log('Calendar event created:', result.data.id);
    return { success: true };
  } catch (err) {
    console.error('Calendar error:', err.message);
    return { success: false, error: err.message };
  }
}

function parseDateTime(dateStr, timeStr) {
  try {
    const timeMatch = timeStr.match(/(\d+):?(\d{0,2})\s*(am|pm)?/i);
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2] || '0');
    const meridiem = (timeMatch[3] || '').toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    let year, month, day;
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      year = parseInt(isoMatch[1]);
      month = parseInt(isoMatch[2]) - 1;
      day = parseInt(isoMatch[3]);
    } else {
      const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      const textMatch = dateStr.match(/([a-zA-Z]+)\s+(\d+),?\s*(\d{4})/);
      if (!textMatch) throw new Error('Cannot parse date: ' + dateStr);
      month = months.indexOf(textMatch[1].toLowerCase());
      day = parseInt(textMatch[2]);
      year = parseInt(textMatch[3]);
    }

    const etOffset = (month >= 2 && month <= 10) ? '-04:00' : '-05:00';
    const dtStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00${etOffset}`;
    const start = new Date(dtStr);
    if (isNaN(start.getTime())) throw new Error('Invalid date');
    return start;
  } catch (e) {
    console.error('Date parse error:', e.message);
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(10, 0, 0, 0);
    return fallback;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const data = JSON.parse(event.body || '{}');
    console.log('Booking received:', JSON.stringify(data));

    const clientId = event.queryStringParameters?.client || 'rosalia';
    const client = CLIENTS[clientId];
    if (!client) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown client' }) };

    const startDT = parseDateTime(data.preferred_date, data.preferred_time);
    const endDT = new Date(startDT.getTime() + 30 * 60 * 1000);

    const displayDate = startDT.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
    const displayTime = startDT.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });

    // 1. Calendar (never blocks SMS/email)
    const calResult = await addCalendarEvent(client, data, startDT, endDT);

    // 2. SMS to caller
    const callerMsg = `Hi ${data.full_name}! Your tour is confirmed:\n\nProperty: ${data.type || 'Apartment Tour'}\nDate: ${displayDate}\nTime: ${displayTime}\n\nQuestions? Call: ${client.teamPhone}`;
    const callerSMS = await sendSMS(data.phone, callerMsg);

    // 3. SMS to team
    const teamMsg = `New Booking!\n\nName: ${data.full_name}\nPhone: ${data.phone}\nEmail: ${data.email}\nProperty: ${data.type}\nDate: ${displayDate} at ${displayTime}\nBudget: ${data.budget}\nSize: ${data.apartment_size}\nArea: ${data.preferred_area || 'N/A'}\nMove-In: ${data.move_in_date}\nIncome: ${data.income_qualifies}\nCredit: ${data.credit_qualifies}\nNotes: ${data.additional_notes || 'None'}`;
    const teamSMS = await sendSMS(client.notifyPhone, teamMsg);

    // 4. Email to caller + CC team
    const emailResult = await sendEmail({
      to: data.email,
      cc: client.notifyEmail,
      subject: `Tour Confirmed - ${data.type || 'Apartment Tour'} on ${displayDate}`,
      text: `Hi ${data.full_name},\n\nYour apartment tour is confirmed!\n\nProperty: ${data.type}\nDate: ${displayDate}\nTime: ${displayTime}\n\nOur team will be in touch to confirm details.\n\nSee you then!\n${client.teamName}\n${client.teamPhone}`,
    });

    console.log('Results:', { calendar: calResult.success, callerSMS: callerSMS.success, teamSMS: teamSMS.success, email: emailResult.success });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, calendar: calResult.success, callerSMS: callerSMS.success, teamSMS: teamSMS.success, email: emailResult.success }),
    };
  } catch (err) {
    console.error('Booking error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
