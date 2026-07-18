// Mechanical Enterprise — HVAC booking function (Vapi tool: book-hvac).
//
// ISOLATION (Mechanical-only infrastructure):
//   - SMS:      Telnyx            (TELNYX_API_KEY / TELNYX_FROM_NUMBER)
//   - Calendar: Mechanical Google Calendar (MECHANICAL_CALENDAR_ID) — NO Rosalia fallback
//   - Database: Mechanical Supabase (MECHANICAL_SUPABASE_URL / MECHANICAL_SUPABASE_SERVICE_KEY)
//               → table `hvac_appointments` with real HVAC field names
//   - Email:    Mechanical sender (MECHANICAL_FROM_EMAIL)
//
// The public Vapi request + response contract is UNCHANGED (same request fields,
// same 200/400/500 shapes). SMS / calendar / Supabase / email failures remain
// non-blocking, exactly as before.
//
// FOLLOW-UP (do NOT fix in this PR — tracked separately): the ET offset is
// hardcoded to -4 (EDT) below; it does not handle EST / DST transitions. Date
// parsing is intentionally left unchanged here.

const SALES_EMAIL = 'sales@mechanicalenterprise.com';

// Required configuration. If any is missing we return a controlled error rather
// than silently falling back to shared Rosalia services. Values are never logged.
const REQUIRED_ENV = [
  'TELNYX_API_KEY',
  'TELNYX_FROM_NUMBER',
  'MECHANICAL_CALENDAR_ID',
  'MECHANICAL_SUPABASE_URL',
  'MECHANICAL_SUPABASE_SERVICE_KEY',
  'MECHANICAL_FROM_EMAIL',
  'GOOGLE_CREDENTIALS',
  'GMAIL_USER',
  'GMAIL_PASS',
];

function missingConfig(env = process.env) {
  return REQUIRED_ENV.filter((k) => !env[k] || String(env[k]).trim() === '');
}

// ── Phone normalization / validation ─────────────────────────────────────────
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.toString().replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}
function isPlausibleE164(v) {
  return typeof v === 'string' && /^\+1\d{10}$/.test(v);
}
function maskPhone(v) {
  const s = (v || '').toString();
  return s ? '***' + s.slice(-4) : '(none)';
}

// ── SMS via Telnyx ───────────────────────────────────────────────────────────
// Returns a structured result; never throws. Credentials are never logged and
// the recipient number is masked to its last 4 digits.
async function sendSMS(phone, message) {
  const to = normalizePhone(phone);
  const masked = maskPhone(to || phone);
  if (!to || !isPlausibleE164(to)) {
    console.error('[book-hvac][sms] invalid phone', masked);
    return { success: false, provider: 'telnyx', messageId: null, error: 'invalid_phone' };
  }
  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER;
  if (!apiKey || !from) {
    console.error('[book-hvac][sms] Telnyx not configured (TELNYX_API_KEY / TELNYX_FROM_NUMBER)');
    return { success: false, provider: 'telnyx', messageId: null, error: 'not_configured' };
  }
  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, text: message }),
    });
    const rawBody = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('[book-hvac][sms] Telnyx rejected', res.status, 'to', masked, rawBody.slice(0, 200));
      return { success: false, provider: 'telnyx', messageId: null, error: `telnyx_${res.status}` };
    }
    let data = null;
    try { data = JSON.parse(rawBody); } catch { /* logged below */ }
    const messageId = data && data.data && data.data.id ? data.data.id : null;
    console.log('[book-hvac][sms] accepted to', masked, 'telnyxMessageId', messageId);
    return { success: true, provider: 'telnyx', messageId, error: null };
  } catch (e) {
    console.error('[book-hvac][sms] network error to', masked, e.message);
    return { success: false, provider: 'telnyx', messageId: null, error: e.message };
  }
}

// ── Supabase row builder (real HVAC field names) ─────────────────────────────
// NOTE: HVAC data is stored in HVAC-shaped columns — never remapped into the
// legacy real-estate columns (apartment_size / preferred_area / move_in_date).
function buildAppointmentRow(b, { calendarEventId = null, smsResult = null } = {}) {
  return {
    full_name: b.full_name,
    phone: b.phone,
    email: b.email || null,
    preferred_date: b.preferred_date,
    preferred_time: b.preferred_time,
    appointment_type: b.appointment_type || 'free_consultation',
    property_type: b.property_type || null,
    property_address: b.property_address || null,
    issue_description: b.issue_description || null,
    budget: b.budget || null,
    calendar_event_id: calendarEventId,
    sms_provider: smsResult ? smsResult.provider : null,
    sms_message_id: smsResult ? smsResult.messageId : null,
    source: 'vapi',
    status: 'scheduled',
  };
}

