const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const ANA_PHONE = '+16462269189';
const INBOX_EMAIL = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';

// Vapi config for outbound calls
const VAPI_KEY = '064f441d-a388-4404-8b6c-05e91e90f1ff';
const VAPI_ASSISTANT_ID = '1cae5323-6b83-4434-8461-6330472da140';
const VAPI_PHONE_ID = 'fe01292e-6625-4c06-b24e-8cd2240f5453';

// Skip these senders â€” not leads
const SKIP_SENDERS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster', 'leads@followupboss.com',
  'notifications', 'automated', 'newsletter', 'unsubscribe',
  'zillow', 'realtor.com', 'avail.co', 'planhub', 'rentspree',
  'followupboss.com', 'webflow.com', 'voice.google.com',
  'txt.voice.google', 'comet.zillow', 'mail.zillow',
  'zillowrentals', 'mail.realtor', 'mail.instagram',
  'support@', 'info@', 'hello@', 'team@',
];

// Only reply to emails that look like actual leads
const LEAD_KEYWORDS = /rent|apartment|unit|tour|showing|available|bedroom|studio|price|lease|apply|application|move.in|iron.?65|listing|looking|interested|inquiry|inquire|buy|purchase|mortgage|home|house|sell|property|schedule|viewing/i;

function shouldSkip(from) {
  const f = (from || '').toLowerCase();
  return SKIP_SENDERS.some(s => f.includes(s));
}

function isLead(subject, body) {
  return LEAD_KEYWORDS.test((subject || '') + ' ' + (body || ''));
}

// Extract phone number from email body
function extractPhone(text) {
  const match = text.match(/(\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})/);
  if (!match) return null;
  let p = match[1].replace(/\D/g, '');
  if (p.length === 10) p = '+1' + p;
  else if (p.length === 11) p = '+' + p;
  return p;
}

// â”€â”€ FETCH UNREAD EMAILS VIA IMAP (last 14 days) â”€â”€
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
          if (!results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          const toFetch = results.slice(0, 5); // Max 5 at a time to stay within timeout
          const fetch = imap.fetch(toFetch, { bodies: '', markSeen: true });

          fetch.on('message', (msg) => {
            let buffer = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
            });
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

// â”€â”€ GENERATE AI REPLY â”€â”€
async function generateReply(from, subject, body) {
  const isBuyer = /buy|purchase|mortgage|home|house|sell/i.test(body + subject);

  const prompt = isBuyer
    ? `You are Ana Haynes, Licensed Realtor at Rosalia Group in New Jersey.
A buyer/seller email came in. Write a SHORT warm professional reply.
- Thank them for reaching out
- Offer to schedule a call: ${BOOKING_FORM_URL}
- Sign off as: Ana Haynes | Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com
FROM: ${from}
SUBJECT: ${subject}
EMAIL: ${body.substring(0, 600)}
Under 100 words. No bullet points. Reply with ONLY the email body.`
    : `You are Ana Haynes, Leasing Manager at Rosalia Group. You manage Iron 65 Apartments in Newark NJ and other luxury rentals.
A rental inquiry came in. Write a SHORT warm professional reply.
- Thank them for their interest
- Invite them to schedule a tour: ${BOOKING_FORM_URL}
- Mention you have units available
- Sign off as: Ana Haynes | Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com
FROM: ${from}
SUBJECT: ${subject}
EMAIL: ${body.substring(0, 600)}
Under 100 words. No bullet points. Reply with ONLY the email body.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// â”€â”€ SEND EMAIL REPLY â”€â”€
async function sendReply(replyTo, subject, replyText) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: INBOX_EMAIL, pass: GMAIL_PASS },
  });
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  await transporter.sendMail({
    from: `"Ana Haynes â€” Rosalia Group" <${INBOX_EMAIL}>`,
    to: replyTo,
    subject: replySubject,
    text: replyText,
  });
  console.log('Email reply sent to:', replyTo);
}

// â”€â”€ TRIGGER VAPI OUTBOUND CALL â”€â”€
async function triggerCall(phone, leadName) {
  try {
    const res = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VAPI_KEY}`,
      },
      body: JSON.stringify({
        phoneNumberId: VAPI_PHONE_ID,
        assistantId: VAPI_ASSISTANT_ID,
        customer: {
          number: phone,
          name: leadName || undefined,
        },
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

// â”€â”€ SEND SMS FALLBACK (if no answer) â”€â”€
async function sendSMSFallback(phone, leadName) {
  const firstName = leadName?.split(' ')[0] || 'there';
  const msg = `Hi ${firstName}! This is Ana from Rosalia Group. We'd love to show you one of our apartments. Book a tour here: ${BOOKING_FORM_URL} â€” (551) 249-9795`;
  try {
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: msg, key: TEXTBELT_KEY }),
    });
    const result = await res.json();
    console.log('SMS sent:', result.success ? 'OK' : result.error);
  } catch (err) {
    console.error('SMS error:', err.message);
  }
}

