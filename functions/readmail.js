const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const INBOX_EMAIL = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const BOOKING_FORM_URL = 'https://silver-ganache-1ee2ca.netlify.app/booking-rosalia';

const VAPI_KEY = '064f441d-a388-4404-8b6c-05e91e90f1ff';
const VAPI_ASSISTANT_ID = '1cae5323-6b83-4434-8461-6330472da140';
const VAPI_PHONE_ID = 'fe01292e-6625-4c06-b24e-8cd2240f5453';

// Ana's property portfolio context (for answering questions)
const ANA_CONTEXT = `
You are the Rosalia Group Inquiries Team â€” a warm, professional leasing team in New Jersey managing multiple luxury apartment communities.

CRITICAL RULES:
- Your #1 goal in every email is to schedule a tour as quickly as possible
- Always include the booking link in every reply
- Prices, availability, and incentives change daily â€” always note that the leasing agent will have the most current information at the tour
- Never confirm specific unit availability â€” say "subject to availability, our leasing agent will confirm at your tour"
- Anyone can schedule a tour regardless of credit score â€” never turn anyone away from touring
- Credit and income requirements are discussed with the leasing agent â€” not a barrier to touring
- Answer questions using the knowledge base, then redirect to booking the tour
- Keep replies concise â€” bullet points for Q&A, under 150 words
- Never use markdown bold (**text**) or italic (*text*)
- Never suggest specific appointment times â€” always direct to the booking link
- Ask for phone number if not provided
- Sign off as: Rosalia Group | Inquiries Team | +18624191763 | inquiries@rosaliagroup.com

PROPERTY KNOWLEDGE BASE:
# ROSALIA GROUP â€” KNOWLEDGE BASE
# Last updated: March 15, 2026
# NOTE: Prices, availability, and incentives change daily. Always direct leads to schedule a tour for the most current information.

## BOOKING LINKS
- All Rosalia properties (general): https://silver-ganache-1ee2ca.netlify.app/booking-rosalia
- Iron 65 specifically: https://silver-ganache-1ee2ca.netlify.app/booking-form
- Reschedule (Rosalia): https://silver-ganache-1ee2ca.netlify.app/reschedule-rosalia
- Reschedule (Iron 65): https://silver-ganache-1ee2ca.netlify.app/reschedule-form

## UTILITIES â€” ALL BUILDINGS
- Electric: tenant pays (all buildings use electric â€” no gas)
- Water & trash: INCLUDED at River Pointe (486 Market), 502 Market, Iron Pointe (39 Madison), 556 Market
- Water & trash: tenant pays at 289 Halsey, 77 Christie, 1369 South Ave, The Elks, Iron 65
- Internet: tenant pays (except Iron 65 â€” 1 year free if applied within 24hrs of tour)

## CREDIT & QUALIFICATION POLICY
- Anyone can schedule a tour regardless of credit score â€” no minimum to tour
- Standard application requirement: 650+ credit score and income ~3x rent
- Below 650 or lower income: still welcome to tour and apply â€” management reviews all applications individually
- TheGuarantors.com and co-signers accepted â€” best to discuss with leasing agent at tour
- Self-employed: 2 years tax returns + bank statements accepted

## PROPERTIES

### 486 MARKET STREET â€” RIVER POINTE, NEWARK NJ
Utilities included: water, trash | Tenant pays: electric
PROMOTIONS: 1 month free on 13 month lease | 2 months free on 24 month lease | $500 security deposit
Pet: $65/month + $500 security | Storage: $300/month | In-unit laundry
Staged unit: 401 (4th floor, balcony) | ONLY 6 UNITS LEFT

Available units:
- Unit 301: 1BR/1BTH, balcony, 642 sqft â€” $2,350/mo
- Unit 302: 1BR/1BTH, balcony, 627 sqft â€” $2,350/mo
- Unit 401: 1BR/1BTH, balcony, 642 sqft â€” $2,375/mo (STAGED)
- Unit 402: 1BR/1BTH, balcony, 627 sqft â€” $2,350/mo
- Unit 403: 1BR/1BTH, balcony, 543 sqft â€” $2,350/mo
- Unit 503: 1BR, balcony, 485 sqft â€” $2,400/mo

### 502 MARKET STREET, NEWARK NJ
Utilities included: water, trash | Tenant pays: electric
PROMOTIONS: 1 month free on 13 month lease | 2 months free on 24 month lease | $500 security deposit
Pet: $65/month + $500 security | Bike storage included | In-unit laundry | ONLY 9 UNITS LEFT

Available units:
- Unit 1D: 1BR, 465 sqft â€” $1,999/mo
- Unit 3D: 1BR, 541 sqft â€” $2,250/mo
- Unit 4A: 2BR, 809 sqft â€” $2,950/mo
- Unit 4D: 1BR, 541 sqft â€” $2,275/mo
- Unit 4E: 1BR, 474 sqft â€” $2,199/mo
- Unit 4F: 1BR, 480 sqft â€” $2,199/mo
- Unit 5A: 2BR, 809 sqft â€” $3,050/mo
- Unit 5D: 1BR, 541 sqft â€” $2,300/mo
- Unit 5E: 1BR, 474 sqft â€” $2,250/mo

### 39 MADISON STREET â€” IRON POINTE, NEWARK NJ
Utilities included: water, trash | Tenant pays: electric
Parking: $300/mo | Pet: $75/mo + $500 security | Bike storage: $25/mo
Gym: $100/mo full amenity access | Rooftop | Lounge | Office desk | Secure package lockers | In-unit laundry
8 min walk to Newark Penn Station | Staged unit: 505 (5th floor) | 18 UNITS AVAILABLE

Available units:
- Unit 101: 1BR/1BTH, 725 sqft, backyard â€” $2,750/mo
- Unit 102: 1BR/1BTH, 670 sqft, backyard â€” $2,750/mo
- Unit 213: 1BR/1BTH, 680 sqft, terrace â€” $2,650/mo
- Unit 301: 1BR/1BTH, 725 sqft â€” $2,600/mo
- Unit 303: 2BR/1BTH, 1005 sqft â€” $3,300/mo
- Unit 313: 1BR/1BTH, 680 sqft â€” $2,650/mo
- Unit 408: 1BR/1BTH, 697 sqft â€” $2,600/mo
- Unit 411: 1BR/1BTH, 705 sqft â€” $2,600/mo
- Unit 417: 1BR/1BTH, 560 sqft â€” $2,600/mo
- Unit 418: 1BR/1BTH, 580 sqft â€” $2,500/mo
- Unit 503: 2BR/1BTH, 1005 sqft â€” $3,500/mo
- Unit 505: 1BR/1BTH, 538 sqft â€” $2,500/mo (STAGED)
- Unit 511: 1BR/1BTH, 705 sqft â€” $2,600/mo
- Unit 512: 1BR/1BTH, 640 sqft â€” $2,600/mo
- Unit 513: 1BR/1BTH, 680 sqft â€” $2,700/mo
- Unit 514: 1BR/1BTH, 735 sqft â€” $2,700/mo
- Unit 517: 1BR/1BTH, 560 sqft â€” $2,500/mo
- Unit 518: 1BR/1BTH, 580 sqft â€” $2,400/mo

### 556 MARKET STREET, NEWARK NJ
Utilities included: water, trash | Tenant pays: electric
PROMOTIONS: 1 month free on 13 month lease | 2 months free on 24 month lease | $500 security deposit
In-unit laundry | Access: ring front door bell

Available units:
- Unit 2B: 1BR/1BTH â€” $2,199/mo
- Unit 3A: 1BR/1BTH â€” $2,199/mo
- Unit 4A: 1BR/1BTH â€” $2,199/mo
- Unit 5A: 1BR/1BTH â€” $2,199/mo
- Unit 5B: 1BR/1BTH â€” $2,299/mo

### 289 HALSEY STREET, NEWARK NJ
Utilities included: none | Tenant pays: electric, water, trash
PROMOTIONS: 1 month free on 13 month lease | 6 months free parking on 18 month lease
Balcony units available | In-unit laundry

Available units:
- Unit 202: 1BR/1BTH, balcony, 692 sqft â€” $2,300/mo
- Unit 203: 1BR/1BTH, balcony, 657 sqft â€” $2,300/mo
- Unit 205: 1BR/1BTH, balcony, 745 sqft â€” $2,350/mo
- Unit 206: 1BR/1BTH, balcony, 700 sqft â€” $2,350/mo
- Unit 504: 1BR/1BTH, 755 sqft â€” $2,275/mo
- Unit 508: 1BR/1BTH, 700 sqft â€” $2,250/mo

### 77 CHRISTIE STREET, NEWARK NJ
Utilities included: none | Tenant pays: electric, water, trash
Contact leasing team for current availability and pricing.

### 1369 SOUTH AVENUE, PLAINFIELD NJ
Utilities included: none | Tenant pays: electric, water, sewer, trash
Parking: 1 free spot per tenant | Additional: $175/mo
Pet: $50/mo per pet + $250 non-refundable deposit
Gym on 2nd floor | In-unit washer/dryer | Laundry on each floor

Available units:
- Store/Commercial: 1700 sqft â€” $3,600/mo
- Unit 302: 2BR/2BTH, 1020 sqft â€” $2,775/mo
- Unit 305: 2BR/2BTH, 1060 sqft â€” $2,795/mo (moving out end of May)

### THE ELKS â€” 475 MAIN ST, ORANGE NJ
Utilities included: none | Tenant pays: electric, water, trash
Studios from $1,955/mo | 1BR, 2BR, 3BR available
Private balconies on select units | Steps from Orange train station
Climate-controlled parking | Bike storage
Tour booking: https://silver-ganache-1ee2ca.netlify.app/booking-rosalia

### 65 MCWHORTER ST â€” IRON 65, NEWARK NJ
Utilities included: none | Tenant pays: electric, water, trash
Brand new luxury building in Ironbound District
Studios from $2,199/mo | Studio Plus from $2,499/mo
1BR from $2,724/mo | 1BR Plus from $2,914/mo
Flex 1.5BR from $3,288/mo | Lofts from $3,488/mo | Duplexes from $3,600/mo
PROMOTIONS: 1 month free on 12 month lease | $4,000 rent credit on 18 month lease | 2 months free on 24 month lease
Free internet 1 year (apply within 24hrs of tour) | Amenities fee waived 12 months | Security deposit: $1,000
Amenities: Rooftop with NYC skyline views | Fitness center | Yoga studio | Cold plunge | Saunas | Outdoor kitchen | Game room | Business center | Pet park | Bike storage | Front desk 7 days | Doorman | Security | In-unit W/D
Tours: Tue-Fri 12pm-6pm | Sat-Sun 12pm-4pm
Tour booking: https://silver-ganache-1ee2ca.netlify.app/booking-form

## FAQ
Q: Are utilities included?
A: Depends on the building. Water and trash are included at River Pointe, 502 Market, Iron Pointe, and 556 Market. All other buildings tenants pay their own electric, water, and trash. There is no gas in any building â€” all electric.

Q: What credit score do I need?
A: Anyone can schedule a tour regardless of credit score. Our standard application requirement is 650+ but management reviews every application individually. TheGuarantors.com and co-signers are accepted options â€” best to discuss with the leasing agent at your tour.

Q: Do you allow pets?
A: Yes at most properties. Fees vary by building â€” typically $50-75/month plus a security deposit.

Q: Is there parking?
A: Iron Pointe: $300/mo indoor. 1369 South Ave: 1 free spot per tenant. Others: ask at tour.

Q: Do you offer short term leases?
A: Standard terms are 12-24 months. Shorter arrangements reviewed case by case.

Q: What documents do I need to apply?
A: 2-3 recent pay stubs, or 2 years tax returns if self-employed. Bank statements are helpful.

Q: I am self-employed, can I qualify?
A: Yes â€” provide 2 years tax returns and bank statements showing consistent income (~3x rent).

Q: I just moved to the US and have no US credit history.
A: TheGuarantors.com is specifically designed for this. Management also reviews case by case.

Q: Are roommates or joint leases allowed?
A: Yes â€” both applicants qualify individually. Combined income of ~3x rent required.
`;

