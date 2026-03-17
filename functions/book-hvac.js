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
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  if (!credentials.client_email) return null;
  const { google } = require('googleapis');
  const auth = new google.auth.JWT(
    credentials.client_email, null, credentials.private_key,
    ['https://www.googleapis.com/auth/calendar']
  );
  const calendar = google.calendar({ version: 'v3', auth });

  // Parse date
  const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
  const dateParts = booking.preferred_date.toLowerCase().replace(/,/g,'').split(/\s+/);
  let year = 2026, month = 0, day = 1;
  for (const p of dateParts) {
    if (months[p] !== undefined) month = months[p];
    else if (/^\d{4}$/.test(p)) year = parseInt(p);
    else if (/^\d{1,2}$/.test(p)) day = parseInt(p);
  }

  // Parse time
  let [timePart, ampm] = booking.preferred_time.split(' ');
  let [hours, minutes] = timePart.split(':').map(Number);
  if (!minutes) minutes = 0;
  if (ampm?.toLowerCase() === 'pm' && hours !== 12) hours += 12;
  if (ampm?.toLowerCase() === 'am' && hours === 12) hours = 0;

  const startDate = new Date(year, month, day, hours, minutes);
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour

  const event = {
    summary: `[HVAC] ${booking.full_name} - ${booking.appointment_type || "Service"} - Mechanical Enterprise`,
    location: booking.property_address || '',
    description: `Service: ${booking.appointment_type || 'HVAC Appointment'}
Customer: ${booking.full_name}
Phone: ${booking.phone}
Email: ${booking.email || 'N/A'}
Property: ${booking.property_address || 'N/A'}
Type: ${booking.property_type || 'N/A'}
Issue: ${booking.issue_description || 'N/A'}`,
    start: { dateTime: startDate.toISOString(), timeZone: 'America/New_York' },
    end: { dateTime: endDate.toISOString(), timeZone: 'America/New_York' },
    attendees: booking.email ? [{ email: booking.email }, { email: SALES_EMAIL }] : [{ email: SALES_EMAIL }],
  };

  const res = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: event, sendUpdates: 'all' });
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
    try { eventId = await createCalendarEvent(booking); } catch(calErr) { console.error('Calendar non-blocking:', calErr.message); }

    // Save to Supabase bookings table
    await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        full_name, phone, email,
        preferred_date, preferred_time,
        property_address: property_address || 'Mechanical Enterprise',
        budget: budget || appointment_type,
        apartment_size: property_type || 'HVAC',
        move_in_date: issue_description,
        calendar_event_id: eventId,
        source: 'hvac',
      }),
    });

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

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, eventId }) };
  } catch(err) {
    console.error('book-hvac error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
