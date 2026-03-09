const { google } = require('googleapis');
const nodemailer = require('nodemailer');

// Configuration
const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';
const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const TEXTBELT_KEY = '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';
const ANA_PHONE = '+12014970225';

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// Helper: Send SMS
async function sendSMS(phone, message) {
  try {
    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
    });
    const result = await response.json();
    console.log('SMS sent to', phone, ':', result.success ? 'SUCCESS' : 'FAILED', result);
    return result;
  } catch (err) {
    console.error('SMS error:', err.message);
    return { success: false, error: err.message };
  }
}

// Helper: Check if two property strings match
function propertiesMatch(prop1, prop2) {
  if (!prop1 || !prop2) return false;
  
  // Normalize both strings: lowercase, remove extra spaces
  const normalize = (str) => str.toLowerCase().trim().replace(/\s+/g, ' ');
  
  const p1 = normalize(prop1);
  const p2 = normalize(prop2);
  
  // Direct match
  if (p1 === p2) return true;
  
  // Check if one contains the other (for partial matches like "473 Main" vs "473 Main Street, Orange NJ")
  if (p1.includes(p2) || p2.includes(p1)) return true;
  
  // Extract street numbers and compare (e.g., "473" from "473 Main Street")
  const extractNumber = (str) => {
    const match = str.match(/^\d+/);
    return match ? match[0] : null;
  };
  
  const num1 = extractNumber(p1);
  const num2 = extractNumber(p2);
  
  // If both have street numbers and they match, and both contain similar street names
  if (num1 && num2 && num1 === num2) {
    // Check if street names overlap (e.g., "main" appears in both)
    const words1 = p1.split(' ');
    const words2 = p2.split(' ');
    const commonWords = words1.filter(w => w.length > 3 && words2.includes(w));
    if (commonWords.length > 0) return true;
  }
  
  return false;
}

// Helper: Get calendar client
async function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

// Helper: Find and delete calendar events by phone number and property
async function deletePropertyEvents(calendar, booking, propertyAddress) {
  try {
    const now = new Date();
    const future = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days ahead
    
    console.log(`========== DELETE SEARCH ==========`);
    console.log(`Searching for phone: ${booking.phone}`);
    console.log(`Searching for property: ${propertyAddress}`);
    
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = res.data.items || [];
    console.log(`Found ${events.length} total events in calendar`);
    let deletedCount = 0;

    for (const event of events) {
      const summary = event.summary || '';
      const description = event.description || '';
      
      console.log(`--- Checking event: "${summary}"`);
      
      // Check if event contains the phone number
      const hasPhone = description.includes(booking.phone);
      console.log(`  Phone match: ${hasPhone ? 'YES' : 'NO'} (looking for "${booking.phone}")`);
      
      // Check property match in BOTH summary and description
      const matchesInSummary = propertiesMatch(summary, propertyAddress);
      const matchesInDescription = propertiesMatch(description, propertyAddress);
      const matchesProperty = matchesInSummary || matchesInDescription;
      
      console.log(`  Property match in summary: ${matchesInSummary ? 'YES' : 'NO'}`);
      console.log(`  Property match in description: ${matchesInDescription ? 'YES' : 'NO'}`);
      console.log(`  Overall property match: ${matchesProperty ? 'YES' : 'NO'}`);
      
      if (hasPhone && matchesProperty) {
        console.log(`  ✓✓✓ DELETING THIS EVENT ✓✓✓`);
        await calendar.events.delete({
          calendarId: CALENDAR_ID,
          eventId: event.id,
        });
        deletedCount++;
      } else {
        console.log(`  ✗ Skipping (no match)`);
      }
    }

    console.log(`========== DELETED ${deletedCount} EVENT(S) ==========`);
    return deletedCount;
    
  } catch (err) {
    console.error('Error deleting events:', err.message);
    return 0;
  }
}

