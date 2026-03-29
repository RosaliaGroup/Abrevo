const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const VAPI_KEY = process.env.VAPI_KEY || '064f441d-a388-4404-8b6c-05e91e90f1ff';
const TEXTBELT_KEY_1 = '0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW';
const TEXTBELT_KEY_2 = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const ALERT_EMAIL = 'ana@rosaliagroup.com';
const ALERT_PHONE = '+12014970225';
const BASE_URL = 'https://abrevo.co/.netlify/functions';

// ---- Test helpers ----

async function testEndpoint(name, url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal
    });
    clearTimeout(timeout);
    // 4xx is OK (means function is alive, just rejected bad input), 5xx is failure
    return { name, ok: r.status < 500, status: r.status };
  } catch (e) {
    return { name, ok: false, status: 0, error: e.message };
  }
}

async function testBookEndpoint() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    // POST with test data — book.js requires these fields; use a test phone to avoid real bookings
    const testData = {
      full_name: 'HEALTHCHECK_TEST',
      phone: '+10000000000',
      email: 'healthcheck@test.invalid',
      preferred_date: 'January 1 2099',
      preferred_time: '12:00 PM',
      budget: 'Under $2,500',
      apartment_size: '1BR',
      move_in_date: 'January 1 2099',
      income_qualifies: 'Test',
      credit_qualifies: '700+',
      additional_notes: 'AUTOMATED HEALTH CHECK — ignore',
      status: 'healthcheck'
    };
    const r = await fetch(`${BASE_URL}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData),
      signal: controller.signal
    });
    clearTimeout(timeout);
    // We expect 200 (success) or 4xx (validation reject) — both mean the function is alive
    // 5xx means the function is broken
    return { name: 'book', ok: r.status < 500, status: r.status };
  } catch (e) {
    return { name: 'book', ok: false, status: 0, error: e.message };
  }
}

async function testTextbelt(key, label) {
  try {
    const r = await fetch(`https://textbelt.com/quota/${key}`);
    const data = await r.json();
    return { label, credits: data.quotaRemaining ?? 0 };
  } catch (e) {
    return { label, credits: -1, error: e.message };
  }
}

async function testVapi() {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const r = await fetch(`https://api.vapi.ai/call?createdAtGe=${todayStart}&limit=100`, {
      headers: { Authorization: `Bearer ${VAPI_KEY}` }
    });
    const calls = await r.json();
    const list = Array.isArray(calls) ? calls : [];
    const total = list.length;
    const voicemail = list.filter(c => c.endedReason === 'voicemail').length;
    const hangup = list.filter(c => c.endedReason === 'customer-ended-call').length;
    return {
      calls_today: total,
      voicemail_pct: total ? Math.round((voicemail / total) * 100) : 0,
      hangup_pct: total ? Math.round((hangup / total) * 100) : 0
    };
  } catch (e) {
    return { calls_today: 0, voicemail_pct: 0, hangup_pct: 0, error: e.message };
  }
}

// ---- Save & Alert ----

async function saveToSupabase(record) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/system_health`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify(record)
    });
    console.log('Health record saved to Supabase');
  } catch (e) {
    console.error('Failed to save health check:', e.message);
  }
}

async function sendAlertEmail(issues, record) {
  if (!GMAIL_PASS) { console.log('No GMAIL_PASS — skipping email alert'); return; }
  try {
    const transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS }
    });
    const timeStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const body = `Abrevo System Health Alert
Time: ${timeStr} ET

Issues Found:
${issues.map(i => '  - ' + i).join('\n')}

Full Report:
  Book.js: ${record.book_ok ? 'OK' : 'FAIL'}
  Readmail: ${record.readmail_ok ? 'OK' : 'FAIL'}
  Autocall: ${record.autocall_ok ? 'OK' : 'FAIL'}
  Inventory: ${record.inventory_ok ? 'OK' : 'FAIL'}
  SMS Key 1 (book.js): ${record.sms_key1_credits} credits
  SMS Key 2 (readmail/outreach): ${record.sms_key2_credits} credits
  Vapi Calls Today: ${record.vapi_calls_today}
  Voicemail %: ${record.vapi_voicemail_pct}%
  Hangup %: ${record.vapi_hangup_pct}%

