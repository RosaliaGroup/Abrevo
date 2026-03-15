const nodemailer = require('nodemailer');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPI_KEY = process.env.VAPI_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TEXTBELT_KEY = process.env.TEXTBELT_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS || 'yynglhtlkmoakini';

// Thresholds for alerts
const VAPI_CREDITS_MIN = 10;
const ANTHROPIC_CREDITS_MIN = 5;
const TEXTBELT_CREDITS_MIN = 100;

async function checkVapi() {
  try {
    const res = await fetch('https://api.vapi.ai/account', {
      headers: { Authorization: `Bearer ${VAPI_KEY}` }
    });
    const data = await res.json();
    const credits = data.billingLimit - (data.billingUsage || 0);
    return { service: 'Vapi', status: credits > VAPI_CREDITS_MIN ? 'ok' : 'low', value: `$${credits?.toFixed(2)} remaining`, alert: credits <= VAPI_CREDITS_MIN };
  } catch (e) {
    return { service: 'Vapi', status: 'error', value: e.message, alert: true };
  }
}

async function checkTextbelt() {
  try {
    const res = await fetch(`https://textbelt.com/quota/${TEXTBELT_KEY}`);
    const data = await res.json();
    const quota = data.quotaRemaining;
    return { service: 'Textbelt SMS', status: quota > TEXTBELT_CREDITS_MIN ? 'ok' : 'low', value: `${quota} credits remaining`, alert: quota <= TEXTBELT_CREDITS_MIN };
  } catch (e) {
    return { service: 'Textbelt SMS', status: 'error', value: e.message, alert: true };
  }
}

async function checkSupabase() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    return { service: 'Supabase', status: res.ok ? 'ok' : 'error', value: res.ok ? 'Connected' : `HTTP ${res.status}`, alert: !res.ok };
  } catch (e) {
    return { service: 'Supabase', status: 'error', value: e.message, alert: true };
  }
}

async function checkAnthropicBalance() {
  try {
    // Check by making a minimal API call
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })
    });
    const data = await res.json();
    if (data.error?.type === 'billing_error') {
      return { service: 'Anthropic API', status: 'error', value: 'Billing error â€” out of credits!', alert: true };
    }
    return { service: 'Anthropic API', status: 'ok', value: 'Working', alert: false };
  } catch (e) {
    return { service: 'Anthropic API', status: 'error', value: e.message, alert: true };
  }
}

async function checkRecentLeads() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?created_at=gte.${since}&select=count`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'count=exact' } }
    );
    const count = res.headers.get('content-range')?.split('/')[1] || '0';
    return { service: 'New leads (24h)', status: 'ok', value: `${count} new leads today`, alert: false };
  } catch (e) {
    return { service: 'New leads (24h)', status: 'error', value: e.message, alert: false };
  }
}

async function sendAlertEmail(checks) {
  const alerts = checks.filter(c => c.alert);
  const hasAlerts = alerts.length > 0;

  const subject = hasAlerts
    ? `âš ï¸ ALERT: ${alerts.length} issue(s) detected â€” Rosalia AI System`
    : `âœ… System Health OK â€” Rosalia AI`;

  const body = `ROSALIA GROUP â€” SYSTEM HEALTH REPORT
${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET

${hasAlerts ? 'âš ï¸ ALERTS DETECTED:\n' + alerts.map(a => `â€¢ ${a.service}: ${a.value}`).join('\n') + '\n\n' : ''}ALL SERVICES STATUS:
${checks.map(c => `${c.status === 'ok' ? 'âœ…' : c.status === 'low' ? 'âš ï¸' : 'âŒ'} ${c.service}: ${c.value}`).join('\n')}

${hasAlerts ? 'ACTION REQUIRED: Please top up the services listed above.' : 'All systems running normally.'}`;

  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
  await transporter.sendMail({
    from: `"Rosalia AI Monitor" <${GMAIL_USER}>`,
    to: GMAIL_USER,
    subject,
    text: body,
  });
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    console.log('Running health checks...');

    const checks = await Promise.all([
      checkVapi(),
      checkTextbelt(),
      checkSupabase(),
      checkAnthropicBalance(),
      checkRecentLeads(),
    ]);

    const hasAlerts = checks.some(c => c.alert);
    console.log('Health check results:', JSON.stringify(checks));

    // Only email if there are alerts OR if it's a manual trigger
    if (hasAlerts || event.httpMethod === 'GET') {
      await sendAlertEmail(checks);
      console.log('Alert email sent');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, alerts: hasAlerts, checks }),
    };
  } catch (err) {
    console.error('Healthcheck error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
