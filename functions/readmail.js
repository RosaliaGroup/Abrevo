const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const INBOX_EMAIL = 'inquiries@rosaliagroup.com';
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-rosalia';
const TEXTBELT_KEY = process.env.TEXTBELT_KEY;

const VAPI_KEY = process.env.VAPI_KEY || '064f441d-a388-4404-8b6c-05e91e90f1ff';
const VAPI_ASSISTANT_ID = '1cae5323-6b83-4434-8461-6330472da140';
const VAPI_PHONE_ID = process.env.VAPI_PHONE_ID || '2e2b6713-f631-4e9e-95fa-3418ecc77c0a';

const ANA_CONTEXT = `
You are the Rosalia Group Inquiries Team â€” a warm, professional leasing team in New Jersey managing multiple luxury apartment communities. You write concise, friendly emails (max 4 sentences) that invite leads to book a tour. Always include the booking link. Never use bullet points.

PROPERTIES YOU MANAGE:
- Iron 65: 65 McWhorter St, Newark NJ â€” Studios from $2,199, 1BR from $2,724, Lofts from $3,488. 1 month free on 12-month lease, $4,000 rent credit on 18-month lease. Rooftop, gym, yoga studio, cold plunge, sauna, NYC views. (862) 333-1681
- 502 Market St (The Elks), Orange NJ â€” 2BR/3BR luxury units, $2,400-$3,200/mo
- 162 University Ave, East Orange NJ â€” Flex 1BR/2BR $1,999/mo, 1 month free
- 473 Main St (The Elks), Orange NJ â€” Luxury apartments

BOOKING LINKS:
- Iron 65: https://silver-ganache-1ee2ca.netlify.app/booking-form
- All others: https://silver-ganache-1ee2ca.netlify.app/booking-rosalia

TOUR HOURS: Tue-Fri 12-6 PM, Sat-Sun 12-4 PM. Closed Mon.

Always sign as: Rosalia Group Leasing Team | (862) 333-1681 | inquiries@rosaliagroup.com
`;

const SKIP_SENDERS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster',
  'notifications', 'automated', 'newsletter', 'unsubscribe',
  'realtor.com', 'planhub', 'rentspree',
  'voice.google.com',
  'txt.voice.google', 'comet.zillow', 'mail.zillow',
  'zillowrentals', 'mail.realtor', 'mail.instagram',
  'no-reply@mail.zillow', 'market-updates@', 'recommendations@',
  'rosaliagroup.com', 'mechanicalenterprise.com',
  'no-reply@webflow.com', 'no-reply-forms@webflow.com',
];

function isZillowLead(from) {
  return from.toLowerCase().includes('convo.zillow.com');
}
function isAvailDigest(subject) {
  const s = (subject || '').toLowerCase();
  return s.includes('you have received') && s.includes('messages on avail');
}

function isFUBLead(from, subject) {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  return f.includes('followupboss.com') || 
         (s.includes('new lead from') && (s.includes('facebook') || s.includes('instagram') || s.includes('zillow')));
}

