const { google } = require('googleapis');
const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
const INBOX_EMAIL = 'inquiries@rosaliagroup.com';
const ANA_PHONE = '+16462269189';
const TEXTBELT_KEY = '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr';
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-form';

// Emails to never auto-reply to
const SKIP_SENDERS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster', 'leads@followupboss.com',
  'notifications', 'automated', 'newsletter', 'unsubscribe',
];

function shouldSkip(from) {
  const f = (from || '').toLowerCase();
  return SKIP_SENDERS.some(s => f.includes(s));
}

// ── GMAIL CLIENT ──
async function getGmailClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
  });
  // Impersonate the inbox
  const authClient = await auth.getClient();
  authClient.subject = INBOX_EMAIL;
  return google.gmail({ version: 'v1', auth: authClient });
}

// ── GET UNREAD EMAILS ──
async function getUnreadEmails(gmail) {
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread -label:auto-replied',
    maxResults: 10,
  });
  return res.data.messages || [];
}

// ── GET EMAIL DETAILS ──
async function getEmailDetails(gmail, messageId) {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  const msg = res.data;
  const headers = msg.payload.headers;

  const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const from = getHeader('From');
  const subject = getHeader('Subject');
  const to = getHeader('To');
  const replyTo = getHeader('Reply-To') || from;
  const messageIdHeader = getHeader('Message-ID');

  // Extract plain text body
  let body = '';
  const extractBody = (parts) => {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body += Buffer.from(part.body.data, 'base64').toString('utf8');
      } else if (part.parts) {
        extractBody(part.parts);
      }
    }
  };

  if (msg.payload.body?.data) {
    body = Buffer.from(msg.payload.body.data, 'base64').toString('utf8');
  } else {
    extractBody(msg.payload.parts);
  }

  // Strip HTML if needed
  if (!body && msg.payload.parts) {
    for (const part of msg.payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        body = Buffer.from(part.body.data, 'base64').toString('utf8')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        break;
      }
    }
  }

  return { from, subject, to, replyTo, messageIdHeader, body, id: messageId, threadId: msg.threadId };
}

