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
    user: 'inquiries@rosaliagroup.com',
    pass: process.env.GMAIL_PASS_INQUIRIES,
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
  if (data.preferred_date == null) {
    throw new Error('No preferred_date provided - skipping calendar');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: client.googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  // Parse date and time with proper timezone handling
  let startDateTime;
  let year, monthNum, day, hours, minutes;
  try {
    // Parse date - handles both YYYY-MM-DD (form) and "March 20 2026" (Vapi)
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
    hours = parseInt(timeParts[1]);
    minutes = parseInt(timeParts[2] || '0');
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

  // Get property address - Vapi sends "property", forms send "property_address" or "type"
  const propertyAddress = data.property_address || data.property || data.type || 'Appointment';
  
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

  // 18-hour advance notice check
  const nowCheck = new Date();
  const apptDate = new Date(year, monthNum, day, hours, minutes);
  const hoursUntil = (apptDate - nowCheck) / (1000 * 60 * 60);
  if (hoursUntil < 2) {
    const earliest = new Date(nowCheck.getTime() + 2 * 60 * 60 * 1000);
    const earliestStr = earliest.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Bookings require 2 hours advance notice. Earliest available: ${earliestStr}`, earliest: earliestStr }) };
  }

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

    if (!data.full_name && !data.phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: full_name and phone' }) };
    }

    // Normalize phone number
    if (data.phone) {
      let normalizedPhone = data.phone.toString().replace(/\D/g, '');
      if (normalizedPhone.length === 10) normalizedPhone = '+1' + normalizedPhone;
      else if (normalizedPhone.length === 11) normalizedPhone = '+' + normalizedPhone;
      else if (normalizedPhone.length === 12) normalizedPhone = '+' + normalizedPhone;
      data.phone = normalizedPhone;
    }

    // Normalize property field — Vapi sends "property", forms send "property_address" or "type"
    if (!data.type && (data.property || data.property_address)) {
      data.type = data.property || data.property_address;
    }

    // Get property address for notifications
    const propertyAddress = data.property_address || data.property || data.type || 'Iron 65 — 65 Mcwhorter St, Newark NJ';

    // Format date nicely — handles ISO (2026-05-23), long form (May 23 2026), or raw
    function formatDate(raw) {
      if (!raw) return 'TBD';
      // ISO format: 2026-05-23
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) {
        const d = new Date(`${raw}T12:00:00`);
        return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      }
      return raw; // already human-readable
    }

    const displayDate = formatDate(data.preferred_date);
    const displayTime = data.preferred_time || 'TBD';
    const displaySize = data.apartment_size || 'N/A';
    const displayBudget = data.budget || 'N/A';
    const displayMoveIn = formatDate(data.move_in_date);

    // 1. Create Google Calendar event (skip for specialist forms or missing date)
    let calendarEvent = null;
    if (data.status === 'needs_specialist' || !data.preferred_date) {
      console.log('Skipping calendar creation — status:', data.status, 'preferred_date:', data.preferred_date);
    } else {
      try {
        calendarEvent = await createCalendarEvent(client, data);
        console.log('Calendar event created:', calendarEvent?.id);
      } catch (err) {
        console.error('Calendar error:', err.message);
      }
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
      const callerMsg = `Your appointment is confirmed!\n\n${propertyAddress}\n${displayDate} at ${displayTime}\n\nRosalia Group will be in touch. See you then!`;
      try {
        const smsResult = await sendSMS(data.phone, callerMsg);
        console.log('Caller SMS sent:', smsResult.success);
      } catch (err) {
        console.error('Caller SMS error:', err.message);
      }
    }

    // 4. Send SMS to team (skip for null/healthcheck bookings)
    if (data.full_name && !data.full_name.includes('HEALTHCHECK') && client.notifyPhone) {
      let teamMsg = `New Booking!\n\nName: ${data.full_name}\nPhone: ${data.phone}\nEmail: ${data.email}\nProperty: ${propertyAddress}\nDate: ${displayDate} at ${displayTime}\nBudget: ${displayBudget}\nSize: ${displaySize}\nMove-In: ${displayMoveIn}\nIncome: ${data.income_qualifies}\nCredit: ${data.credit_qualifies}\n\nNotes: ${data.additional_notes}`;
      // Strip any URLs from team SMS
      teamMsg = teamMsg.replace(/https?:\/\/[^\s]+/gi, '').replace(/\s{2,}/g, ' ').trim();
      try {
        const teamSmsResult = await sendSMS(client.notifyPhone, teamMsg);
        console.log('Team SMS sent:', teamSmsResult.success);
      } catch (err) {
        console.error('Team SMS error:', err.message);
      }
    } else {
      console.log('Skipping team SMS — no valid full_name or healthcheck request');
    }

    // 5. Send email confirmation to caller (CC inquiries@rosaliagroup.com)
    if (data.email) {
      const firstName = (data.full_name || '').split(' ')[0] || 'there';
      const isSpecialist = data.status === 'needs_specialist';

      const emailSubject = isSpecialist
        ? 'We Received Your Inquiry — Rosalia Group'
        : 'Appointment Confirmed - Rosalia Group';

      const emailHeading = isSpecialist ? 'Inquiry Received' : 'Appointment Confirmed';
      const emailGreeting = isSpecialist
        ? 'Thank you for reaching out. A leasing specialist will be in touch with you shortly to discuss your needs and schedule a tour.'
        : 'Your private tour has been confirmed. We look forward to welcoming you.';
      const emailFooterNote = isSpecialist
        ? 'A member of our leasing team will contact you soon. If you have any questions in the meantime, simply reply to this email or call us at (862) 333-1681.'
        : 'Our leasing agent will reach out before your appointment to confirm. If you need to reschedule, simply reply to this email or call us at (862) 333-1681.';

      const detailsBox = isSpecialist
        ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;border:1px solid #333;border-radius:4px;margin-bottom:30px;">
              <tr><td style="padding:24px 28px;">
                <div style="color:#C9A84C;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px;">Your Inquiry</div>
                <div style="color:#E8E8E8;font-size:15px;margin-bottom:10px;">📍 <strong style="color:#C9A84C;">${propertyAddress}</strong></div>
                <div style="color:#E8E8E8;font-size:14px;margin-bottom:6px;color:#999;">Size: ${displaySize}</div>
                <div style="color:#999;font-size:14px;">Move-In: ${displayMoveIn}</div>
              </td></tr>
            </table>`
        : `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;border:1px solid #333;border-radius:4px;margin-bottom:30px;">
              <tr><td style="padding:24px 28px;">
                <div style="color:#C9A84C;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px;">Tour Details</div>
                <div style="color:#E8E8E8;font-size:15px;margin-bottom:10px;">📍 <strong style="color:#C9A84C;">${propertyAddress}</strong></div>
                <div style="color:#E8E8E8;font-size:15px;margin-bottom:10px;">📅 ${displayDate} at ${displayTime}</div>
                <div style="color:#E8E8E8;font-size:14px;margin-bottom:6px;color:#999;">Size: ${displaySize} &nbsp;|&nbsp; Budget: ${displayBudget}/mo</div>
                <div style="color:#999;font-size:14px;">Move-In: ${displayMoveIn}</div>
              </td></tr>
            </table>`;

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'Georgia',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid #C9A84C;border-radius:4px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#0A0A0A;padding:30px 40px;text-align:center;border-bottom:1px solid #C9A84C;">
            <div style="color:#C9A84C;font-size:11px;letter-spacing:4px;text-transform:uppercase;">Rosalia Group</div>
            <div style="color:#C9A84C;font-size:18px;margin-top:6px;">&#9670;</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <h1 style="color:#C9A84C;font-size:22px;font-weight:normal;letter-spacing:2px;text-transform:uppercase;margin:0 0 24px 0;">${emailHeading}</h1>
            <p style="color:#E8E8E8;font-size:15px;line-height:1.7;margin:0 0 24px 0;">Dear ${firstName},</p>
            <p style="color:#E8E8E8;font-size:15px;line-height:1.7;margin:0 0 30px 0;">${emailGreeting}</p>
            <!-- Details Box -->
            ${detailsBox}
            <p style="color:#999;font-size:13px;line-height:1.7;margin:0 0 30px 0;">${emailFooterNote}</p>
            <!-- CTA -->
            <div style="text-align:center;margin-bottom:30px;">
              <a href="https://book.rosaliagroup.com/iron65-reschedule" style="display:inline-block;background:#C9A84C;color:#0A0A0A;font-size:12px;letter-spacing:3px;text-transform:uppercase;padding:14px 32px;text-decoration:none;font-weight:bold;border-radius:2px;">Manage Appointment</a>
            </div>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#0A0A0A;padding:20px 40px;text-align:center;border-top:1px solid #222;">
            <div style="color:#555;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Rosalia Group &nbsp;|&nbsp; rosaliagroup.com</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;

      try {
        // Send to caller and CC to inquiries
        console.log('Sending confirmation email to:', data.email, '| GMAIL_USER:', process.env.GMAIL_USER ? 'set' : 'MISSING', '| GMAIL_PASS:', process.env.GMAIL_PASS ? 'set' : 'MISSING');
        await transporter.sendMail({
          from: '"Rosalia Group" <inquiries@rosaliagroup.com>',
          to: data.email,
          cc: 'inquiries@rosaliagroup.com',
          subject: emailSubject,
          html: emailHtml,
        });
        console.log('Email confirmation sent successfully to:', data.email);
      } catch (err) {
        console.error('Email error:', err.message);
      }
    }

    // Create task for specialist leads needing manual follow-up
    if (data.status === 'needs_specialist') {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            lead_name: data.full_name,
            lead_email: data.email,
            lead_phone: data.phone,
            task_type: 'specialist_followup',
            description: `Specialist inquiry submitted. Property: ${propertyAddress}. Size: ${data.apartment_size}. Move-in: ${data.move_in_date}. Budget: ${data.budget}. Needs manual follow-up — did not qualify for standard booking.`
          })
        });
        console.log('Specialist task created for:', data.full_name);
      } catch (err) {
        console.error('Task creation error:', err.message);
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

