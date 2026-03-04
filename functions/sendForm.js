// FILE: /netlify/functions/sendForm.js
// Updated version with better link handling for carrier restrictions

const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const BASE_URL = 'https://silver-ganache-1ee2ca.netlify.app';

// OPTION 1: Create short links in Bitly and use them here
const SHORT_LINKS = {
  booking: 'bit.ly/iron65book',      // Create this: silver-ganache-1ee2ca.netlify.app/booking-form
  reschedule: 'bit.ly/iron65change'  // Create this: silver-ganache-1ee2ca.netlify.app/reschedule-form
};

// OPTION 2: Use link-free messages
const USE_SHORT_LINKS = false; // Set to true when you have Bitly links set up

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

    // Determine form type
    const formType = type === 'reschedule' ? 'reschedule' : 'booking';
    const formPath = formType === 'reschedule' ? '/reschedule-form' : '/booking-form';
    const formUrl = `${BASE_URL}${formPath}?phone=${encodeURIComponent(normalized)}`;
    
    console.log('Form type:', formType);
    console.log('Form URL:', formUrl);

    // Build message based on configuration
    let message;
    
    if (USE_SHORT_LINKS) {
      // Use shortened links (less likely to be blocked)
      const shortLink = SHORT_LINKS[formType];
      message = formType === 'reschedule'
        ? `Hi! Reschedule your Iron 65 tour: ${shortLink}\n\nQuestions? (862) 333-1681`
        : `Hi ${name || 'there'}! Complete your Iron 65 tour booking: ${shortLink}\n\nQuestions? (862) 333-1681`;
    } else {
      // NO LINKS - Send confirmation only, email contains the link
      message = formType === 'reschedule'
        ? `Hi! To reschedule your Iron 65 tour, check your email at ${email || 'the address on file'} or call (862) 333-1681`
        : `Hi ${name || 'there'}! Your Iron 65 tour for ${tourDay || 'your selected date'} at ${tourTime || 'your selected time'} is confirmed. Booking link sent to ${email || 'your email'}. Questions? (862) 333-1681`;
    }

    console.log('Message to send:');
    console.log(message);
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

      // If not using links in SMS, trigger email with the link
      if (!USE_SHORT_LINKS && email) {
        console.log('Triggering email with booking link...');
        try {
          await fetch(`${BASE_URL}/.netlify/functions/send-booking-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: email,
              name: name,
              tourDay: tourDay,
              tourTime: tourTime,
              formUrl: formUrl,
              formType: formType
            })
          });
          console.log('✅ Email trigger sent');
        } catch (emailErr) {
          console.error('⚠️ Email trigger failed (non-critical):', emailErr.message);
        }
      }

      return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ 
          success: true, 
          formType, 
          formUrl,
          textId: result.textId,
          quotaRemaining: result.quotaRemaining
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