// ── GENERATE AI REPLY ──
async function generateReply(email) {
  const isLead = /rent|apartment|unit|tour|showing|available|bedroom|studio|price|lease|apply|application|move.in|iron.?65|iron65/i.test(email.body + email.subject);
  const isBuyer = /buy|purchase|mortgage|home|house|property|sell/i.test(email.body + email.subject);

  let prompt;
  if (isBuyer) {
    prompt = `You are Ana Haynes, Licensed Realtor at Rosalia Group in New Jersey.

An email came in from a potential buyer/seller. Write a SHORT warm professional reply.
- Greet them by name if you can find it in the email
- Thank them for reaching out
- Offer to schedule a quick call or meeting: ${BOOKING_FORM_URL}
- Sign off as: Ana Haynes | Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com

FROM: ${email.from}
SUBJECT: ${email.subject}
EMAIL BODY:
${email.body.substring(0, 1000)}

Under 120 words. No bullet points. Reply with ONLY the email body, no subject line.`;
  } else if (isLead) {
    prompt = `You are Ana Haynes, Leasing Manager at Rosalia Group. You manage Iron 65 Apartments in Newark NJ and other luxury rentals.

A rental inquiry email came in. Write a SHORT warm professional reply.
- Greet them by name if you can find it in the email  
- Thank them for their interest
- Invite them to schedule a tour: ${BOOKING_FORM_URL}
- Mention you have units available and would love to show them around
- Sign off as: Ana Haynes | Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com

FROM: ${email.from}
SUBJECT: ${email.subject}
EMAIL BODY:
${email.body.substring(0, 1000)}

Under 120 words. No bullet points. Reply with ONLY the email body, no subject line.`;
  } else {
    prompt = `You are Ana Haynes at Rosalia Group, a real estate and property management company in New Jersey.

An email came in to your inquiries inbox. Write a SHORT professional reply.
- Acknowledge their email
- Ask how you can help or answer their specific question if clear
- Sign off as: Ana Haynes | Rosalia Group | (551) 249-9795 | inquiries@rosaliagroup.com

FROM: ${email.from}
SUBJECT: ${email.subject}
EMAIL BODY:
${email.body.substring(0, 1000)}

Under 100 words. No bullet points. Reply with ONLY the email body, no subject line.`;
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

// ── SEND REPLY ──
async function sendReply(gmail, email, replyText) {
  const replyTo = email.replyTo || email.from;
  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;

  const rawMessage = [
    `From: Ana Haynes <${INBOX_EMAIL}>`,
    `To: ${replyTo}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${email.messageIdHeader}`,
    `References: ${email.messageIdHeader}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    replyText,
  ].join('\r\n');

  const encoded = Buffer.from(rawMessage).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    resource: { raw: encoded, threadId: email.threadId },
  });

  console.log('Reply sent to:', replyTo, '| Subject:', subject);
}

// ── MARK AS READ + LABEL ──
async function markProcessed(gmail, messageId) {
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    resource: {
      removeLabelIds: ['UNREAD'],
    },
  });
}

// ── SAVE LEAD TO SUPABASE ──
async function saveLead(email, replyText) {
  // Extract email address from "Name <email>" format
  const emailMatch = email.from.match(/<([^>]+)>/) || email.from.match(/([^\s]+@[^\s]+)/);
  const fromEmail = emailMatch?.[1] || email.from;
  const fromName = email.from.replace(/<[^>]+>/, '').trim().replace(/"/g, '') || null;

  // Check existing
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(fromEmail)}&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();

  if (Array.isArray(existing) && existing.length > 0) {
    const newNote = `[${new Date().toLocaleDateString()}] Email: ${email.subject}`;
    const mergedNotes = existing[0].notes ? existing[0].notes + '\n' + newNote : newNote;
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ notes: mergedNotes, replied_at: new Date().toISOString(), email_reply: replyText }),
    });
    console.log('Updated existing lead:', existing[0].id);
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
      message: email.body?.substring(0, 500) || email.subject,
      client: 'rosalia',
      status: 'new',
      replied_at: new Date().toISOString(),
      follow_up_count: 0,
      email_reply: replyText,
      notes: `Subject: ${email.subject}`,
    }),
  });

  const text = await res.text();
  try {
    const saved = JSON.parse(text);
    return Array.isArray(saved) ? saved[0] : saved;
  } catch (e) { return null; }
}

// ── NOTIFY ANA ──
async function notifyAna(email) {
  const fromEmail = email.from.match(/<([^>]+)>/)?.[1] || email.from;
  const msg = `New Email Reply Sent!\nFrom: ${email.from}\nSubject: ${email.subject}\nAI replied automatically.`;
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: ANA_PHONE, message: msg, key: TEXTBELT_KEY }),
    });
  } catch (err) { console.error('SMS error:', err.message); }
}

// ── MAIN HANDLER ──
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    console.log('readmail: starting email check for', INBOX_EMAIL);
    const gmail = await getGmailClient();
    const messages = await getUnreadEmails(gmail);
    console.log(`Found ${messages.length} unread emails`);

    const results = { processed: 0, skipped: 0, errors: 0 };

    for (const msg of messages) {
      try {
        const email = await getEmailDetails(gmail, msg.id);
        console.log('Processing:', email.from, '|', email.subject);

        // Skip automated/noreply emails
        if (shouldSkip(email.from)) {
          console.log('Skipping automated email from:', email.from);
          await markProcessed(gmail, msg.id);
          results.skipped++;
          continue;
        }

        // Skip if body is empty
        if (!email.body && !email.subject) {
          await markProcessed(gmail, msg.id);
          results.skipped++;
          continue;
        }

        // Generate AI reply
        const replyText = await generateReply(email);
        if (!replyText) {
          console.log('No reply generated for:', email.subject);
          results.skipped++;
          continue;
        }

        // Send reply
        await sendReply(gmail, email, replyText);

        // Mark as read
        await markProcessed(gmail, msg.id);

        // Save to Supabase
        await saveLead(email, replyText);

        // Notify Ana
        await notifyAna(email);

        results.processed++;
        console.log('Done processing:', email.subject);

      } catch (err) {
        console.error('Error processing message:', msg.id, err.message);
        results.errors++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, total_unread: messages.length, results }),
    };

  } catch (err) {
    console.error('readmail error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
