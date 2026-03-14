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

const SKIP_SENDERS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster', 'leads@followupboss.com',
  'notifications', 'automated', 'newsletter',
];

function shouldSkip(from) {
  const f = (from || '').toLowerCase();
  return SKIP_SENDERS.some(s => f.includes(s));
}

// ── FETCH UNREAD EMAILS VIA IMAP ──
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
      imap.openBox('INBOX', false, (err, box) => {
        if (err) return reject(err);

        const _s=new Date();_s.setDate(_s.getDate()-14);const _ss=_s.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});imap.search(["UNSEEN",["SINCE",_ss]], (err, results) => {
          if (err) return reject(err);
          if (!results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          // Only process up to 10 at a time
          const toFetch = results.slice(0, 10);
          const fetch = imap.fetch(toFetch, { bodies: '', markSeen: true });

          fetch.on('message', (msg, seqno) => {
            let buffer = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
            });
            msg.once('end', () => {
              emails.push({ raw: buffer, seqno });
            });
          });

          fetch.once('error', reject);
          fetch.once('end', () => {
            imap.end();
          });
        });
      });
    });

    imap.once('end', () => resolve(emails));
    imap.once('error', reject);
    imap.connect();
  });
}

// ── GENERATE AI REPLY ──
async function generateReply(from, subject, body) {
  const isLead = /rent|apartment|unit|tour|showing|available|bedroom|studio|price|lease|apply|application|move.in|iron.?65/i.test(body + subject);
  const isBuyer = /buy|purchase|mortgage|home|house|sell/i.test(body + subject);

  let prompt;
  if (isBuyer) {
    prompt = `You are Ana Haynes, Licensed Realtor at Rosalia Group in New Jersey.
A buyer/seller email came in. Write a SHORT warm professional reply.
- Thank them for reaching out
- Offer to schedule a call: ${BOOKING_FORM_URL}
- Sign off as: Ana Haynes | Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com
FROM: ${from}
SUBJECT: ${subject}
EMAIL: ${body.substring(0, 800)}
Under 120 words. No bullet points. Reply with ONLY the email body.`;
  } else if (isLead) {
    prompt = `You are Ana Haynes, Leasing Manager at Rosalia Group. You manage Iron 65 Apartments in Newark NJ.
A rental inquiry came in. Write a SHORT warm professional reply.
- Thank them for their interest
- Invite them to schedule a tour: ${BOOKING_FORM_URL}
- Sign off as: Ana Haynes | Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com
FROM: ${from}
SUBJECT: ${subject}
EMAIL: ${body.substring(0, 800)}
Under 120 words. No bullet points. Reply with ONLY the email body.`;
  } else {
    prompt = `You are Ana Haynes at Rosalia Group, a real estate company in New Jersey.
An email came in. Write a SHORT professional reply acknowledging it and offering to help.
- Sign off as: Ana Haynes | Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com
FROM: ${from}
SUBJECT: ${subject}
EMAIL: ${body.substring(0, 800)}
Under 100 words. No bullet points. Reply with ONLY the email body.`;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ── SEND REPLY VIA NODEMAILER ──
async function sendReply(to, subject, replyText) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: INBOX_EMAIL, pass: GMAIL_PASS },
  });

  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  await transporter.sendMail({
    from: `"Ana Haynes — Rosalia Group" <${INBOX_EMAIL}>`,
    to,
    subject: replySubject,
    text: replyText,
  });
  console.log('Reply sent to:', to);
}

// ── SAVE LEAD TO SUPABASE ──
async function saveLead(from, subject, body, replyText) {
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
  const fromEmail = emailMatch?.[1] || from;
  const fromName = from.replace(/<[^>]+>/, '').trim().replace(/"/g, '') || null;

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
      body: JSON.stringify({ notes: mergedNotes, replied_at: new Date().toISOString(), email_reply: replyText }),
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

// ── NOTIFY ANA ──
async function notifyAna(from, subject) {
  const msg = `AI replied to email!\nFrom: ${from}\nSubject: ${subject}`;
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: ANA_PHONE, message: msg, key: TEXTBELT_KEY }),
    });
  } catch (err) { console.error('SMS error:', err.message); }
}

// ── HANDLER ──
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (!GMAIL_PASS) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'GMAIL_PASS not set in environment variables' }) };
  }

  try {
    console.log('readmail: fetching unread emails via IMAP...');
    const rawEmails = await fetchUnreadEmails();
    console.log(`Found ${rawEmails.length} unread emails`);

    const results = { processed: 0, skipped: 0, errors: 0 };

    for (const raw of rawEmails) {
      try {
        const parsed = await simpleParser(raw.raw);
        const from = parsed.from?.text || '';
        const subject = parsed.subject || '(no subject)';
        const body = parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '';
        const replyTo = parsed.replyTo?.text || from;

        console.log('Processing:', from, '|', subject);

        if (shouldSkip(from)) {
          console.log('Skipping:', from);
          results.skipped++;
          continue;
        }

        if (!body && !subject) {
          results.skipped++;
          continue;
        }

        const replyText = await generateReply(from, subject, body);
        if (!replyText) {
          results.skipped++;
          continue;
        }

        await sendReply(replyTo, subject, replyText);
        await saveLead(from, subject, body, replyText);
        await notifyAna(from, subject);

        results.processed++;
        console.log('Done:', subject);

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