function parseFUBEmail(body) {
  const lead = {};
  const lines2 = (body || '').split(/[\n\r]+/);
  for (const line of lines2) {
    const nm = line.match(/new lead named ([^(]+)/i);
    if (nm) { lead.name = nm[1].trim(); break; }
  }
  const phoneM = body.match(/(\(\d{3}\)\s*\d{3}[\s\-]\d{4})/);
  if (phoneM) { let p = phoneM[1].replace(/\D/g,''); if(p.length===10) p='+1'+p; lead.phone = p; }
  const emailM = body.match(/([a-zA-Z0-9._%+\-]+@(?!followupboss)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  if (emailM) lead.email = emailM[1].trim();
  const srcM = body.match(/from (Facebook|Instagram|Zillow|Google)/i);
  if (srcM) lead.source = srcM[1].toLowerCase();
  return lead;
}

function isAvailLead(from) {
  return from.toLowerCase().includes('reply.avail.co');
}
function isWebflowLead(from, subject) {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  return (f.includes('webflow.com') || f.includes('resipointe')) &&
         (s.includes('submission') || s.includes('application') || s.includes('new form') || s.includes('new lead'));
}

function parseAvailEmail(body) {
  const lead = {};
  const nameMatch = body.match(/Name:\s*(.+)/i);
  const emailMatch = body.match(/Email:\s*([^\s\n]+@[^\s\n]+)/i);
  const phoneMatch = body.match(/Phone:\s*([\(\)\d\s\-\.]+)/i);
  if (nameMatch) lead.name = nameMatch[1].trim();
  if (emailMatch) lead.email = emailMatch[1].trim();
  if (phoneMatch) {
    let p = phoneMatch[1].replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11) p = '+' + p;
    lead.phone = p;
  }
  return lead;
}

function parseWebflowEmail(body) {
  const lead = {};
  const nameMatch = body.match(/Full Name:\s*(.+)/i);
  const emailMatch = body.match(/Email Address:\s*([^\s\n]+@[^\s\n]+)/i) || body.match(/Email:\s*([^\s\n]+@[^\s\n]+)/i);
  const phoneMatch = body.match(/Cell Phone:\s*([\d\s\(\)\-\.]+)/i) || body.match(/Phone:\s*([\d\s\(\)\-\.]+)/i);
  const buildingMatch = body.match(/Building:\s*(.+)/i);
  const bedroomsMatch = body.match(/Bedrooms:\s*(.+)/i);
  if (nameMatch) lead.name = nameMatch[1].trim();
  if (emailMatch) lead.email = emailMatch[1].trim();
  if (phoneMatch) {
    let p = phoneMatch[1].replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11) p = '+' + p;
    lead.phone = p;
  }
  if (buildingMatch) lead.property = buildingMatch[1].split('--')[0].trim();
  if (bedroomsMatch) lead.bedrooms = bedroomsMatch[1].split('--')[0].trim();
  return lead;
}

const LEAD_KEYWORDS = /rent|apartment|unit|tour|showing|available|bedroom|studio|price|lease|apply|application|move.in|listing|looking|interested|inquiry|inquire|buy|purchase|mortgage|home|house|sell|property|schedule|viewing|question|info|information/i;

function shouldSkip(from, subject) {
  if (isZillowLead(from)) return false;
  if (isFUBLead(from, subject)) return false;
  if (isAvailDigest(subject)) return true;
  if (isAvailLead(from)) return false;
  if (isWebflowLead(from, subject)) return false;
  const f = (from || '').toLowerCase();
  return SKIP_SENDERS.some(s => f.includes(s));
}

function isLead(subject, body, from) {
  if (isZillowLead(from || '')) return true;
  if (isFUBLead(from || '', subject || '')) return true;
  if (isAvailLead(from || '')) return true;
  if (isWebflowLead(from || '', subject)) return true;
  return LEAD_KEYWORDS.test((subject || '') + ' ' + (body || ''));
}

function extractPhone(text) {
  // Strip email addresses first to avoid extracting digits from relay addresses
  const cleaned = (text || '').replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  const match = cleaned.match(/(\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})/);
  if (!match) return null;
  let p = match[1].replace(/\D/g, '');
  if (p.length === 10) p = '+1' + p;
  else if (p.length === 11) p = '+' + p;
  return p;
}

// Parse Zillow lead email for structured data
function parseZillowEmail(body) {
  const lead = {};
  // Zillow sends name in subject like "Alondra is requesting..."
  // Phone is NOT in Zillow relay emails - don't try to extract
  const emailMatch = body.match(/Reply to ([^\s\n]+@[^\s\n]+)/i);
  if (emailMatch) lead.email = emailMatch[1].trim();
  return lead;
}

function fetchUnreadEmails() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: INBOX_EMAIL,
      password: GMAIL_PASS,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
    });
    const emails = [];
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) return reject(err);
        const since = new Date();
        since.setDate(since.getDate() - 14);
        const sinceStr = since.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        imap.search(['UNSEEN', ['SINCE', sinceStr]], (err, results) => {
          if (err) return reject(err);
          if (!results || results.length === 0) { imap.end(); return resolve([]); }
          const toFetch = results.slice(0, 5);
          const fetch = imap.fetch(toFetch, { bodies: '', markSeen: true });
          fetch.on('message', (msg) => {
            let buffer = '';
            msg.on('body', (stream) => { stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); }); });
            msg.once('end', () => { emails.push({ raw: buffer }); });
          });
          fetch.once('error', reject);
          fetch.once('end', () => { imap.end(); });
        });
      });
    });
    imap.once('end', () => resolve(emails));
    imap.once('error', reject);
    imap.connect();
  });
}

async function getLeadData(fromEmail) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(fromEmail)}&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[0];
  } catch (e) {}
  return null;
}

async function getLeadContext(email, name) {
  try {
    let url = `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&limit=1`;
    let res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    let data = await res.json();
    if (data && data[0]) return data[0];
    if (name) {
      url = `${SUPABASE_URL}/rest/v1/leads?name=ilike.*${encodeURIComponent(name)}*&limit=1&order=created_at.desc`;
      res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      data = await res.json();
      if (data && data[0]) return data[0];
    }
    return null;
  } catch (e) {
    console.error('Supabase lead lookup error:', e.message);
    return null;
  }
}

