const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';

const EMAIL_USER = 'ana@rosaliagroup.com';
const EMAIL_PASS = 'rmex aonh vvum uobk';
const NOTIFY_EMAIL = 'inquiries@rosaliagroup.com';

async function sendEmail({ to, cc, subject, html }) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
  return transporter.sendMail({ from: `"Rosalia Group" <${EMAIL_USER}>`, to, cc, subject, html });
}

async function saveToSupabase(data, calendarEventId) {
  let phone = String(data.phone || '').replace(/\D/g, '');
  if (phone.length === 10) phone = '+1' + phone;
  else if (phone.length === 11 && phone.startsWith('1')) phone = '+' + phone;
  else if (phone.length === 12 && phone.startsWith('11')) phone = '+1' + phone.slice(2);
  else if (!phone.startsWith('+')) phone = '+' + phone;

  const row = {
    full_name: data.full_name || null,
    phone,
    email: data.email || null,
    type: data.type || data.property_address || 'Iron 65 | 65 Iron Street, Newark NJ',
    preferred_date: data.preferred_date || null,
    preferred_time: data.preferred_time || null,
    budget: data.budget || null,
    apartment_size: data.apartment_size || null,
    move_in_date: data.move_in_date || null,
    income_qualifies: data.income_qualifies || null,
    credit_qualifies: data.credit_qualifies || null,
    additional_notes: data.additional_notes || null,
    client: data.client || 'rosalia',
    calendar_event_id: calendarEventId || null,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const result = await res.json();
  console.log('Supabase save:', JSON.stringify(result));
  return result;
}

const CLIENTS = {
  rosalia: {
    calendarId: '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com',
    notifyPhone: '+12014970225',
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

function buildISOString(dateStr, timeStr) {
  // dateStr: "March 17, 2026"  timeStr: "2:00 PM"
  const months = {January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
    July:'07',August:'08',September:'09',October:'10',November:'11',December:'12'};
  const m = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
  if (!m) return null;
  const mm = months[m[1]];
  const dd = String(m[2]).padStart(2, '0');
  const yyyy = m[3];
  const t = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!t) return null;
  let hh = parseInt(t[1]);
  const min = String(t[2]).padStart(2, '0');
  const ampm = t[3].toUpperCase();
  if (ampm === 'PM' && hh !== 12) hh += 12;
  if (ampm === 'AM' && hh === 12) hh = 0;
  return `${yyyy}-${mm}-${dd}T${String(hh).padStart(2,'0')}:${min}:00`;
}

async function createCalendarEvent(client, data) {
  const auth = new google.auth.GoogleAuth({
    credentials: client.googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  const isoStart = buildISOString(data.preferred_date, data.preferred_time);
  let startDateTime, endDateTime;
  if (isoStart) {
    startDateTime = isoStart;
    const end = new Date(new Date(isoStart).getTime() + 30 * 60 * 1000);
    endDateTime = buildISOString(data.preferred_date, data.preferred_time);
    // build end manually
    const endDate = new Date(isoStart);
    endDate.setMinutes(endDate.getMinutes() + 30);
    const ep = isoStart.split('T');
    const et = endDate.toTimeString().slice(0,5);
    endDateTime = `${ep[0]}T${et}:00`;
  } else {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(12, 0, 0, 0);
    startDateTime = fallback.toISOString();
    endDateTime = new Date(fallback.getTime() + 30*60*1000).toISOString();
  }

  const propertyName = data.type || data.property_address || 'Iron 65 | 65 Iron Street, Newark NJ';

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
      summary: `${data.full_name} - ${propertyName}`,
      description,
      start: { dateTime: startDateTime, timeZone: 'America/New_York' },
      end: { dateTime: endDateTime, timeZone: 'America/New_York' },
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
    const propertyName = data.type || data.property_address || 'Iron 65 | 65 Iron Street, Newark NJ';

    // 1. Create Google Calendar event
    let calendarEvent = null;
    try {
      calendarEvent = await createCalendarEvent(client, data);
    } catch (err) {
      console.error('Calendar error:', err.message);
    }

    // 2. Save to Supabase
    try {
      await saveToSupabase(data, calendarEvent?.id);
    } catch (err) {
      console.error('Supabase error:', err.message);
    }

    // 3. SMS confirmation to caller
    if (data.phone) {
      const callerMsg = `Your appointment is confirmed!\n\n${propertyName}\n${data.preferred_date} at ${data.preferred_time}\n\n${client.teamName} will be in touch to coordinate. See you then!`;
      await sendSMS(data.phone, callerMsg);
    }

    // 4. SMS team notification
    const teamMsg = `New Booking!\n\nName: ${data.full_name}\nPhone: ${data.phone}\nEmail: ${data.email}\nProperty: ${propertyName}\nDate: ${data.preferred_date} at ${data.preferred_time}\nBudget: ${data.budget}\nArea: ${data.preferred_area}\nMove-In: ${data.move_in_date}\nIncome: ${data.income_qualifies}\nCredit: ${data.credit_qualifies}\n\nNotes: ${data.additional_notes}`;
    const smsSent = await sendSMS(client.notifyPhone, teamMsg);
    console.log('Team SMS:', JSON.stringify(smsSent));

    // 5. Email confirmation to client
    if (data.email) {
      try {
        await sendEmail({
          to: data.email,
          cc: NOTIFY_EMAIL,
          subject: `Appointment Confirmed - Rosalia Group`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <h2 style="color:#b8960c;">Appointment Confirmed</h2>
              <p>Dear ${data.full_name},</p>
              <p>Your tour appointment has been confirmed. We look forward to seeing you!</p>
              <table style="border-collapse:collapse;width:100%;margin:20px 0;">
                <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Date & Time</td><td style="padding:8px;border:1px solid #ddd;">${data.preferred_date} at ${data.preferred_time}</td></tr>
                <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Property</td><td style="padding:8px;border:1px solid #ddd;">${propertyName}</td></tr>
                <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Budget</td><td style="padding:8px;border:1px solid #ddd;">${data.budget || 'N/A'}</td></tr>
                <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Apartment Size</td><td style="padding:8px;border:1px solid #ddd;">${data.apartment_size || 'N/A'}</td></tr>
                <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Move-In Date</td><td style="padding:8px;border:1px solid #ddd;">${data.move_in_date || 'N/A'}</td></tr>
              </table>
              <p>Questions? Call <a href="tel:+18623331681">(862) 333-1681</a> or email <a href="mailto:inquiries@rosaliagroup.com">inquiries@rosaliagroup.com</a></p>
              <p>We look forward to seeing you!</p>
              <p><strong>Rosalia Group</strong><br>65 Iron Street, Newark NJ</p>
            </div>
          `,
        });
        console.log('Confirmation email sent to', data.email);
      } catch (err) {
        console.error('Email error:', err.message);
      }
    }

    // 6. Email team notification
    try {
      await sendEmail({
        to: NOTIFY_EMAIL,
        subject: `New Booking - ${data.full_name}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#b8960c;">New Booking</h2>
            <table style="border-collapse:collapse;width:100%;margin:20px 0;">
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Name</td><td style="padding:8px;border:1px solid #ddd;">${data.full_name}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Phone</td><td style="padding:8px;border:1px solid #ddd;">${data.phone}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Email</td><td style="padding:8px;border:1px solid #ddd;">${data.email}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Property</td><td style="padding:8px;border:1px solid #ddd;">${propertyName}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Date & Time</td><td style="padding:8px;border:1px solid #ddd;">${data.preferred_date} at ${data.preferred_time}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Budget</td><td style="padding:8px;border:1px solid #ddd;">${data.budget}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Apartment Size</td><td style="padding:8px;border:1px solid #ddd;">${data.apartment_size}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Move-In Date</td><td style="padding:8px;border:1px solid #ddd;">${data.move_in_date}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Income</td><td style="padding:8px;border:1px solid #ddd;">${data.income_qualifies}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Credit</td><td style="padding:8px;border:1px solid #ddd;">${data.credit_qualifies}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Notes</td><td style="padding:8px;border:1px solid #ddd;">${data.additional_notes || 'N/A'}</td></tr>
            </table>
          </div>
        `,
      });
      console.log('Team notification email sent');
    } catch (err) {
      console.error('Team email error:', err.message);
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
