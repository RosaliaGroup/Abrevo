const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';
const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = process.env.TEXTBELT_KEY || '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const SALES_EMAIL = 'sales@mechanicalenterprise.com';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

function normalizePhone(phone) {
  if (!phone) return null;
  const p = String(phone).replace(/\D/g, '');
  if (p.length === 10) return '+1' + p;
  if (p.length === 11) return '+' + p;
  return '+' + p;
}

async function createCalendarEvent(booking) {
  try {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
    if (!creds.client_email) return 'NO_CREDS';

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const cal = google.calendar({ version: 'v3', auth });

    const months = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
    const dateStr = (booking.preferred_date || '').trim();
    let year = 2026, monthNum = 0, day = 1;

    const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const txt = dateStr.match(/(\w+)\s+(\d+)[,\s]+(\d{4})/);
    if (iso) {
      year = parseInt(iso[1]); monthNum = parseInt(iso[2]) - 1; day = parseInt(iso[3]);
    } else if (txt) {
      monthNum = months[txt[1].toLowerCase()] ?? 0;
      day = parseInt(txt[2]);
      year = parseInt(txt[3]);
    } else {
      return 'BAD_DATE:' + dateStr;
    }

    let h = 10, m = 0;
    const tm = (booking.preferred_time || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (tm) {
      h = parseInt(tm[1]); m = parseInt(tm[2]);
      if (tm[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (tm[3].toUpperCase() === 'AM' && h === 12) h = 0;
    }

    const start = new Date(Date.UTC(year, monthNum, day, h + 4, m)); // +4 for EDT
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const event = {
      summary: `[HVAC] ${booking.full_name} - ${booking.appointment_type || 'Service'} - Mechanical Enterprise`,
      location: booking.property_address || '',
      description: `Service: ${booking.appointment_type || 'N/A'}\nCustomer: ${booking.full_name}\nPhone: ${booking.phone}\nEmail: ${booking.email || 'N/A'}\nProperty: ${booking.property_address || 'N/A'}\nType: ${booking.property_type || 'N/A'}\nIssue: ${booking.issue_description || 'N/A'}`,
      start: { dateTime: start.toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: end.toISOString(), timeZone: 'America/New_York' },
    };

    const res = await cal.events.insert({ calendarId: CALENDAR_ID, resource: event, sendUpdates: 'none' });
    return res.data.id || 'CREATED_NO_ID';
  } catch(e) {
    return 'ERR:' + e.message;
  }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const b = JSON.parse(event.body || '{}');
    const { full_name, phone, email, preferred_date, preferred_time,
            property_address, appointment_type, property_type, issue_description } = b;

    if (!full_name || !preferred_date || !preferred_time) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const normalPhone = normalizePhone(phone);

    // 1. Calendar
    const calResult = await createCalendarEvent(b);
    const eventId = (calResult && !calResult.startsWith('NO_') && !calResult.startsWith('BAD_') && !calResult.startsWith('ERR:')) ? calResult : null;
    console.log('Calendar result:', calResult);

    // 2. Supabase
    try {
      const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=minimal' },
        body: JSON.stringify({
          full_name, phone: normalPhone, email: email || null,
          preferred_date, preferred_time,
          budget: appointment_type || 'free_consultation',
          apartment_size: property_type || 'HVAC',
          preferred_area: property_address || 'N/A',
          move_in_date: issue_description || 'N/A',
          additional_notes: `HVAC | Address: ${property_address || 'N/A'}`,
          calendar_event_id: eventId,
          client: 'mechanical',
        }),
      });
      console.log('Supabase:', sbRes.status);
    } catch(e) { console.error('Supabase error:', e.message); }

    // 3. SMS
    if (normalPhone) {
      try {
        await fetch('https://textbelt.com/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: normalPhone, message: `Hi ${full_name.split(' ')[0]}! Your Mechanical Enterprise appointment is confirmed for ${preferred_date} at ${preferred_time}. Service: ${appointment_type || 'HVAC'}. Questions? Call (862) 419-1763`, key: TEXTBELT_KEY }),
        });
      } catch(e) { console.error('SMS error:', e.message); }
    }

    // 4. Email to sales
    try {
      await transporter.sendMail({
        from: `"Mechanical Enterprise Booking" <${GMAIL_USER}>`,
        to: SALES_EMAIL,
        subject: `New HVAC Appointment - ${full_name} | ${preferred_date} at ${preferred_time}`,
        text: `New HVAC Appointment\n\nCustomer: ${full_name}\nPhone: ${normalPhone}\nEmail: ${email || 'N/A'}\nDate: ${preferred_date} at ${preferred_time}\nService: ${appointment_type || 'N/A'}\nProperty: ${property_address || 'N/A'}\nType: ${property_type || 'N/A'}\nIssue: ${issue_description || 'N/A'}\nCalendar: ${calResult}`,
      });
    } catch(e) { console.error('Email error:', e.message); }

    // 5. Customer email
    if (email && !email.includes('convo.zillow')) {
      try {
        await transporter.sendMail({
          from: `"Mechanical Enterprise" <${GMAIL_USER}>`,
          to: email,
          subject: 'Your HVAC Appointment is Confirmed - Mechanical Enterprise',
          text: `Hi ${full_name.split(' ')[0]},\n\nYour appointment is confirmed!\n\nDate: ${preferred_date} at ${preferred_time}\nService: ${appointment_type || 'HVAC'}\nAddress: ${property_address || 'TBD'}\n\nOur team will confirm within 1 business hour.\nQuestions? Call (862) 419-1763\n\nMechanical Enterprise LLC`,
        });
      } catch(e) { console.error('Customer email error:', e.message); }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, eventId, calResult }) };

  } catch(e) {
    console.error('book-hvac fatal:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