// Helper: Create new calendar event
async function createCalendarEvent(calendar, booking, newDate, newTime) {
  let startDateTime;
  try {
    // Parse date: "April 28 2026"
    const dateParts = newDate.match(/(\w+)\s+(\d+)\s+(\d+)/);
    if (!dateParts) throw new Error('Invalid date format');
    const month = dateParts[1];
    const day = parseInt(dateParts[2]);
    const year = parseInt(dateParts[3]);
    
    // Parse time: "2:00 PM"
    const timeParts = newTime.match(/(\d+):?(\d*)?\s*(AM|PM)/i);
    if (!timeParts) throw new Error('Invalid time format');
    let hours = parseInt(timeParts[1]);
    const minutes = parseInt(timeParts[2] || '0');
    const period = timeParts[3].toUpperCase();
    
    // Convert to 24-hour format
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    // Build ISO string manually for America/New_York
    // Use Date.UTC then offset for EDT (-4 hours) or EST (-5 hours)
    // For April, we're in EDT (UTC-4)
    const monthMap = {
      'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5,
      'July': 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11
    };
    
    const monthNum = monthMap[month];
    if (monthNum === undefined) throw new Error('Invalid month');
    
    // Create date in EDT (add 4 hours to get UTC)
    startDateTime = new Date(Date.UTC(year, monthNum, day, hours + 4, minutes, 0));
    
  } catch (e) {
    console.error('Date parsing error:', e.message);
    throw new Error('Invalid date or time format');
  }
  
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  const description = `
RESCHEDULED APPOINTMENT

Phone: ${booking.phone || 'N/A'}
Email: ${booking.email || 'N/A'}
Budget: ${booking.budget || 'N/A'}
Apartment Size: ${booking.apartment_size || 'N/A'}
Preferred Area: ${booking.preferred_area || 'N/A'}
Move-In Date: ${booking.move_in_date || 'N/A'}
Income: ${booking.income_qualifies || 'N/A'}
Credit: ${booking.credit_qualifies || 'N/A'}

Notes:
${booking.additional_notes || 'None'}
  `.trim();

  const event = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: {
      summary: `${booking.full_name || 'Guest'} - ${booking.type || 'Appointment'}`,
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
    const { phone, new_date, new_time, property } = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!phone || !new_date || !new_time) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: phone, new_date, new_time' }),
      };
    }

    // Normalize phone
    let normalizedPhone = phone.toString().replace(/\D/g, '');
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+1' + normalizedPhone;
    }

    console.log('========================================');
    console.log('RESCHEDULE REQUEST');
    console.log('========================================');
    console.log('Phone:', normalizedPhone);
    console.log('New Date:', new_date);
    console.log('New Time:', new_time);
    console.log('Property:', property);
    console.log('========================================');

    // Find the booking in Supabase
    const findUrl = `${SUPABASE_URL}/rest/v1/bookings?phone=eq.${encodeURIComponent(normalizedPhone)}&order=created_at.desc`;
    const findRes = await fetch(findUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    const bookings = await findRes.json();

    if (!bookings || bookings.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, message: 'No booking found for this phone number' }),
      };
    }

    console.log(`Found ${bookings.length} booking(s) for this phone number`);

    // If property specified, find the specific booking for that property
    let booking;
    if (property) {
      booking = bookings.find(b => propertiesMatch(b.type, property));
      
      if (!booking) {
        console.log(`❌ No booking found matching property: "${property}"`);
        console.log('Available bookings:', bookings.map(b => `"${b.type}"`).join(', '));
        // Fall back to most recent booking
        booking = bookings[0];
        console.log(`Using most recent booking instead: "${booking.type}"`);
      } else {
        console.log(`✓ Found matching booking: "${booking.type}"`);
      }
    } else {
      // No property specified, use most recent
      booking = bookings[0];
      console.log('No property specified, using most recent booking:', booking.type);
    }

    console.log('Selected booking ID:', booking.id);
    console.log('Selected booking property:', booking.type);

    // Get calendar client
    const calendar = await getCalendarClient();

    // Delete OLD calendar event(s) for THIS SPECIFIC PROPERTY ONLY
    const propertyToReschedule = property || booking.type;
    const deletedCount = await deletePropertyEvents(calendar, booking, propertyToReschedule);
    
    if (deletedCount === 0) {
      console.log('⚠️  WARNING: No calendar events were deleted. Creating new event anyway.');
    }

    // Create NEW calendar event
    let newEvent = null;
    try {
      newEvent = await createCalendarEvent(calendar, booking, new_date, new_time);
      console.log('✓ New calendar event created:', newEvent.id);
    } catch (err) {
      console.error('❌ Error creating calendar event:', err.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create calendar event: ' + err.message }),
      };
    }

    // Update Supabase record
    const updateUrl = `${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`;
    await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        preferred_date: new_date,
        preferred_time: new_time,
        calendar_event_id: newEvent?.id || null,
      }),
    });

    console.log('✓ Supabase updated for booking:', booking.id);

    // Send confirmation EMAIL to caller (CC inquiries)
    if (booking.email) {
      const emailHtml = `
        <h2>Appointment Rescheduled</h2>
        <p>Dear ${booking.full_name},</p>
        <p>Your showing at <strong>${booking.type}</strong> has been rescheduled to:</p>
        <p><strong>${new_date} at ${new_time}</strong></p>
        <p>Budget: ${booking.budget || 'N/A'}<br>
        Apartment Size: ${booking.apartment_size || 'N/A'}<br>
        Move-In Date: ${booking.move_in_date || 'N/A'}</p>
        <p>We look forward to seeing you!</p>
        <p>Best regards,<br>Rosalia Group<br>(862) 333-1681</p>
      `;

      try {
        await transporter.sendMail({
          from: '"Rosalia Group" <ana@rosaliagroup.com>',
          to: booking.email,
          cc: 'inquiries@rosaliagroup.com',
          subject: 'Appointment Rescheduled - Rosalia Group',
          html: emailHtml,
        });
        console.log('✓ Reschedule email sent to:', booking.email, '+ CC inquiries');
      } catch (err) {
        console.error('❌ Email error:', err.message);
      }
    }

    // Send SMS to CALLER
    console.log('Sending SMS to caller:', normalizedPhone);
    const callerMsg = `Your appointment has been rescheduled!\n\n${booking.type || 'Appointment'}\n${new_date} at ${new_time}\n\nRosalia Group will be in touch. See you then!`;
    const callerSMS = await sendSMS(normalizedPhone, callerMsg);
    console.log('Caller SMS result:', callerSMS);

    // Send SMS to TEAM (Ana)
    console.log('Sending SMS to team:', ANA_PHONE);
    const teamMsg = `Appointment Rescheduled!\n\nName: ${booking.full_name}\nPhone: ${normalizedPhone}\nEmail: ${booking.email || 'N/A'}\nProperty: ${booking.type}\nNEW Date: ${new_date} at ${new_time}\nBudget: ${booking.budget || 'N/A'}\nSize: ${booking.apartment_size || 'N/A'}\nMove-In: ${booking.move_in_date || 'N/A'}\nIncome: ${booking.income_qualifies || 'N/A'}\nCredit: ${booking.credit_qualifies || 'N/A'}`;
    const teamSMS = await sendSMS(ANA_PHONE, teamMsg);
    console.log('Team SMS result:', teamSMS);

    console.log('========================================');
    console.log('RESCHEDULE COMPLETE');
    console.log('========================================');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Rescheduled to ${new_date} at ${new_time}`,
        eventId: newEvent?.id,
        deletedEvents: deletedCount,
      }),
    };

  } catch (err) {
    console.error('========================================');
    console.error('RESCHEDULE ERROR');
    console.error('========================================');
    console.error(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};