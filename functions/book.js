const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';

// Load Google credentials from environment variable
const CREDENTIALS = JSON.parse(process.env.GOOGLE_CALENDAR_CREDENTIALS || '{}');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      full_name,
      phone,
      email,
      type,
      preferred_date,
      preferred_time,
      budget,
      apartment_size,
      preferred_area,
      move_in_date,
      income_qualifies,
      credit_qualifies,
      additional_notes
    } = body;

    const client = event.queryStringParameters?.client || 'rosalia';
    const notifyPhone = '+16462269189'; // Ana's phone

    console.log('📥 Booking request received:', { full_name, phone, email, type, client });

    if (!full_name || !phone || !email || !type || !preferred_date || !preferred_time) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    // Create Google Calendar event
    const auth = new google.auth.GoogleAuth({
      credentials: CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    const calendar = google.calendar({ version: 'v3', auth });

    const eventStartTime = new Date(`${preferred_date} ${preferred_time}`);
    const eventEndTime = new Date(eventStartTime.getTime() + 30 * 60000); // 30 min

    const event = {
      summary: `${full_name} — ${type}`,
      description: `Phone: ${phone}\nEmail: ${email}\nBudget: ${budget}\nApartment Size: ${apartment_size}\nMove-In Date: ${move_in_date}\nIncome: ${income_qualifies}\nCredit: ${credit_qualifies}${additional_notes ? `\n\nNotes: ${additional_notes}` : ''}`,
      start: { dateTime: eventStartTime.toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: eventEndTime.toISOString(), timeZone: 'America/New_York' },
      attendees: [{ email }],
    };

    const calendarResponse = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: event,
      sendUpdates: 'all',
    });

    const eventId = calendarResponse.data.id;
    console.log('📅 Calendar event created:', eventId);

    // Save to Supabase
    const supabaseResponse = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        full_name,
        phone,
        email,
        type,
        preferred_date,
        preferred_time,
        budget,
        apartment_size,
        preferred_area,
        move_in_date,
        income_qualifies,
        credit_qualifies,
        additional_notes,
        client,
        calendar_event_id: eventId,
      }),
    });

    if (!supabaseResponse.ok) {
      const errorText = await supabaseResponse.text();
      console.error('❌ Supabase error:', errorText);
      throw new Error(`Supabase error: ${errorText}`);
    }

    console.log('💾 Saved to Supabase');

    // Send SMS confirmation to caller
    const callerSmsBody = `Hi ${full_name}! Your showing at ${type} is confirmed for ${preferred_date} at ${preferred_time}. Ana will contact you 1 day before. Questions? Call (201) 449-6850. - Rosalia Group`;
    
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: phone,
        message: callerSmsBody,
        key: TEXTBELT_KEY,
      }),
    });

    console.log('📱 SMS sent to caller:', phone);

    // Send SMS notification to Ana
    const anaSmsBody = `New Booking!\n${full_name}\n${type}\n${preferred_date} at ${preferred_time}\nPhone: ${phone}\nBudget: ${budget}\nIncome: ${income_qualifies}\nCredit: ${credit_qualifies}${additional_notes ? `\nNotes: ${additional_notes}` : ''}`;
    
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: notifyPhone,
        message: anaSmsBody,
        key: TEXTBELT_KEY,
      }),
    });

    console.log('📱 SMS notification sent to Ana:', notifyPhone);

    // Send email notification to inquiries@rosaliagroup.com
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: 'inquiries@rosaliagroup.com',
      subject: 'New Booking Received',
      text: `
New Booking Received

Name: ${full_name}
Phone: ${phone}
Email: ${email}
Property: ${type}
Date & Time: ${preferred_date} at ${preferred_time}
Budget: ${budget}
Apartment Size: ${apartment_size}
Move-In Date: ${move_in_date}
Income Qualifies: ${income_qualifies}
Credit Qualifies: ${credit_qualifies}${additional_notes ? `\n\nNotes: ${additional_notes}` : ''}
      `.trim(),
    };

    await transporter.sendMail(mailOptions);
    console.log('📧 Email sent to inquiries@rosaliagroup.com');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Booking confirmed',
        event_id: eventId,
      }),
    };

  } catch (error) {
    console.error('❌ Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
