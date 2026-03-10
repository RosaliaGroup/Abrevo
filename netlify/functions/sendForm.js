// FILE: /netlify/functions/sendForm.js
// Sends Calendly booking link via SMS using Textbelt

const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';

// Calendly booking link
const CALENDLY_URL = 'https://calendly.com/ana-rosaliagroup/65-iron-tour';

// Short link (via Bitly)
const SHORT_LINK = 'bit.ly/46Hig9I';  // Make sure this points to your Calendly in Bitly!

exports.handler = async (event) => {
  const headers = { 
    'Access-Control-Allow-Origin': '*', 
    'Content-Type': 'application/json' 
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  console.log('=== SENDFORM FUNCTION CALLED ===');
  
  try {
    const payload = JSON.parse(event.body || '{}');
    console.log('Payload received:', payload);
    
    const { phone, type, email, name, tourDay, tourTime } = payload;
    
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

    // Build SMS message with SHORT LINK to Calendly
    let message;
    
    if (type === 'reschedule') {
      message = `Hi! Reschedule your Iron 65 tour: ${SHORT_LINK}`;
    } else {
      message = `Hi ${name || 'there'}! `;
      if (tourDay && tourTime) {
        message += `Your Iron 65 tour is ${tourDay} at ${tourTime}. `;
      }
      message += `Book your tour: ${SHORT_LINK}`;
    }

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
          message: 'SMS sent with Calendly booking link'
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
    console.error('❌ SENDFORM ERROR:', err);
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