ACTION REQUIRED: Investigate the issues listed above.`;

    await transport.sendMail({
      from: `"Abrevo Health Monitor" <${GMAIL_USER}>`,
      to: ALERT_EMAIL,
      subject: '\uD83D\uDEA8 Abrevo System Alert',
      text: body
    });
    console.log('Alert email sent to', ALERT_EMAIL);
  } catch (e) {
    console.error('Alert email failed:', e.message);
  }
}

async function sendAlertSMS(issues) {
  try {
    const summary = issues.slice(0, 3).join('; ');
    const extra = issues.length > 3 ? ` (+${issues.length - 3} more)` : '';
    const msg = `Abrevo Alert: ${summary}${extra}`;
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: ALERT_PHONE, message: msg, key: TEXTBELT_KEY_1 })
    });
    console.log('Alert SMS sent to', ALERT_PHONE);
  } catch (e) {
    console.error('Alert SMS failed:', e.message);
  }
}

// ---- Main handler ----

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  console.log('Health check starting...');
  const errors = [];

  // Test function endpoints in parallel
  const [bookTest, readmailTest, autocallTest, inventoryTest] = await Promise.all([
    testBookEndpoint(),
    testEndpoint('readmail', `${BASE_URL}/readmail`),
    testEndpoint('autocall', `${BASE_URL}/autocall`),
    testEndpoint('inventory', `${BASE_URL}/inventory`)
  ]);

  if (!bookTest.ok) errors.push(`Book.js DOWN (${bookTest.error || 'HTTP ' + bookTest.status})`);
  if (!readmailTest.ok) errors.push(`Readmail DOWN (${readmailTest.error || 'HTTP ' + readmailTest.status})`);
  if (!autocallTest.ok) errors.push(`Autocall DOWN (${autocallTest.error || 'HTTP ' + autocallTest.status})`);
  if (!inventoryTest.ok) errors.push(`Inventory DOWN (${inventoryTest.error || 'HTTP ' + inventoryTest.status})`);

  // Test SMS credits
  const [sms1, sms2] = await Promise.all([
    testTextbelt(TEXTBELT_KEY_1, 'Key 1 (book.js)'),
    testTextbelt(TEXTBELT_KEY_2, 'Key 2 (readmail)')
  ]);

  if (sms1.credits >= 0 && sms1.credits < 500) errors.push(`SMS Key 1 low: ${sms1.credits} credits`);
  if (sms2.credits >= 0 && sms2.credits < 200) errors.push(`SMS Key 2 low: ${sms2.credits} credits`);
  if (sms1.credits < 0) errors.push('SMS Key 1 check failed');
  if (sms2.credits < 0) errors.push('SMS Key 2 check failed');

  // Test Vapi call quality
  const vapi = await testVapi();
  if (vapi.error) errors.push(`Vapi API error: ${vapi.error}`);
  if (vapi.hangup_pct > 50) errors.push(`Vapi hangup rate high: ${vapi.hangup_pct}%`);

  const record = {
    tested_at: new Date().toISOString(),
    book_ok: bookTest.ok,
    readmail_ok: readmailTest.ok,
    autocall_ok: autocallTest.ok,
    inventory_ok: inventoryTest.ok,
    sms_key1_credits: Math.max(sms1.credits, 0),
    sms_key2_credits: Math.max(sms2.credits, 0),
    vapi_calls_today: vapi.calls_today,
    vapi_voicemail_pct: vapi.voicemail_pct,
    vapi_hangup_pct: vapi.hangup_pct,
    errors: errors.length > 0 ? errors : null
  };

  // Save to Supabase
  await saveToSupabase(record);

  // Send alerts if issues found
  if (errors.length > 0) {
    console.log('Issues found:', errors);
    await Promise.all([
      sendAlertEmail(errors, record),
      sendAlertSMS(errors)
    ]);
  } else {
    console.log('All systems healthy');
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ status: errors.length > 0 ? 'issues' : 'healthy', ...record })
  };
};
