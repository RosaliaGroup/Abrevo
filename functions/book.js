const CLIENTS = {
  rosalia: {
    calendarId: 'inquiries@rosaliagroup.com',
    notifyPhone: '+16462269189',
    notifyName: 'Ana',
    teamName: 'Rosalia Group',
    rescheduleLink: 'calendly.com/ana-rosaliagroup/apartment-tour-request',
  }
};

const TEXTBELT_KEY = '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';

async function sendSMS(phone, message) {
  const response = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message, key: TEXTBELT_KEY }),
  });
  return response.json();
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
    
    console.log('Incoming data:', JSON.stringify(data));

    const name = data.full_name || data.name || 'Guest';
    let phone = data.phone || data.caller_phone || '';
    if (phone && !phone.startsWith('+')) phone = '+1' + phone;
    const email = data.email || data.caller_email || '';
    const type = data.type || data.appointment_type || 'Appointment';
    const date = data.preferred_date || data.date || '';
    const time = data.preferred_time || data.time || '';

    // Text caller confirmation
    if (phone) {
      const callerMsg = `Appointment confirmed!\n\n📍 ${type}\n📅 ${date} at ${time}\n\nNeed to reschedule? ${client.rescheduleLink}`;
      await sendSMS(phone, callerMsg);
    }

    // Text Ana with full details
    const teamMsg = `New Booking!\n\nName: ${name}\nPhone: ${phone}\nEmail: ${email}\nProperty: ${type}\nDate: ${date} at ${time}\nBudget: ${data.budget || 'N/A'}\nArea: ${data.preferred_area || data.area || 'N/A'}\nMove-In: ${data.move_in_date || 'N/A'}\nIncome: ${data.income_qualifies || 'N/A'}\nCredit: ${data.credit_qualifies || 'N/A'}\n\nNotes: ${data.additional_notes || data.notes || 'N/A'}`;
    await sendSMS(client.notifyPhone, teamMsg);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
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