// ── Google Calendar (Mechanical calendar only) ───────────────────────────────
async function createCalendarEvent(booking) {
  const calendarId = process.env.MECHANICAL_CALENDAR_ID;
  if (!calendarId) {
    // Fail clearly — never fall back to the Rosalia calendar.
    console.error('[book-hvac][calendar] MECHANICAL_CALENDAR_ID missing — refusing to book to any other calendar');
    return 'NO_CALENDAR_ID';
  }

  const googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  if (!googleCredentials.client_email) { return 'NO_CREDS'; }

  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: googleCredentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const calendar = google.calendar({ version: 'v3', auth });

  let startDateTime;
  try {
    let year, monthNum, day;
    const months = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
    const textMatch = (booking.preferred_date || '').match(/(\w+)\s+(\d+)[,\s]+(\d{4})/);
    const isoMatch = (booking.preferred_date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      year = parseInt(isoMatch[1]); monthNum = parseInt(isoMatch[2]) - 1; day = parseInt(isoMatch[3]);
    } else if (textMatch) {
      const monthName = textMatch[1].toLowerCase();
      monthNum = months[monthName] ?? 0;
      day = parseInt(textMatch[2]);
      year = parseInt(textMatch[3]);
    } else {
      return 'BAD_DATE:' + booking.preferred_date;
    }

    let hours = 10, minutes = 0;
    const timeMatch = (booking.preferred_time || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (timeMatch) {
      hours = parseInt(timeMatch[1]);
      minutes = parseInt(timeMatch[2]);
      if (timeMatch[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (timeMatch[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
    }

    const etOffset = -4; // FOLLOW-UP: hardcoded EDT; does not handle EST/DST — do not fix in this PR.
    startDateTime = new Date(Date.UTC(year, monthNum, day, hours - etOffset, minutes));
  } catch(e) { return 'DATE_ERR:' + e.message; }

  const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

  const attendees = [{'email': SALES_EMAIL}];
  if (booking.email && !booking.email.includes('convo.zillow')) attendees.push({'email': booking.email});

  const event = {
    summary: `[HVAC] ${booking.full_name} - ${booking.appointment_type || 'Service'} - Mechanical Enterprise`,
    location: booking.property_address || '',
    description: `Service: ${booking.appointment_type || 'N/A'}\nCustomer: ${booking.full_name}\nPhone: ${booking.phone}\nEmail: ${booking.email || 'N/A'}\nProperty: ${booking.property_address || 'N/A'}\nType: ${booking.property_type || 'N/A'}\nIssue: ${booking.issue_description || 'N/A'}`,
    start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
    end: { dateTime: endDateTime.toISOString(), timeZone: 'America/New_York' },
    attendees,
  };

  const res = await calendar.events.insert({ calendarId, resource: event, sendUpdates: 'none' });
  console.log('Calendar event created:', res.data.id);
  return res.data.id;
}

// Lazily-created nodemailer transporter (test-overridable). Keeps the module
// load free of heavy requires so unit tests need no installed deps.
let _transporterOverride = null;
function getTransporter() {
  if (_transporterOverride) return _transporterOverride;
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Configuration gate — fail loudly rather than routing to shared Rosalia
  // services. Only variable NAMES are logged, never their values.
  const missing = missingConfig();
  if (missing.length) {
    console.error('[book-hvac] missing required configuration:', missing.join(', '));
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  try {
    const booking = JSON.parse(event.body || '{}');
    const { full_name, phone, email, preferred_date, preferred_time, property_address,
            appointment_type, property_type, issue_description, budget } = booking;

    if (!full_name || !preferred_date || !preferred_time) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // 18-hour advance notice check
    {
      const months = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
      const textMatch = (preferred_date || '').match(/(\w+)\s+(\d+)[,\s]+(\d{4})/);
      const isoMatch = (preferred_date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      let year, monthNum, day;
      if (isoMatch) {
        year = parseInt(isoMatch[1]); monthNum = parseInt(isoMatch[2]) - 1; day = parseInt(isoMatch[3]);
      } else if (textMatch) {
        monthNum = months[textMatch[1].toLowerCase()] ?? 0;
        day = parseInt(textMatch[2]); year = parseInt(textMatch[3]);
      }
      if (year) {
        let hours = 10, minutes = 0;
        const timeMatch = (preferred_time || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (timeMatch) {
          hours = parseInt(timeMatch[1]); minutes = parseInt(timeMatch[2]);
          if (timeMatch[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
          if (timeMatch[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
        }
        const etOffset = -4; // FOLLOW-UP: hardcoded EDT (see note at top) — do not fix in this PR.
        const start = new Date(Date.UTC(year, monthNum, day, hours - etOffset, minutes));
        const now = new Date();
        const hoursUntilAppointment = (start - now) / (1000 * 60 * 60);
        if (hoursUntilAppointment < 18) {
          const earliest = new Date(now.getTime() + 18 * 60 * 60 * 1000);
          const earliestStr = earliest.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          return { statusCode: 400, headers, body: JSON.stringify({ error: `Appointments require 18 hours advance notice. Earliest available: ${earliestStr}` }) };
        }
      }
    }

    // Create calendar event — non-blocking
    let eventId = null;
    try { const cr = await createCalendarEvent(booking); if (cr && !cr.startsWith('DATE') && !cr.startsWith('NO_') && !cr.startsWith('BAD_')) eventId = cr; } catch(calErr) { console.error('Calendar error:', calErr.message); }

    // Send SMS confirmation to customer (Telnyx) — non-blocking. Captured so the
    // provider + message id can be recorded on the appointment row.
    let smsResult = null;
    if (phone) {
      smsResult = await sendSMS(phone, `Hi ${full_name.split(' ')[0]}! Your Mechanical Enterprise appointment is confirmed for ${preferred_date} at ${preferred_time}. Service: ${appointment_type || 'HVAC'}. Address: ${property_address || 'TBD'}. Questions? Call (862) 419-1763`);
    }

    // Save to Mechanical Supabase `hvac_appointments` table — non-blocking
    try {
      const sbRes = await fetch(`${process.env.MECHANICAL_SUPABASE_URL}/rest/v1/hvac_appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.MECHANICAL_SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.MECHANICAL_SUPABASE_SERVICE_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(buildAppointmentRow(booking, { calendarEventId: eventId, smsResult })),
      });
      console.log('Supabase status:', sbRes.status);
    } catch(sbErr) { console.error('Supabase error:', sbErr.message); }

    // Send email to sales team — non-blocking
    try { await getTransporter().sendMail({
      from: `"Mechanical Enterprise Booking" <${process.env.MECHANICAL_FROM_EMAIL}>`,
      to: SALES_EMAIL,
      subject: `New HVAC Appointment - ${full_name} | ${preferred_date} at ${preferred_time}`,
      text: `New HVAC Appointment - ${full_name}\nPhone: ${phone}\nEmail: ${email || 'N/A'}\nService: ${appointment_type || 'N/A'}\nProperty: ${property_address || 'N/A'}\nType: ${property_type || 'N/A'}\nIssue: ${issue_description || 'N/A'}\nDate: ${preferred_date} at ${preferred_time}\n\nCalendar event created`,
    }); } catch(se) { console.error('Sales email non-blocking:', se.message); }

    // Send confirmation email to customer — non-blocking
    if (email) {
      try { await getTransporter().sendMail({
        from: `"Mechanical Enterprise" <${process.env.MECHANICAL_FROM_EMAIL}>`,
        to: email,
        subject: 'Your HVAC Appointment is Confirmed - Mechanical Enterprise',
        text: `Dear ${full_name},\n\nYour HVAC appointment has been confirmed.\n\nDate: ${preferred_date}\nTime: ${preferred_time}\nService: ${appointment_type || 'HVAC Appointment'}\nAddress: ${property_address || 'TBD'}\n\nOur team will confirm within 1 business hour. Questions? Call (862) 419-1763 or email sales@mechanicalenterprise.com.\n\nThank you,\nMechanical Enterprise LLC\n(862) 419-1763 | mechanicalenterprise.com`,
      }); } catch(ce) { console.error('Cust email non-blocking:', ce.message); }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, eventId }) };
  } catch(err) {
    console.error('book-hvac error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// Test-only surface (ignored by Netlify, which invokes `exports.handler`).
exports.__test = {
  normalizePhone,
  isPlausibleE164,
  missingConfig,
  buildAppointmentRow,
  sendSMS,
  REQUIRED_ENV,
  setTransporter: (t) => { _transporterOverride = t; },
};