const SKIP_SENDERS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster', 'leads@followupboss.com',
  'notifications', 'automated', 'newsletter', 'unsubscribe',
  'realtor.com', 'planhub', 'rentspree',
  'followupboss.com', 'voice.google.com',
  'txt.voice.google', 'comet.zillow', 'mail.zillow',
  'zillowrentals', 'mail.realtor', 'mail.instagram',
  'no-reply@mail.zillow', 'market-updates@', 'recommendations@',
  'rosaliagroup.com', 'mechanicalenterprise.com',
];

// Zillow convo emails ARE real leads - allow them through
function isZillowLead(from) {
  return from.toLowerCase().includes('convo.zillow.com');
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
  const propMatch = body.match(/interested in your property at ([^\n\.]+)/i);
  if (nameMatch) lead.name = nameMatch[1].trim();
  if (emailMatch) lead.email = emailMatch[1].trim();
  if (phoneMatch) {
    let p = phoneMatch[1].replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11) p = '+' + p;
    lead.phone = p;
  }
  if (propMatch) lead.property = propMatch[1].trim();
  return lead;
}

function parseWebflowEmail(body) {
  const lead = {};
  const nameMatch = body.match(/Full Name:\s*(.+)/i);
  const emailMatch = body.match(/Email Address:\s*([^\s\n]+@[^\s\n]+)/i) || body.match(/Email:\s*([^\s\n]+@[^\s\n]+)/i);
  const phoneMatch = body.match(/Cell Phone:\s*([\d\s\(\)\-\.]+)/i) || body.match(/Phone:\s*([\d\s\(\)\-\.]+)/i);
  const budgetMatch = body.match(/Monthly Budget[^:]*:\s*([\d,\$]+)/i) || body.match(/Budget:\s*([\d,\$]+)/i);
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
  if (budgetMatch) lead.budget = budgetMatch[1].trim();
  if (buildingMatch) lead.property = buildingMatch[1].split('--')[0].trim();
  if (bedroomsMatch) lead.bedrooms = bedroomsMatch[1].split('--')[0].trim();
  return lead;
}


