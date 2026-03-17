const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com'; // Rosalia calendar
const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = process.env.TEXTBELT_KEY || '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const SALES_EMAIL = 'sales@mechanicalenterprise.com';
const FROM_EMAIL = 'inquiries@rosaliagroup.com';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

async function sendSMS(phone, message) {
  if (!phone) return;
  let p = phone.toString().replace(/\D/g, '');
  if (p.length === 10) p = '+1' + p;
  else if (p.length === 11 && !p.startsWith('+')) p = '+' + p;
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: p, message, key: TEXTBELT_KEY }),
    });
  } catch(e) { console.error('SMS error:', e.message); }
}

async function createCalendarEvent(booking) {
  const googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  if (!googleCredentials.client_email) { console.error('No Google credentials'); return null; }
  
  const auth = new google.auth.GoogleAuth({
    credentials: googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  let startDateTime;
  try {
    let year, monthNum, day;
    const months = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
    const textMatch = (booking.preferred_date || '').match(/(\w+)\s+(\d+)[,\s]+(\d{4})/);
    const isoMatch = (booking.preferred_date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      year = parseInt(isoMatch[1]); monthNum = parseInt(isoMatch[2]) - 1; day = parseInt(isoMatch[3]);
    } else if (textMatch) {
      const monthName = textMatch[1].toLowerCase();
      monthNum = months[monthName] ?? 0;
      day = parseInt(textMatch[2]);
      year = parseInt(textMatch[3]);
    } else {
      console.error('Could not parse date:', booking.preferred_date);
      return null;
    }

    let hours = 10, minutes = 0;
    const timeMatch = (booking.preferred_time || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (timeMatch) {
      hours = parseInt(timeMatch[1]);
      minutes = parseInt(timeMatch[2]);
      if (timeMatch[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (timeMatch[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
    }

    const etOffset = -4; // EDT
    startDateTime = new Date(Date.UTC(year, monthNum, day, hours - etOffset, minutes));
  } catch(e) { return 'DATE_PARSE_ERROR:' + e.message; }

  const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

  const attendees = [{'email': SALES_EMAIL}];
  if (booking.email && !booking.email.includes('convo.zillow')) attendees.push({'email': booking.email});

  const event = {
    summary: `[HVAC] ${booking.full_name} - ${booking.appointment_type || 'Service'} - Mechanical Enterprise`,
    location: booking.property_address || '',
    description: `Service: ${booking.appointment_type || 'N/A'}\nCustomer: ${booking.full_name}\nPhone: ${booking.phone}\nEmail: ${booking.email || 'N/A'}\nProperty: ${booking.property_address || 'N/A'}\nType: ${booking.property_type || 'N/A'}\nIssue: ${booking.issue_description || 'N/A'}`,
    start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
    end: { dateTime: endDateTime.toISOString(), timeZone: 'America/New_York' },
    attendees,
  };

  const res = await calendar.events.insert({ calendarId: '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com', resource: event, sendUpdates: 'none' });
  console.log('Calendar event created:', res.data.id);
  return res.data.id;
}


exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const booking = JSON.parse(event.body || '{}');
    const { full_name, phone, email, preferred_date, preferred_time, property_address,
            appointment_type, property_type, issue_description, budget } = booking;

    if (!full_name || !preferred_date || !preferred_time) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Create calendar event - non-blocking
    let eventId = null;
    let calendarError = null;
    try { const cr = await createCalendarEvent(booking); if (cr && !cr.startsWith('DATE')) eventId = cr; } catch(calErr) { console.error('Calendar error:', calErr.message); }

    // Save to Supabase bookings table
    try {
      const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=minimal' },
        body: JSON.stringify({
          full_name, phone, email,
          preferred_date, preferred_time,
          budget: appointment_type || 'free_consultation',
          apartment_size: property_type || 'HVAC',
          preferred_area: property_address || 'N/A',
          move_in_date: issue_description || 'N/A',
          calendar_event_id: eventId,
          client: 'mechanical',
        }),
      });
      console.log('Supabase status:', sbRes.status);
    } catch(sbErr) { console.error('Supabase error:', sbErr.message); }

    // Send SMS confirmation to customer
    if (phone) {
      await sendSMS(phone, `Hi ${full_name.split(' ')[0]}! Your Mechanical Enterprise appointment is confirmed for ${preferred_date} at ${preferred_time}. Service: ${appointment_type || 'HVAC'}. Address: ${property_address || 'TBD'}. Questions? Call (862) 419-1763`);
    }

    // Send email to sales team
    try { await transporter.sendMail({
      from: `"Mechanical Enterprise Booking" <${FROM_EMAIL}>`,
      to: SALES_EMAIL,
      subject: `New HVAC Appointment - ${full_name} | ${preferred_date} at ${preferred_time}`,
      text: `New HVAC Appointment - ${full_name}\nPhone: ${phone}\nEmail: ${email || 'N/A'}\nService: ${appointment_type || 'N/A'}\nProperty: ${property_address || 'N/A'}\nType: ${property_type || 'N/A'}\nIssue: ${issue_description || 'N/A'}\nDate: ${preferred_date} at ${preferred_time}\n\nCalendar event created`,
    }); } catch(se) { console.error('Sales email non-blocking:', se.message); }

    // Send confirmation email to customer
    if (email) {
      try { await transporter.sendMail({
        from: `"Mechanical Enterprise" <${FROM_EMAIL}>`,
        to: email,
        subject: 'Your HVAC Appointment is Confirmed - Mechanical Enterprise',
        text: `Dear ${full_name},\n\nYour HVAC appointment has been confirmed.\n\nDate: ${preferred_date}\nTime: ${preferred_time}\nService: ${appointment_type || 'HVAC Appointment'}\nAddress: ${property_address || 'TBD'}\n\nOur team will confirm within 1 business hour. Questions? Call (862) 419-1763 or email sales@mechanicalenterprise.com.\n\nThank you,\nMechanical Enterprise LLC\n(862) 419-1763 | mechanicalenterprise.com`,
      }); } catch(ce) { console.error('Cust email non-blocking:', ce.message); }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, eventId, calErr: eventId && eventId.startsWith('ERR:') ? eventId : null }) };
  } catch(err) {
    console.error('book-hvac error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