// â”€â”€ SAVE LEAD TO SUPABASE â”€â”€
async function saveLead(fromEmail, fromName, subject, body, replyText, phone) {
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(fromEmail)}&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();

  if (Array.isArray(existing) && existing.length > 0) {
    const newNote = `[${new Date().toLocaleDateString()}] Email: ${subject}`;
    const mergedNotes = existing[0].notes ? existing[0].notes + '\n' + newNote : newNote;
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ notes: mergedNotes, replied_at: new Date().toISOString(), email_reply: replyText, phone: existing[0].phone || phone }),
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

// â”€â”€ NOTIFY ANA â”€â”€
async function notifyAna(fromName, subject, phone) {
  const msg = `New Lead Email!\nFrom: ${fromName}\nSubject: ${subject}${phone ? '\nPhone: ' + phone + '\nAlex calling now...' : '\nNo phone found'}`;
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: ANA_PHONE, message: msg, key: TEXTBELT_KEY }),
    });
  } catch (err) { console.error('Ana SMS error:', err.message); }
}

// â”€â”€ MAIN HANDLER â”€â”€
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (!GMAIL_PASS) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'GMAIL_PASS_INQUIRIES not set' }) };
  }

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
        const body = parsed.text || '';
        const replyTo = parsed.replyTo?.text || from;

        // Extract sender email and name
        const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
        const fromEmail = emailMatch?.[1] || from;
        const fromName = from.replace(/<[^>]+>/, '').trim().replace(/"/g, '') || null;

        console.log('Processing:', from, '|', subject);

        // Skip automated senders
        if (shouldSkip(from)) {
          console.log('Skipping (automated):', from);
          results.skipped++;
          continue;
        }

        // Skip if not a lead
        if (!isLead(subject, body)) {
          console.log('Skipping (not a lead):', subject);
          results.not_lead++;
          continue;
        }

        // Extract phone from body if present
        const phone = extractPhone(body + ' ' + subject);
        console.log('Lead detected! Phone:', phone || 'none found');

        // 1. Generate AI reply
        const replyText = await generateReply(from, subject, body);
        if (!replyText) {
          console.log('No reply generated');
          results.skipped++;
          continue;
        }

        // 2. Send email reply
        await sendReply(replyTo, subject, replyText);

        // 3. Save to Supabase
        await saveLead(fromEmail, fromName, subject, body, replyText, phone);

        // 4. Notify Ana
        await notifyAna(fromName || from, subject, phone);

        // 5. If phone found â€” trigger Alex call + SMS fallback
        if (phone) {
          const callId = await triggerCall(phone, fromName);
          if (callId) {
            console.log('Alex call triggered:', callId);
            // SMS fallback sent regardless â€” Alex will handle follow-up if he connects
            await sendSMSFallback(phone, fromName);
          } else {
            // Call failed â€” send SMS directly
            await sendSMSFallback(phone, fromName);
          }
        }

        results.processed++;
        console.log('Done processing lead:', subject);

      } catch (err) {
        console.error('Error processing email:', err.message);
        results.errors++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, total_unread: rawEmails.length, results }),
    };

  } catch (err) {
    console.error('readmail error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