const LEAD_KEYWORDS = /rent|apartment|unit|tour|showing|available|bedroom|studio|price|lease|apply|application|move.in|listing|looking|interested|inquiry|inquire|buy|purchase|mortgage|home|house|sell|property|schedule|viewing|question|info|information/i;

function shouldSkip(from, subject) {
  if (isZillowLead(from)) return false;
  if (isAvailLead(from)) return false;
  if (isWebflowLead(from, subject)) return false;
  const f = (from || '').toLowerCase();
  return SKIP_SENDERS.some(s => f.includes(s));
}

function isLead(subject, body, from) {
  if (isZillowLead(from || '')) return true;
  if (isAvailLead(from || '')) return true;
  if (isWebflowLead(from || '', subject)) return true;
  return LEAD_KEYWORDS.test((subject || '') + ' ' + (body || ''));
}

function extractPhone(text) {
  const match = text.match(/(\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})/);
  if (!match) return null;
  let p = match[1].replace(/\D/g, '');
  if (p.length === 10) p = '+1' + p;
  else if (p.length === 11) p = '+' + p;
  return p;
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
          if (!results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          const toFetch = results.slice(0, 5);
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

async function generateReply(from, subject, body, previousReply) {
  const isBuyer = /buy|purchase|mortgage|home|house|sell/i.test(body + subject);

  // Build conversation context if this is a reply thread
  let threadContext = '';
  if (previousReply) {
    threadContext = `\n\nPREVIOUS REPLY YOU SENT:\n${previousReply}\n\nThe lead is now replying to that. Answer their follow-up question or continue the conversation naturally.`;
  }

  const role = isBuyer
    ? 'a licensed real estate agent helping buyers and sellers'
    : 'a leasing manager helping people find rental apartments';

  const prompt = `${ANA_CONTEXT}

You are ${role}.

${previousReply ? 'A lead is REPLYING to your previous email. Read their reply and respond to what they are asking or saying.' : 'A new inquiry email came in. Reply warmly and ask about their needs.'}
${threadContext}

FROM: ${from}
SUBJECT: ${subject}
THEIR EMAIL:
${body.substring(0, 800)}

Write ONLY the email body. No subject line. Under 100 words. Use bullet points for Q&A answers. No markdown formatting ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no **bold**, no *italic*. Never suggest specific times or availability.`;

  console.log('Calling Claude API...');
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
  console.log('Claude response type:', data.type);
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
  // Convert URLs to clickable links and remove markdown in HTML email
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VAPI_KEY}`,
      },
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
  const firstName = leadName?.split(' ')[0] || 'there';
  const msg = `Hi ${firstName}! This is the Rosalia Group Inquiries Team. We replied to your inquiry and would love to help you find the perfect apartment. Book a tour: ${BOOKING_FORM_URL} | (862) 419-1814`;
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

async function notifyAna(fromName, subject, phone) {
  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
    await transporter.sendMail({
      from: `"Rosalia AI System" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject: `New Lead: ${fromName || 'Unknown'}`,
      text: `New lead email received!\n\nFrom: ${fromName}\nSubject: ${subject}${phone ? '\nPhone: ' + phone + '\nAlex is calling...' : '\nNo phone Ã¢â‚¬â€ reply sent'}`,
    });
  } catch (err) { console.error('Ana email notification error:', err.message); }
}


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
        if (isAvailLead(from)) {
          const parsed = parseAvailEmail(body);
          if (parsed.phone) phone = parsed.phone;
          if (parsed.email) realEmail = parsed.email;
          if (parsed.name) realName = parsed.name;
          console.log('Avail lead - Name:', realName, 'Email:', realEmail, 'Phone:', phone);
        } else if (isWebflowLead(from, subject)) {
          const parsed = parseWebflowEmail(body);
          if (parsed.phone) phone = parsed.phone;
          if (parsed.email) realEmail = parsed.email;
          if (parsed.name) realName = parsed.name;
          console.log('Webflow lead - Name:', realName, 'Email:', realEmail, 'Phone:', phone);
        } else {
          phone = extractPhone(body + ' ' + subject);
        }
        console.log('Lead detected! Phone:', phone || 'none found');

        // Skip if replied recently (prevents double replies)
        if (await repliedRecently(fromEmail)) {
          console.log('Skipping (replied recently):', fromEmail);
          results.skipped++;
          continue;
        }

        // Get previous thread context
        const previousReply = await getPreviousThread(fromEmail);
        const isReply = subject.toLowerCase().startsWith('re:') || !!previousReply;
        if (isReply) console.log('Thread reply detected - using conversation context');

        // Generate AI reply with context
        const replyText = await generateReply(from, subject, body, previousReply);
        if (!replyText) {
          console.log('No reply generated');
          results.skipped++;
          continue;
        }

        // Send email reply
        await sendReply(replyTo, subject, replyText);

        // Save to Supabase
        await saveLead(realEmail || fromEmail, realName || fromName, subject, body, replyText, phone);

        // Notify Ana
        await notifyAna(realName || fromName || from, subject, phone);

        // Trigger call if NEW phone found (even in reply thread)
        if (phone) {
          const existingLead = await getLeadData(fromEmail);
          const hadPhone = existingLead?.phone && existingLead.phone.replace(/\D/g,'').length >= 10;
          if (!hadPhone) {
            await triggerCall(phone, fromName);
            await sendSMS(phone, fromName);
          } else if (!isReply) {
            await triggerCall(phone, fromName);
            await sendSMS(phone, fromName);
          }
        }

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





