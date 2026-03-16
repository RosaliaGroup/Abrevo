const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const CALENDAR_ID = 'c_1f409dda06448aec70284831065590c2ea0c7763ea02fb641e32bea7b49f4b8d@group.calendar.google.com';
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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { phone, new_date, new_time, full_name } = JSON.parse(event.body || '{}');
    if (!phone || !new_date || !new_time) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: phone, new_date, new_time' }) };
    }

    // Normalize phone
    let normalizedPhone = phone.replace(/\D/g, '');
    if (normalizedPhone.length === 10) normalizedPhone = '+1' + normalizedPhone;
    else if (normalizedPhone.length === 11) normalizedPhone = '+' + normalizedPhone;

    // Find booking in Supabase
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(normalizedPhone)}&source=eq.hvac&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const bookings = await findRes.json();
    
    let eventId = null;
    let customerName = full_name || 'Customer';
    let customerEmail = null;

    if (Array.isArray(bookings) && bookings.length > 0) {
      const booking = bookings[0];
      eventId = booking.calendar_event_id;
      customerName = booking.full_name || full_name || 'Customer';
      customerEmail = booking.email;

      // Update Supabase
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ preferred_date: new_date, preferred_time: new_time }),
      });
    }

    // Update Google Calendar event if found
    if (eventId) {
      try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
        const auth = new google.auth.JWT(
          credentials.client_email, null, credentials.private_key,
          ['https://www.googleapis.com/auth/calendar']
        );
        const calendar = google.calendar({ version: 'v3', auth });

        // Parse new date/time
        const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
        const dateParts = new_date.toLowerCase().replace(/,/g,'').split(/\s+/);
        let year = 2026, month = 0, day = 1;
        for (const p of dateParts) {
          if (months[p] !== undefined) month = months[p];
          else if (/^\d{4}$/.test(p)) year = parseInt(p);
          else if (/^\d{1,2}$/.test(p)) day = parseInt(p);
        }
        let [timePart, ampm] = new_time.split(' ');
        let [hours, minutes] = timePart.split(':').map(Number);
        if (!minutes) minutes = 0;
        if (ampm?.toLowerCase() === 'pm' && hours !== 12) hours += 12;
        if (ampm?.toLowerCase() === 'am' && hours === 12) hours = 0;

        const startDate = new Date(year, month, day, hours, minutes);
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

        await calendar.events.patch({
          calendarId: CALENDAR_ID,
          eventId,
          resource: {
            start: { dateTime: startDate.toISOString(), timeZone: 'America/New_York' },
            end: { dateTime: endDate.toISOString(), timeZone: 'America/New_York' },
          },
          sendUpdates: 'all',
        });
      } catch(calErr) {
        console.error('Calendar update error:', calErr.message);
      }
    }

    // Send SMS confirmation
    if (normalizedPhone) {
      await sendSMS(normalizedPhone, `Hi ${customerName.split(' ')[0]}! Your Mechanical Enterprise appointment has been rescheduled to ${new_date} at ${new_time}. Questions? Call (862) 419-1763`);
    }

    // Notify sales team
    await transporter.sendMail({
      from: `"Mechanical Enterprise Booking" <${FROM_EMAIL}>`,
      to: SALES_EMAIL,
      subject: `Appointment Rescheduled â€” ${customerName} | ${new_date} at ${new_time}`,
      text: `HVAC Appointment Rescheduled\n\nCustomer: ${customerName}\nPhone: ${normalizedPhone}\nNew Date: ${new_date}\nNew Time: ${new_time}`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: `Rescheduled to ${new_date} at ${new_time}` }) };
  } catch(err) {
    console.error('reschedule-hvac error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