async function getCalendarAppointment(leadName) {
  try {
    const CALENDAR_ID = '4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com';
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
    if (!credentials.client_email) return null;
    const { google } = require('googleapis');
    const auth = new google.auth.JWT(
      credentials.client_email, null, credentials.private_key,
      ['https://www.googleapis.com/auth/calendar.readonly']
    );
    const calendar = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: weekLater.toISOString(),
      q: leadName,
      maxResults: 3,
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = res.data.items || [];
    if (events.length === 0) return null;
    const event = events[0];
    const start = event.start?.dateTime || event.start?.date;
    const date = new Date(start);
    return {
      title: event.summary,
      date: date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      time: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      description: event.description || '',
    };
  } catch (e) {
    console.error('Calendar lookup error:', e.message);
    return null;
  }
}

async function getPreviousThread(fromEmail) {
  const lead = await getLeadData(fromEmail);
  return lead?.email_reply || null;
}

async function repliedRecently(fromEmail) {
  const lead = await getLeadData(fromEmail);
  if (!lead?.replied_at) return false;
  const lastReply = new Date(lead.replied_at);
  return lastReply > new Date(Date.now() - 10 * 60 * 1000);
}

async function generateReply(from, subject, body, previousReply, leadContext, calendarAppt, leadName) {
  const isBuyer = /buy|purchase|mortgage|home|house|sell/i.test(body + subject);

  let threadContext = '';
  if (previousReply) {
    threadContext = `\n\nPREVIOUS REPLY YOU SENT:\n${previousReply}\n\nThe lead is now replying to that. Answer their follow-up naturally.`;
  }

  // Build context from Supabase and Calendar
  let contextStr = '';
  if (calendarAppt) {
    contextStr += `\n\nCALENDAR: This lead has an upcoming appointment: ${calendarAppt.title} on ${calendarAppt.date} at ${calendarAppt.time}.`;
  }
  if (leadContext) {
    if (leadContext.phone) contextStr += `\nLEAD PHONE: ${leadContext.phone}`;
    if (leadContext.notes) contextStr += `\nLEAD NOTES: ${leadContext.notes}`;
    if (leadContext.status) contextStr += `\nLEAD STATUS: ${leadContext.status}`;
  }
  if (contextStr) contextStr = '\n---\nCONTEXT FROM OUR RECORDS:' + contextStr + '\n---\n';

  const role = isBuyer
    ? 'a licensed real estate agent helping buyers and sellers'
    : 'a leasing manager helping people find rental apartments';

  // Address to city/property mapping
  const addressMap = {
    '473 main': 'Orange NJ (The Elks)',
    '475 main': 'Orange NJ (The Elks)',
    '162 university': 'Newark NJ (162 University Ave)',
    '486 market': 'Newark NJ (River Pointe)',
    '502 market': 'Newark NJ (502 Market St)',
    '556 market': 'Newark NJ (556 Market St)',
    '289 halsey': 'Newark NJ (289 Halsey St)',
    '39 madison': 'Newark NJ (Iron Pointe)',
    '65 mcwhorter': 'Newark NJ (Iron 65)',
    'iron 65': 'Newark NJ (Iron 65)',
    '276 duncan': 'Jersey City NJ (276 Duncan St)',
    '80 freeman': 'Newark NJ (The Ballantine)',
    '77 christie': 'Newark NJ (The Ballantine)',
    '1369 south': 'Plainfield NJ (1369 South Ave)',
  };
  const subjectLower = (subject || '').toLowerCase();
  const bodyLower = (body || '').toLowerCase();
  let detectedCity = '';
  for (const [addr, city] of Object.entries(addressMap)) {
    if (subjectLower.includes(addr) || bodyLower.includes(addr)) {
      detectedCity = `\nIMPORTANT: This inquiry is about a property in ${city} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â make sure your reply references the correct city and property.`;
      break;
    }
  }
  const firstName = leadName ? leadName.split(' ')[0] : '';
  const nameGreeting = firstName ? `The lead's name is ${firstName}. Start your reply with "Hi ${firstName},"` : 'Start with a warm greeting.';

  const userMessage = `FROM: ${from}
SUBJECT: ${subject}
THEIR EMAIL:
${body.substring(0, 800)}
${contextStr}${threadContext}`;

  const prompt = `${ANA_CONTEXT}

You are ${role}.

${previousReply ? 'A lead is REPLYING to your previous email. Read their reply and respond to what they are asking.' : `A new inquiry email came in. ${nameGreeting} Ask about their needs.${detectedCity}`}

${userMessage}

Write ONLY the email body. No subject line. MAXIMUM 4 sentences. No bullet points. No lists. Lead with the lead's name and ONE sentence about their property interest. Ask for their phone number and preferred move-in date in ONE sentence. End with the booking link. Never mention multiple properties or amenities in detail ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â keep it short and conversational. No markdown.`;

  console.log('Calling Claude API...');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.type === 'error') {
    console.error('Claude error:', data.error?.message);
    return '';
  }
  return data.content?.[0]?.text || '';
}

