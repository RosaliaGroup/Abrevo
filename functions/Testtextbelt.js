// ============================================
// TEXTBELT DIAGNOSTIC TEST
// ============================================
// Copy this entire file and run it in:
// - Browser Console (F12 → Console tab)
// - Node.js terminal: node test-textbelt.js
// ============================================

const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';

// CHANGE THIS TO YOUR PHONE NUMBER FOR TESTING
const TEST_PHONE = '+15551234567'; // ← PUT YOUR NUMBER HERE

console.log('====================================');
console.log('TEXTBELT DIAGNOSTIC TEST');
console.log('====================================\n');

// TEST 1: Check Remaining Quota
console.log('TEST 1: Checking Textbelt quota...\n');

fetch('https://textbelt.com/quota/' + TEXTBELT_KEY)
  .then(res => res.json())
  .then(data => {
    console.log('✅ QUOTA CHECK RESULT:');
    console.log('-----------------------------------');
    console.log('Remaining SMS credits:', data.quotaRemaining);
    console.log('Is unlimited plan?:', data.isUnlimited || false);
    console.log('Success:', data.success);
    console.log('-----------------------------------\n');
    
    if (data.quotaRemaining === 0) {
      console.log('⚠️ WARNING: You have 0 credits left!');
      console.log('Buy more at: https://textbelt.com\n');
    } else {
      console.log(`✅ You have ${data.quotaRemaining} SMS credits remaining\n`);
      
      // Only run send test if we have quota
      runSendTest();
    }
  })
  .catch(err => {
    console.error('❌ QUOTA CHECK FAILED:', err.message);
    console.log('Error details:', err);
  });

// TEST 2: Send Test SMS (only if quota available)
function runSendTest() {
  console.log('TEST 2: Sending test SMS with link...\n');
  console.log('Sending to:', TEST_PHONE);
  console.log('Message: "Test from Iron 65 - https://silver-ganache-1ee2ca.netlify.app/booking-form?phone=test"\n');
  
  fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: TEST_PHONE,
      message: 'Test from Iron 65 - Complete booking: https://silver-ganache-1ee2ca.netlify.app/booking-form?phone=test',
      key: TEXTBELT_KEY
    })
  })
  .then(res => res.json())
  .then(data => {
    console.log('✅ SEND TEST RESULT:');
    console.log('-----------------------------------');
    console.log('Success:', data.success);
    
    if (data.success) {
      console.log('✅ SMS SENT!');
      console.log('Text ID:', data.textId);
      console.log('Quota remaining:', data.quotaRemaining);
      console.log('-----------------------------------\n');
      console.log('📱 CHECK YOUR PHONE!');
      console.log('Did you receive the SMS?');
      console.log('Did the link come through or get stripped?\n');
    } else {
      console.log('❌ SMS FAILED!');
      console.log('Error:', data.error);
      console.log('-----------------------------------\n');
      
      // Common error interpretations
      if (data.error && data.error.includes('quota')) {
        console.log('⚠️ ISSUE: Out of SMS credits');
        console.log('SOLUTION: Buy more at https://textbelt.com\n');
      } else if (data.error && data.error.includes('invalid')) {
        console.log('⚠️ ISSUE: Invalid phone number format');
        console.log('SOLUTION: Check TEST_PHONE variable at top of file\n');
      } else {
        console.log('⚠️ ISSUE: Unknown error');
        console.log('SOLUTION: Check Textbelt status or API key\n');
      }
    }
  })
  .catch(err => {
    console.error('❌ SEND TEST FAILED:', err.message);
    console.log('Error details:', err);
  });
}

// TEST 3: Test without link (for comparison)
setTimeout(() => {
  console.log('\n====================================');
  console.log('TEST 3: Sending test SMS WITHOUT link...\n');
  
  fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: TEST_PHONE,
      message: 'Test from Iron 65 - Your tour is confirmed! Booking details sent to your email.',
      key: TEXTBELT_KEY
    })
  })
  .then(res => res.json())
  .then(data => {
    console.log('✅ NO-LINK TEST RESULT:');
    console.log('-----------------------------------');
    console.log('Success:', data.success);
    
    if (data.success) {
      console.log('✅ SMS SENT (no link)');
      console.log('Text ID:', data.textId);
      console.log('Quota remaining:', data.quotaRemaining);
      console.log('-----------------------------------\n');
      console.log('📱 CHECK YOUR PHONE!');
      console.log('Did this message arrive successfully?\n');
    } else {
      console.log('❌ SMS FAILED');
      console.log('Error:', data.error);
      console.log('-----------------------------------\n');
    }
    
    // Final summary
    console.log('\n====================================');
    console.log('TEST COMPLETE - SUMMARY');
    console.log('====================================');
    console.log('Compare the two test messages:');
    console.log('1. Message WITH link (Test 2)');
    console.log('2. Message WITHOUT link (Test 3)');
    console.log('');
    console.log('If Test 2 failed but Test 3 worked:');
    console.log('→ Links are being blocked by carrier');
    console.log('→ Use sendForm-updated.js with USE_SHORT_LINKS = false');
    console.log('');
    console.log('If both tests failed:');
    console.log('→ Check your Textbelt quota');
    console.log('→ Verify API key is correct');
    console.log('→ Check phone number format');
    console.log('');
    console.log('If both tests worked:');
    console.log('→ Your Textbelt setup is fine!');
    console.log('→ Issue might be in how vapi-webhook calls sendForm');
    console.log('====================================\n');
  })
  .catch(err => {
    console.error('❌ NO-LINK TEST FAILED:', err.message);
  });
}, 3000); // Wait 3 seconds between tests

console.log('⏳ Running tests... Please wait...\n');
