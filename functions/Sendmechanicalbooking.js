// FILE: /netlify/functions/sendMechanicalBooking.js
// Sends HVAC appointment booking link via SMS for Mechanical Enterprise

const TEXTBELT_KEY = 'YOUR_TEXTBELT_KEY_HERE';  // Get your own Textbelt key at textbelt.com

// UPDATE THIS with your Mechanical Enterprise Calendly link
const CALENDLY_URL = 'https://calendly.com/YOUR-CALENDLY-LINK/hvac-appointment';

// UPDATE THIS with your Bitly short link (create at bitly.com)
const SHORT_LINK = 'bit.ly/mechanical65';  // Change this to your actual Bitly link

exports.handler = async (event) => {
  const headers = { 
    'Access-Control-Allow-Origin': '*', 
    'Content-Type': 'application/json' 
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  console.log('=== MECHANICAL ENTERPRISE - SEND BOOKING FUNCTION CALLED ===');
  
  try {
    const payload = JSON.parse(event.body || '{}');
    console.log('Payload received:', payload);
    
    const { phone, serviceType, name, appointmentDate, appointmentTime } = payload;
    
    if (!phone) {
      console.error('Missing phone number');
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'phone required' }) 
      };
    }

    // Normalize phone
    let normalized = phone.toString().replace(/\D/g, '');
    if (!normalized.startsWith('+')) {
      normalized = '+1' + normalized;
    }
    console.log('Normalized phone:', normalized);

    // Build SMS message
    let message = `Hi ${name || 'there'}! `;
    
    if (serviceType) {
      message += `Thanks for scheduling your ${serviceType} service with Mechanical Enterprise. `;
    } else {
      message += `Thanks for calling Mechanical Enterprise! `;
    }
    
    if (appointmentDate && appointmentTime) {
      message += `Your appointment is ${appointmentDate} at ${appointmentTime}. `;
    }
    
    message += `Confirm your booking: ${SHORT_LINK}`;

    console.log('Message to send:');
    console.log(message);
    console.log('Short link points to:', CALENDLY_URL);
    console.log('Message length:', message.length, 'characters');
    console.log('---');

    // Send via Textbelt
    const textbeltResponse = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        phone: normalized, 
        message, 
        key: TEXTBELT_KEY 
      }),
    });

    const result = await textbeltResponse.json();
    console.log('Textbelt response:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('✅ SMS SENT SUCCESSFULLY');
      console.log('Text ID:', result.textId);
      console.log('Quota remaining:', result.quotaRemaining);

      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ 
          success: true, 
          calendlyUrl: CALENDLY_URL,
          shortLink: SHORT_LINK,
          textId: result.textId,
          quotaRemaining: result.quotaRemaining,
          message: 'SMS sent with booking link'
        }) 
      };
    } else {
      console.error('❌ TEXTBELT FAILED:', result.error);
      
      // Check for common errors
      if (result.error && result.error.includes('quota')) {
        console.error('⚠️ QUOTA EXCEEDED - Need to purchase more credits');
      }
      if (result.error && result.error.includes('invalid')) {
        console.error('⚠️ INVALID PHONE NUMBER:', normalized);
      }
      if (result.error && result.error.includes('verify') || result.error.includes('whitelist')) {
        console.error('⚠️ TEXTBELT ACCOUNT NOT VERIFIED - Need to whitelist at textbelt.com');
      }
      
      return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ 
          success: false, 
          error: result.error || 'Failed to send SMS'
        }) 
      };
    }
  } catch (err) {
    console.error('❌ SEND BOOKING ERROR:', err);
    console.error('Stack trace:', err.stack);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ 
        error: err.message,
        details: err.toString()
      }) 
    };
  }
};