async function sendReply(replyTo, subject, replyText) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: INBOX_EMAIL, pass: GMAIL_PASS },
  });
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const htmlText = replyText
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\n/g, '<br>')
    .replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" style="color:#1a73e8;text-decoration:underline;">Book Your Tour Here</a>'
    );
  await transporter.sendMail({
    from: `"Rosalia Group Inquiries" <${INBOX_EMAIL}>`,
    to: replyTo,
    subject: replySubject,
    text: replyText.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1'),
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.8;color:#333;max-width:600px;">${htmlText}</div>`,
  });
  console.log('Email reply sent to:', replyTo);
}

async function triggerCall(phone, leadName) {
  try {
    const res = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VAPI_KEY}` },
      body: JSON.stringify({
        phoneNumberId: VAPI_PHONE_ID,
        assistantId: VAPI_ASSISTANT_ID,
        customer: { number: phone, name: leadName || undefined },
      }),
    });
    const data = await res.json();
    console.log('Vapi call triggered:', data.id || data.error);
    return data.id || null;
  } catch (err) {
    console.error('Vapi call error:', err.message);
    return null;
  }
}

async function sendSMS(phone, leadName) {
  if (!TEXTBELT_KEY) return;
  const firstName = leadName?.split(' ')[0] || 'there';
  const msg = `Hi ${firstName}! Rosalia Group here. We replied to your inquiry and would love to help you find the perfect apartment. Book a tour: ${BOOKING_FORM_URL}`;
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: msg, key: TEXTBELT_KEY }),
    });
    console.log('SMS sent to:', phone);
  } catch (err) { console.error('SMS error:', err.message); }
}

async function saveLead(fromEmail, fromName, subject, body, replyText, phone) {
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(fromEmail)}&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();
  if (Array.isArray(existing) && existing.length > 0) {
    const newNote = `[${new Date().toLocaleDateString()}] Email reply: ${subject}`;
    const mergedNotes = existing[0].notes ? existing[0].notes + '\n' + newNote : newNote;
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        notes: mergedNotes,
        replied_at: new Date().toISOString(),
        email_reply: replyText,
        phone: existing[0].phone || phone || null,
      }),
    });
    return existing[0];
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      name: fromName,
      email: fromEmail,
      phone: phone || null,
      source: 'email',
      message: body?.substring(0, 500) || subject,
      client: 'rosalia',
      status: 'new',
      replied_at: new Date().toISOString(),
      follow_up_count: 0,
      email_reply: replyText,
      notes: `Subject: ${subject}`,
    }),
  });
  const text = await res.text();
  try {
    const saved = JSON.parse(text);
    return Array.isArray(saved) ? saved[0] : saved;
  } catch (e) { return null; }
}

async function notifyAna(fromName, subject, phone, callAllowed) {
  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
    await transporter.sendMail({
      from: `"Rosalia AI System" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject: `New Lead: ${fromName || 'Unknown'}`,
      text: `New lead email received!\n\nFrom: ${fromName}\nSubject: ${subject}${phone ? '\nPhone: ' + phone + (callAllowed ? '\nAlex is calling...' : '\nCall queued for business hours') : '\nNo phone ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â reply sent'}`,
    });
  } catch (err) { console.error('Ana email notification error:', err.message); }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!GMAIL_PASS) return { statusCode: 500, headers, body: JSON.stringify({ error: 'GMAIL_PASS_INQUIRIES not set' }) };

  try {
    console.log('readmail: fetching unread emails via IMAP...');
    const rawEmails = await fetchUnreadEmails();
    console.log(`Found ${rawEmails.length} unread emails`);
    const results = { processed: 0, skipped: 0, not_lead: 0, errors: 0 };

    for (const raw of rawEmails) {
      try {
        const parsed = await simpleParser(raw.raw);
        const from = parsed.from?.text || '';
        const subject = parsed.subject || '(no subject)';
        // Use text body, fall back to HTML with tags stripped
        const rawHtml = parsed.html || '';
        const strippedHtml = rawHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        const body = parsed.text || strippedHtml || '';
        const replyTo = parsed.replyTo?.text || from;

        const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
        const fromEmail = emailMatch?.[1] || from;
        const fromName = from.replace(/<[^>]+>/, '').trim().replace(/"/g, '') || null;

        console.log('Processing:', from, '|', subject);

        if (shouldSkip(from, subject)) {
          console.log('Skipping (automated):', from);
          results.skipped++;
          continue;
        }

        if (!isLead(subject, body, from)) {
          console.log('Skipping (not a lead):', subject);
          results.not_lead++;
          continue;
        }

        let phone = null;
        let realEmail = fromEmail;
        let realName = fromName;

        if (isFUBLead(from, subject)) {
          const p = parseFUBEmail(body);
          if (p.phone) phone = p.phone;
          if (p.email) realEmail = p.email;
          if (p.name) realName = p.name;
          console.log('FUB lead - Name:', realName, 'Phone:', phone, 'Email:', realEmail);
        } else if (isAvailLead(from)) {
          const p = parseAvailEmail(body);
          if (p.phone) phone = p.phone;
          if (p.email) realEmail = p.email;
          if (p.name) realName = p.name;
          console.log('Avail lead - Name:', realName, 'Email:', realEmail);
        } else if (isWebflowLead(from, subject)) {
          const p = parseWebflowEmail(body);
          if (p.phone) phone = p.phone;
          if (p.email) realEmail = p.email;
          if (p.name) realName = p.name;
          console.log('Webflow lead - Name:', realName, 'Email:', realEmail);
        } else if (isZillowLead(from)) {
          // Zillow relay emails don't contain phone numbers
          // Phone comes from Zillow profile - not available in relay
          const p = parseZillowEmail(body);
          if (p.email) realEmail = p.email;
          phone = null; // Zillow relay never has phone
          console.log('Zillow lead - no phone in relay email');
        } else {
          // Strip emails from text before extracting phone
          phone = extractPhone(body + ' ' + subject);
        }
        console.log('Lead detected! Phone:', phone || 'none found');

        const checkEmail = (isAvailLead(from) || isWebflowLead(from, subject)) ? realEmail : fromEmail;
        if (await repliedRecently(checkEmail)) {
          console.log('Skipping (replied recently):', checkEmail);
          results.skipped++;
          continue;
        }

        const previousReply = await getPreviousThread(fromEmail);
        const isReply = subject.toLowerCase().startsWith('re:') || !!previousReply;
        if (isReply) console.log('Thread reply detected');

        const leadContext = await getLeadContext(checkEmail, realName);
        const calendarAppt = await getCalendarAppointment(realName || fromName);
        if (calendarAppt) console.log('Calendar appointment found:', calendarAppt.date, calendarAppt.time);
        if (leadContext) console.log('Lead context found:', leadContext.status);

        const replyText = await generateReply(from, subject, body, previousReply, leadContext, calendarAppt, realName);
        if (!replyText) { results.skipped++; continue; }

        const effectiveReplyTo = (isAvailLead(from) || isWebflowLead(from, subject)) ? realEmail : replyTo;
        await sendReply(effectiveReplyTo, subject, replyText);
        await saveLead(realEmail || fromEmail, realName || fromName, subject, body, replyText, phone);
        // Business hours check BEFORE notifying Ana
        let callAllowed = false;
        if (phone) {
          const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const etHour = nowET.getHours();
          const etDay = nowET.getDay();
          if (etDay >= 1 && etDay <= 5) callAllowed = etHour >= 9 && etHour < 18;
          else if (etDay === 6) callAllowed = etHour >= 10 && etHour < 17;
          else if (etDay === 0) callAllowed = etHour >= 11 && etHour < 17;
        }

        await notifyAna(realName || fromName || from, subject, phone, callAllowed);

        if (phone) {
          const existingLead = await getLeadData(fromEmail);
          const hadPhone = existingLead?.phone && existingLead.phone.replace(/\D/g, '').length >= 10;
          if (!hadPhone || !isReply) {
            if (callAllowed) {
              await triggerCall(phone, realName || fromName);
              console.log('Call triggered during business hours for:', realName || fromName);
            } else {
              console.log('Outside business hours - skipping call, autocall will handle:', realName || fromName);
            }
          }
        }

        results.processed++;
        console.log('Done:', subject);

      } catch (err) {
        console.error('Error processing email:', err.message);
        results.errors++;
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, total_unread: rawEmails.length, results }) };

  } catch (err) {
    console.error('readmail error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
