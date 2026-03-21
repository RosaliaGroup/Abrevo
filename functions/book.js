const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Client configurations
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

const TEXTBELT_KEY = '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

async function sendSMS(phone, message) {
  if (!phone) return { success: false };
  // Normalize phone - add +1 if needed
  let normalizedPhone = phone.toString().replace(/\D/g, '');
  if (normalizedPhone.length === 10) normalizedPhone = '+1' + normalizedPhone;
  else if (normalizedPhone.length === 11) normalizedPhone = '+' + normalizedPhone;
  else normalizedPhone = '+' + normalizedPhone;

  const response = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: normalizedPhone,
      message,
      key: TEXTBELT_KEY,
    }),
  });
  const result = await response.json();
  console.log('SMS response:', JSON.stringify(result));
  return result;
}

async function createCalendarEvent(client, data) {
  const auth = new google.auth.GoogleAuth({
    credentials: client.googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  // Parse date and time with proper timezone handling
  let startDateTime;
  try {
    // Parse date - handles both YYYY-MM-DD (form) and "March 20 2026" (Vapi)
    let year, monthNum, day;
    const isoMatch = data.preferred_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const textMatch = data.preferred_date.match(/(\w+)\s+(\d+)[,\s]+(\d{4})/);
    if (isoMatch) {
      year = parseInt(isoMatch[1]);
      monthNum = parseInt(isoMatch[2]) - 1;
      day = parseInt(isoMatch[3]);
    } else if (textMatch) {
      const monthMap = {'January':0,'February':1,'March':2,'April':3,'May':4,'June':5,'July':6,'August':7,'September':8,'October':9,'November':10,'December':11,'Jan':0,'Feb':1,'Mar':2,'Apr':3,'Jun':5,'Jul':6,'Aug':7,'Sep':8,'Oct':9,'Nov':10,'Dec':11};
      monthNum = monthMap[textMatch[1]];
      day = parseInt(textMatch[2]);
      year = parseInt(textMatch[3]);
      if (monthNum === undefined) throw new Error('Invalid month: ' + textMatch[1]);
    } else {
      throw new Error('Unrecognized date format: ' + data.preferred_date);
    }
    console.log('Parsed date parts:', year, monthNum+1, day);
    
    // Parse time
    const timeParts = data.preferred_time.match(/(\d+):?(\d*)?\s*(AM|PM)/i);
    if (!timeParts) throw new Error('Invalid time format');
    let hours = parseInt(timeParts[1]);
    const minutes = parseInt(timeParts[2] || '0');
    const period = timeParts[3].toUpperCase();
    
    // Convert to 24-hour format
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    // monthNum and day already set above
    
    // Create date in Eastern Time (UTC-4 EDT)
    startDateTime = new Date(Date.UTC(year, monthNum, day, hours + 4, minutes, 0));
    console.log('Booking date/time:', year, monthNum+1, day, hours, minutes, '-> UTC:', startDateTime.toISOString());

    // Reject bookings in the past
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    if (startDateTime < nowET) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cannot book appointments in the past. Please select a future date and time.' }),
      };
    }
    
  } catch(e) {
    console.error('Date parsing error:', e.message);
    // Fallback to tomorrow at noon
    startDateTime = new Date();
    startDateTime.setDate(startDateTime.getDate() + 1);
    startDateTime.setHours(12, 0, 0, 0);
  }

  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  // Get property address - use property_address field if available, fallback to type
  const propertyAddress = data.property_address || data.type || 'Appointment';
  
  // Format: Caller Name - Building Address
  const summary = `${data.full_name || 'Guest'} - ${propertyAddress}`;

  const description = `
Phone: ${data.phone || 'N/A'}
Email: ${data.email || 'N/A'}
Budget: ${data.budget || 'N/A'}
Apartment Size: ${data.apartment_size || 'N/A'}
Property: ${propertyAddress}
Move-In Date: ${data.move_in_date || 'N/A'}
Income Qualifies: ${data.income_qualifies || 'N/A'}
Credit Qualifies: ${data.credit_qualifies || 'N/A'}

Notes:
${data.additional_notes || 'N/A'}
  `.trim();

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
    console.log('Booking data received:', JSON.stringify(data));

    // Normalize phone number
    if (data.phone) {
      let normalizedPhone = data.phone.toString().replace(/\D/g, '');
      if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = '+1' + normalizedPhone;
      }
      data.phone = normalizedPhone;
    }

    // Get property address for notifications
    const propertyAddress = data.property_address || data.type || 'the property';

    // 1. Create Google Calendar event
    let calendarEvent = null;
    try {
      calendarEvent = await createCalendarEvent(client, data);
      console.log('Calendar event created:', calendarEvent?.id);
    } catch (err) {
      console.error('Calendar error:', err.message);
    }

    // 2. Save to Supabase
    try {
      const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          full_name: data.full_name,
          phone: data.phone,
          email: data.email,
          type: data.type,
          preferred_date: data.preferred_date,
          preferred_time: data.preferred_time,
          budget: data.budget,
          apartment_size: data.apartment_size,
          preferred_area: data.preferred_area,
          move_in_date: data.move_in_date,
          income_qualifies: data.income_qualifies,
          credit_qualifies: data.credit_qualifies,
          additional_notes: data.additional_notes,
          client: clientId,
          calendar_event_id: calendarEvent?.id,
        }),
      });
      console.log('Saved to Supabase');
    } catch (err) {
      console.error('Supabase error:', err.message);
    }

    // 3. Send SMS to caller
    if (data.phone) {
      const callerMsg = `Your appointment is confirmed!\n\n${propertyAddress}\n${data.preferred_date} at ${data.preferred_time}\n\nRosalia Group will be in touch. See you then!`;
      try {
        const smsResult = await sendSMS(data.phone, callerMsg);
        console.log('Caller SMS sent:', smsResult.success);
      } catch (err) {
        console.error('Caller SMS error:', err.message);
      }
    }

    // 4. Send SMS to team
    const teamMsg = `New Booking!\n\nName: ${data.full_name}\nPhone: ${data.phone}\nEmail: ${data.email}\nProperty: ${propertyAddress}\nDate: ${data.preferred_date} at ${data.preferred_time}\nBudget: ${data.budget}\nSize: ${data.apartment_size}\nMove-In: ${data.move_in_date}\nIncome: ${data.income_qualifies}\nCredit: ${data.credit_qualifies}\n\nNotes: ${data.additional_notes}`;
    try {
      const teamSmsResult = await sendSMS(client.notifyPhone, teamMsg);
      console.log('Team SMS sent:', teamSmsResult.success);
    } catch (err) {
      console.error('Team SMS error:', err.message);
    }

    // 5. Send email confirmation to caller (CC inquiries@rosaliagroup.com)
    if (data.email) {
      const emailHtml = `
        <h2>Appointment Confirmed</h2>
        <p>Dear ${data.full_name},</p>
        <p>Your showing at <strong>${propertyAddress}</strong> is confirmed for:</p>
        <p><strong>${data.preferred_date} at ${data.preferred_time}</strong></p>
        <p>Budget: ${data.budget}<br>
        Apartment Size: ${data.apartment_size}<br>
        Move-In Date: ${data.move_in_date}</p>
        <p>We look forward to seeing you!</p>
        <p>Best regards,<br>Rosalia Group<br>(862) 333-1681</p>
      `;

      try {
        // Send to caller and CC to inquiries
        await transporter.sendMail({
          from: '"Rosalia Group" <ana@rosaliagroup.com>',
          to: data.email,
          cc: 'inquiries@rosaliagroup.com',
          subject: 'Appointment Confirmed - Rosalia Group',
          html: emailHtml,
        });
        console.log('Email sent to caller');
      } catch (err) {
        console.error('Email error:', err.message);
      }
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