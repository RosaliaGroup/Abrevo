const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoa2dwZXBrd2lieGJ4c2VwZXRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMyNjczNCwiZXhwIjoyMDg3OTAyNzM0fQ.k4MG4RGSjUiyQZ6m_U4BvWl3T60BwFPhucaoboeB9m4';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const INBOX_EMAIL = 'inquiries@rosaliagroup.com';
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const BOOKING_FORM_URL = 'https://book.rosaliagroup.com/book';
const IRON65_BOOKING_URL = 'https://book.rosaliagroup.com/iron65';
const TEXTBELT_KEY = process.env.TEXTBELT_KEY;

const VAPI_KEY = process.env.VAPI_KEY || '064f441d-a388-4404-8b6c-05e91e90f1ff';
const VAPI_ASSISTANT_ID = '1cae5323-6b83-4434-8461-6330472da140';
const VAPI_PHONE_ID = process.env.VAPI_PHONE_ID || '2e2b6713-f631-4e9e-95fa-3418ecc77c0a';

const ANA_CONTEXT = `
You are the Rosalia Group Inquiries Team  a warm, professional leasing team in New Jersey managing multiple luxury apartment communities.

CRITICAL RULES:
- Your #1 goal in every email is to schedule a tour as quickly as possible  regardless of which property they ask about
- ALWAYS use the lead's first name in the greeting  never say "Hi there"  use "Hi [Name]" using the name from the FROM field
- Do NOT proactively mention or discuss other properties  only answer what was asked, then push to book the tour
- If someone asks about a property NOT in the knowledge base, say "I'd love to get you connected with our leasing team" and send the booking link  do not discuss other properties
- For ANY property or unit questions, always say "Our leasing agent will be best able to answer that at your tour" then send booking link
- Always include the booking link in every reply
- Prequalify in every first reply: naturally ask for unit size, move-in date, budget, and phone number
- Prices, availability, and incentives change daily  the leasing agent will have the most current information at the tour
- Never confirm specific unit availability  the leasing agent will confirm at the tour
- Anyone can schedule a tour regardless of credit score  never turn anyone away
- If someone asks about Section 8, housing vouchers, or rental assistance programs: say "We welcome all legal sources of income. We show the apartment to everyone  our management team reviews all applications individually including credit criteria. Schedule a tour and our leasing agent will walk you through the process"
- All legal sources of income accepted  management reviews all applications
- Never discuss income or credit as a barrier to touring  only the leasing agent discusses this at the tour
- Keep replies SHORT — 3 sentences maximum, then the booking link on its own line
- Answer the specific question asked in ONE sentence — do not volunteer extra info
- Always lead with NET EFFECTIVE rent using these EXACT formulas:
  * 13-month lease, 1 month free: gross x 12/13 (e.g. $2,199 x 12/13 = $2,029.84)
  * 13-month lease, 1 month free + apply within 24hrs of tour (half month additional): gross x 11.5/13 (e.g. $2,199 x 11.5/13 = $1,945.00)
  * 24-month lease, 2 months free: gross x 22/24 (e.g. $2,199 x 22/24 = $2,015.75)
  * 24-month lease, 2 months free + apply within 24hrs of tour (half month additional): gross x 21.5/24 (e.g. $2,199 x 21.5/24 = $1,969.94)
  * Iron 65 18-month lease, $4,000 rent credit: (gross x 18 - 4000) / 18
  * Always show both the 13-month and 24-month effective rates
  * Always mention the 24-hour application bonus saves an additional half month
- Never use markdown bold (**text**) or italic (*text*)
- Never suggest specific appointment times  always direct to the booking link
- Ask for phone number if not provided
- NEVER confirm or deny existing appointments you don't have record of  say "let me confirm with our leasing team and we will reach out shortly"
- Sign off as: Rosalia Group | Inquiries Team | +18624191763 | inquiries@rosaliagroup.com

PROPERTY KNOWLEDGE BASE:
# ROSALIA GROUP  KNOWLEDGE BASE
# Last updated: March 15, 2026
# NOTE: Prices, availability, and incentives change daily. Always direct leads to schedule a tour for the most current information.

## BOOKING LINKS
- All Rosalia properties (general): https://book.rosaliagroup.com/book
- Iron 65 specifically: https://book.rosaliagroup.com/iron65
- Reschedule (Rosalia): https://book.rosaliagroup.com/reschedule
- Reschedule (Iron 65): https://book.rosaliagroup.com/iron65-reschedule

## UTILITIES  ALL BUILDINGS
- Electric: tenant pays (all buildings use electric  no gas)
- Water & trash: INCLUDED at River Pointe (486 Market), 502 Market, Iron Pointe (39 Madison), 556 Market
- Water & trash: tenant pays at 289 Halsey, 77 Christie, 1369 South Ave, The Elks, Iron 65
- Internet: tenant pays (except Iron 65  1 year free if applied within 24hrs of tour)

## CREDIT & QUALIFICATION POLICY
- Anyone can schedule a tour regardless of credit score  no minimum to tour
- Standard application requirement: 650+ credit score and income ~3x rent
- Below 650 or lower income: still welcome to tour and apply  management reviews all applications individually
- TheGuarantors.com and co-signers accepted  best to discuss with leasing agent at tour
- Self-employed: 2 years tax returns + bank statements accepted

## PROPERTIES

### 486 MARKET STREET  RIVER POINTE, NEWARK NJ
Utilities included: water, trash | Tenant pays: electric
PROMOTIONS: 1 month free on 13 month lease | 2 months free on 24 month lease | $500 security deposit
Pet: $65/month + $500 security | Storage: $300/month | In-unit laundry
Staged unit: 401 (4th floor, balcony) | ONLY 6 UNITS LEFT
Available units:
- Unit 301: 1BR/1BTH, balcony, 642 sqft  $2,350/mo
- Unit 302: 1BR/1BTH, balcony, 627 sqft  $2,350/mo
- Unit 401: 1BR/1BTH, balcony, 642 sqft  $2,375/mo (STAGED)
- Unit 402: 1BR/1BTH, balcony, 627 sqft  $2,350/mo
- Unit 403: 1BR/1BTH, balcony, 543 sqft  $2,350/mo
- Unit 503: 1BR, balcony, 485 sqft  $2,400/mo

### 502 MARKET STREET, NEWARK NJ
Utilities included: water, trash | Tenant pays: electric
PROMOTIONS: 1 month free on 13 month lease | 2 months free on 24 month lease | $500 security deposit
Pet: $65/month + $500 security | Bike storage included | In-unit laundry | ONLY 9 UNITS LEFT
Available units:
- Unit 1D: 1BR, 465 sqft  $1,999/mo
- Unit 3D: 1BR, 541 sqft  $2,250/mo
- Unit 4A: 2BR, 809 sqft  $2,950/mo
- Unit 4D: 1BR, 541 sqft  $2,275/mo
- Unit 4E: 1BR, 474 sqft  $2,199/mo
- Unit 4F: 1BR, 480 sqft  $2,199/mo
- Unit 5A: 2BR, 809 sqft  $3,050/mo
- Unit 5D: 1BR, 541 sqft  $2,300/mo
- Unit 5E: 1BR, 474 sqft  $2,250/mo

### 39 MADISON STREET  IRON POINTE, NEWARK NJ
Utilities included: water, trash | Tenant pays: electric
Parking: $300/mo | Pet: $75/mo + $500 security | Bike storage: $25/mo
Gym: $100/mo full amenity access | Rooftop | Lounge | Office desk | Secure package lockers | In-unit laundry
8 min walk to Newark Penn Station | Staged unit: 505 (5th floor) | 18 UNITS AVAILABLE
Available units:
- Unit 101: 1BR/1BTH, 725 sqft, backyard  $2,750/mo
- Unit 102: 1BR/1BTH, 670 sqft, backyard  $2,750/mo
- Unit 213: 1BR/1BTH, 680 sqft, terrace  $2,650/mo
- Unit 301: 1BR/1BTH, 725 sqft  $2,600/mo
- Unit 303: 2BR/1BTH, 1005 sqft  $3,300/mo
- Unit 313: 1BR/1BTH, 680 sqft  $2,650/mo
- Unit 408: 1BR/1BTH, 697 sqft  $2,600/mo
- Unit 411: 1BR/1BTH, 705 sqft  $2,600/mo
- Unit 417: 1BR/1BTH, 560 sqft  $2,600/mo
- Unit 418: 1BR/1BTH, 580 sqft  $2,500/mo
- Unit 503: 2BR/1BTH, 1005 sqft  $3,500/mo
- Unit 505: 1BR/1BTH, 538 sqft  $2,500/mo (STAGED)
- Unit 511: 1BR/1BTH, 705 sqft  $2,600/mo
- Unit 512: 1BR/1BTH, 640 sqft  $2,600/mo
- Unit 513: 1BR/1BTH, 680 sqft  $2,700/mo
- Unit 514: 1BR/1BTH, 735 sqft  $2,700/mo
- Unit 517: 1BR/1BTH, 560 sqft  $2,500/mo
- Unit 518: 1BR/1BTH, 580 sqft  $2,400/mo

### 556 MARKET STREET, NEWARK NJ
Utilities included: water, trash | Tenant pays: electric
PROMOTIONS: 1 month free on 13 month lease | 2 months free on 24 month lease | $500 security deposit
In-unit laundry | Access: ring front door bell
Available units:
- Unit 2B: 1BR/1BTH  $2,199/mo
- Unit 3A: 1BR/1BTH  $2,199/mo
- Unit 4A: 1BR/1BTH  $2,199/mo
- Unit 5A: 1BR/1BTH  $2,199/mo
- Unit 5B: 1BR/1BTH  $2,299/mo

### 289 HALSEY STREET, NEWARK NJ
Utilities included: none | Tenant pays: electric, water, trash
PROMOTIONS: 1 month free on 13 month lease | 6 months free parking on 18 month lease
Balcony units available | In-unit laundry
Available units:
- Unit 202: 1BR/1BTH, balcony, 692 sqft  $2,300/mo
- Unit 203: 1BR/1BTH, balcony, 657 sqft  $2,300/mo
- Unit 205: 1BR/1BTH, balcony, 745 sqft  $2,350/mo
- Unit 206: 1BR/1BTH, balcony, 700 sqft  $2,350/mo
- Unit 504: 1BR/1BTH, 755 sqft  $2,275/mo
- Unit 508: 1BR/1BTH, 700 sqft  $2,250/mo

### 77 CHRISTIE STREET, NEWARK NJ
Utilities included: none | Tenant pays: electric, water, trash
Contact leasing team for current availability and pricing.

### 1369 SOUTH AVENUE, PLAINFIELD NJ
Utilities included: none | Tenant pays: electric, water, sewer, trash
Parking: 1 free spot per tenant | Additional: $175/mo
Pet: $50/mo per pet + $250 non-refundable deposit
Gym on 2nd floor | In-unit washer/dryer | Laundry on each floor
Available units:
- Store/Commercial: 1700 sqft  $3,600/mo
- Unit 302: 2BR/2BTH, 1020 sqft  $2,775/mo
- Unit 305: 2BR/2BTH, 1060 sqft  $2,795/mo (moving out end of May)

### THE ELKS  475 MAIN ST, ORANGE NJ
Utilities included: none | Tenant pays: electric, water, trash
Studios from $1,955/mo | 1BR, 2BR, 3BR available
Private balconies on select units | Steps from Orange train station
Climate-controlled parking | Bike storage
Tour booking: https://book.rosaliagroup.com/book

### 65 MCWHORTER ST  IRON 65, NEWARK NJ
Utilities included: none | Tenant pays: electric, water, trash
Brand new luxury building in Ironbound District
Studios from $2,199/mo | Studio Plus from $2,499/mo
1BR from $2,724/mo | 1BR Plus from $2,914/mo
Flex 1.5BR from $3,288/mo | Lofts from $3,488/mo | Duplexes from $3,600/mo
PROMOTIONS: 1 month free on 12 month lease | $4,000 rent credit on 18 month lease | 2 months free on 24 month lease
NET EFFECTIVE CALCULATIONS (Iron 65):
- Studios $2,199: 12mo net = $2,015.75/mo | 24mo net = $2,015.75/mo | 24mo+24hr = $1,969.94/mo
- 1BR $2,724: 12mo net = $2,497.00/mo | 24mo net = $2,497.00/mo | 24mo+24hr = $2,440.75/mo
- Apply within 24hrs of tour = additional half month free (saves ~$100-175/mo effective)
Free internet 1 year (apply within 24hrs of tour) | Amenities fee waived 12 months | Security deposit: $1,000
Amenities: Rooftop with NYC skyline views | Fitness center | Yoga studio | Cold plunge | Saunas | Outdoor kitchen | Game room | Business center | Pet park | Bike storage | Front desk 7 days | Doorman | Security | In-unit W/D
Tours: Tue-Fri 12pm-6pm | Sat-Sun 12pm-4pm
Tour booking: https://book.rosaliagroup.com/iron65

## FAQ
Q: Are utilities included?
A: Depends on the building. Water and trash are included at River Pointe, 502 Market, Iron Pointe, and 556 Market. All other buildings tenants pay their own electric, water, and trash. There is no gas in any building  all electric.

Q: What credit score do I need?
A: Anyone can schedule a tour regardless of credit score. Our standard application requirement is 650+ but management reviews every application individually. TheGuarantors.com and co-signers are accepted options  best to discuss with the leasing agent at your tour.

Q: Do you allow pets?
A: Yes at most properties. Fees vary by building  typically $50-75/month plus a security deposit.

Q: Is there parking?
A: Iron Pointe: $300/mo indoor. 1369 South Ave: 1 free spot per tenant. Others: ask at tour.

Q: Do you offer short term leases?
A: Standard terms are 12-24 months. Shorter arrangements reviewed case by case.

Q: What documents do I need to apply?
A: 2-3 recent pay stubs, or 2 years tax returns if self-employed. Bank statements are helpful.

Q: I am self-employed, can I qualify?
A: Yes  provide 2 years tax returns and bank statements showing consistent income (~3x rent).

Q: I just moved to the US and have no US credit history.
A: TheGuarantors.com is specifically designed for this. Management also reviews case by case.

Q: Are roommates or joint leases allowed?
A: Yes  both applicants qualify individually. Combined income of ~3x rent required.
`;

const SKIP_SENDERS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster',
  'notifications', 'automated', 'newsletter', 'unsubscribe',
  'realtor.com', 'planhub', 'rentspree',
  'voice.google.com',
  'txt.voice.google', 'mail.zillow',
  'zillowrentals', 'mail.realtor', 'mail.instagram',
  'no-reply@mail.zillow', 'market-updates@', 'recommendations@',
  'rosaliagroup.com', 'mechanicalenterprise.com',
  'no-reply@webflow.com', 'no-reply-forms@webflow.com',
  // FUB system emails - DO NOT skip followupboss.com (FUB lead notifications must be processed)
  // Common notification senders
  'alert@', 'alerts@', 'billing@', 'invoice@', 'receipt@',
  'support@', 'help@', 'info@', 'admin@', 'system@',
  'update@', 'updates@', 'digest@', 'summary@', 'report@',
  'notification@', 'notify@', 'bounce@', 'feedback@',
  // Marketing / bulk senders
  'mailchimp', 'sendgrid', 'constantcontact', 'hubspot',
  'campaign', 'promo@', 'marketing@', 'news@',
  // Social media notifications
  'facebookmail.com', 'instagram.com', 'twitter.com',
  'linkedin.com', 'pinterest.com', 'tiktok.com',
  // Payment / service notifications
  'paypal.com', 'stripe.com', 'square.com', 'venmo.com',
  'google.com', 'apple.com', 'microsoft.com', 'amazon.com',
  // Property listing site notifications (not lead emails)
  'apartments.com', 'trulia.com', 'hotpads.com', 'rent.com',
  'streeteasy.com', 'compass.com', 'redfin.com',
];

// Subjects that indicate system/notification emails, not lead inquiries
const SKIP_SUBJECTS = [
  'password reset', 'verify your email', 'confirm your',
  'receipt for', 'invoice', 'payment received', 'billing',
  'scheduled report', 'daily digest', 'weekly summary',
  'out of office', 'auto-reply', 'automatic reply',
  'delivery status', 'undeliverable', 'returned mail',
  'security alert', 'sign-in', 'login notification',
  'subscription', 'unsubscribe', 'opt out',
  'lead assigned', 'task reminder', 'action plan',
  'stage changed', 'deal updated', 'note added',
  'hot sheet', 'follow up boss hot sheet',
  'daily hot leads', 'no appointments',
];

function isZillowLead(from) {
  const f = from.toLowerCase();
  return f.includes('convo.zillow.com') || f.includes('comet.zillow.com');
}
function isAvailDigest(subject) {
  const s = (subject || '').toLowerCase();
  return s.includes('you have received') && s.includes('messages on avail');
}


function isFUBLead(from, subject) {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  // Hot Sheet is a daily digest, not a lead
  if (s.includes('hot sheet')) return false;
  // Direct FUB emails (by domain or display name)
  if (f.includes('followupboss.com')) return true;
  if (f.includes('follow up boss')) return true;
  // Forwarded FUB lead notifications (Fwd: New Lead from Facebook)
  if (s.includes('new lead from') || s.includes('fwd: new lead')) return true;
  // FUB subject patterns
  if (s.includes('new lead -') || s.includes('lead from facebook') || 
      s.includes('lead from instagram') || s.includes('lead from zillow')) return true;
  return false;
}

function parseFUBEmail(body) {
  const lead = {};
  const lines2 = (body || '').split(/[\n\r]+/);
  for (const line of lines2) {
    const nm = line.match(/new lead named ([^(\n]+)/i);
    if (nm) { 
      let name = nm[1].trim();
      // Remove "from Facebook/Instagram/Zillow" suffix
      name = name.replace(/\s+from\s+(Facebook|Instagram|Zillow|Google|Web).*/i, '').trim();
      lead.name = name; 
      break; 
    }
  }
  const phoneM = body.match(/(\(\d{3}\)\s*\d{3}[\s\-]\d{4})/);
  if (phoneM) { let p = phoneM[1].replace(/\D/g,''); if(p.length===10) p='+1'+p; lead.phone = p; }
  const emailM = body.match(/([a-zA-Z0-9._%+\-]+@(?!followupboss)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  if (emailM) lead.email = emailM[1].trim();
  // Fallback: extract name from subject "New Lead from Facebook - Denise Turner"
  if (!lead.name) {
    const subjectName = (body || '').match(/New Lead from \w+ - ([^\n]+)/i);
    if (subjectName) lead.name = subjectName[1].trim();
  }
  const srcM = body.match(/from (Facebook|Instagram|Zillow|Google)/i);
  if (srcM) lead.source = srcM[1].toLowerCase();
  return lead;
}

function isAvailLead(from) {
  const f = from.toLowerCase();
  return f.includes('reply.avail.co') || f.includes('@avail.co');
}
function isWebflowLead(from, subject) {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  return (f.includes('webflow.com') || f.includes('resipointe')) &&
         (s.includes('submission') || s.includes('application') || s.includes('new form') || s.includes('new lead'));
}

function parseAvailEmail(body) {
  const lead = {};
  // Normalize common HTML artifacts: multiple spaces, &amp;, &nbsp; etc
  const normalized = (body || '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  const nameMatch = normalized.match(/Name:\s*([^\n\r]+?)(?:\s+Email:|\s+Phone:|\s+Message:|$)/i);
  const emailMatch = normalized.match(/Email:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  const phoneMatch = normalized.match(/Phone:\s*([\+\d\s\(\)\-\.]{7,})/i) || normalized.match(/Phone:\s*(\d{10,})/i);

  if (nameMatch) lead.name = nameMatch[1].trim().replace(/\s+/g, ' ');
  if (emailMatch) {
    const email = emailMatch[1].trim();
    if (!email.includes('avail.co')) lead.email = email;
  }
  if (phoneMatch) {
    let p = phoneMatch[1].replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11 && p.startsWith('1')) p = '+' + p;
    else if (p.length === 11) p = '+' + p;
    if (p.length >= 11) lead.phone = p;
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
  // Known lead sources always pass through
  if (isZillowLead(from)) return false;
  if (isAvailLead(from)) return false;
  if (isWebflowLead(from, subject)) return false;

  // Avail digest is a notification, not a lead
  if (isAvailDigest(subject)) return true;

  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();

  // FUB lead notifications MUST be checked before any subject/sender filters
  if (isFUBLead(from, subject)) return false;

  // Skip any sender matching skip list
  if (SKIP_SENDERS.some(skip => f.includes(skip))) return true;

  // Skip system/notification subjects
  if (SKIP_SUBJECTS.some(skip => s.includes(skip))) return true;

  // Skip emails from our own domains
  if (f.includes('useabrevo.co') || f.includes('abrevo.co')) return true;

  // Skip emails with no real sender name (likely automated)
  if (f.match(/^[a-f0-9]{8,}@/)) return true;

  return false;
}

function isLead(subject, body, from) {
  // Known lead sources
  if (isZillowLead(from || '')) return true;
  if (isAvailLead(from || '')) return true;
  if (isWebflowLead(from || '', subject)) return true;
  if (isFUBLead(from || '', subject || '')) return true;

  const s = (subject || '').toLowerCase();
  const b = (body || '').toLowerCase();
  const combined = s + ' ' + b;

  // Must match lead keywords
  if (!LEAD_KEYWORDS.test(combined)) return false;

  // Reject if subject looks like a notification/system email
  if (/unsubscribe|opt.out|do not reply|automated|no.reply/i.test(combined)) return false;

  // Reject if body is too short to be a real inquiry (likely a notification)
  if (b.length < 20) return false;

  return true;
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
          const toFetch = results.slice(0, 20);
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

async function repliedRecently(fromEmail, hours = 24) {
  const lead = await getLeadData(fromEmail);
  if (!lead?.replied_at) return false;
  const lastReply = new Date(lead.replied_at);
  const hoursSince = (Date.now() - lastReply.getTime()) / (1000 * 60 * 60);
  if (hoursSince < hours) {
    console.log(`Duplicate check: already replied to ${fromEmail} ${hoursSince.toFixed(1)} hours ago, skipping`);
    return true;
  }
  return false;
}

async function generateReply(from, subject, body, previousReply, leadContext, calendarAppt, leadName, leadClient) {
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
      detectedCity = `\nIMPORTANT: This inquiry is about a property in ${city}  make sure your reply references the correct city and property.`;
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

${previousReply ? 'A lead is REPLYING to your previous email. Read their reply carefully and answer EXACTLY what they asked — do not reintroduce yourself or repeat anything already said.' : `A new inquiry came in. ${nameGreeting}${detectedCity}`}

${userMessage}

REPLY FORMAT RULES (follow strictly):
0. BOOKING INTENT DETECTION: If the lead's message indicates they want to schedule, book, or see the apartment (e.g. contains words like yes, ready, available, schedule, book, tour, when, times, appointment, interested, come in) — respond with ONE sentence max confirming you are sending the link, then put the booking link on the next line. Nothing else. No questions. No follow-up. Example: Great — here is your booking link to pick a time that works for you.
1. FIRST sentence: directly answer the specific question they asked. Do not start with pleasantries.
2. SECOND sentence (optional): one relevant follow-up point or qualifying question — only if genuinely useful.
3. FINAL line (required, on its own line): the booking link — ${leadClient === 'iron65' ? 'always https://book.rosaliagroup.com/iron65' : 'always https://book.rosaliagroup.com/book (use https://book.rosaliagroup.com/iron65 ONLY if the inquiry is specifically about Iron 65 / 65 McWhorter)'}.
4. Never repeat anything said in a previous reply.
5. No bullet points. No lists. No markdown. No HTML. No subject line.
6. Do NOT end with "Please let me know if you have any other questions" or similar filler phrases.
7. Sign off once per email as: Rosalia Group | Inquiries Team | +18624191763

Write ONLY the email body.`;

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

const sendReplyTracker = {};
async function sendReply(replyTo, subject, replyText, ccEmail) {
  // Track how many times sendReply is called per email address per run
  sendReplyTracker[replyTo] = (sendReplyTracker[replyTo] || 0) + 1;
  console.log(`sendReply called for ${replyTo}: ${sendReplyTracker[replyTo]} time(s) this run`);
  if (sendReplyTracker[replyTo] > 1) {
    console.log(`DUPLICATE PREVENTED: already sent to ${replyTo} this run, skipping`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: INBOX_EMAIL, pass: GMAIL_PASS },
  });
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const plainText = replyText.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  // Strip markdown, convert URLs to links FIRST, then escape & in non-URL text
  let cleaned = replyText
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
  // Strip any raw HTML <a> tags the AI may have output — extract the URL first
  cleaned = cleaned.replace(/<a\s+href=['"]?(https?:\/\/[^'"<>\s]+)['"]?[^>]*>.*?<\/a>/gi, '$1');
  // Strip any other stray HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  // Replace URLs with placeholder tokens to protect them from & escaping
  // Regex stops at whitespace, quotes, brackets so it doesn't grab HTML artifacts
  const urls = [];
  cleaned = cleaned.replace(/(https?:\/\/[^\s<>"')\]]+)/g, (match) => {
    urls.push(match);
    return `__URL_${urls.length - 1}__`;
  });
  // Now safe to escape &
  cleaned = cleaned.replace(/&/g, '&amp;');
  cleaned = cleaned.replace(/\n/g, '<br>');
  // Restore URLs as clickable links
  const replyHtml = cleaned.replace(/__URL_(\d+)__/g, (_, i) => {
    const url = urls[parseInt(i)];
    return `<a href="${url}" style="color:#C9A84C;text-decoration:underline;">Book Your Tour Here</a>`;
  });
  const htmlBody = `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.8;color:#333;max-width:600px;">${replyHtml}</div>`;
  const mailOptions = {
    from: `"Rosalia Group Inquiries" <${INBOX_EMAIL}>`,
    to: replyTo,
    subject: replySubject,
    text: plainText,
    html: htmlBody,
  };
  if (ccEmail && ccEmail !== replyTo) {
    mailOptions.cc = ccEmail;
  }
  await transporter.sendMail(mailOptions);
  console.log('Email reply sent to:', replyTo, ccEmail ? `(cc: ${ccEmail})` : '');
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

async function sendSMS(phone, leadName, property, bookingUrl) {
  if (!TEXTBELT_KEY) return;
  const firstName = leadName?.split(' ')[0] || 'there';
  const url = bookingUrl || BOOKING_FORM_URL;
  const msg = `Hi ${firstName}! Rosalia Group here. We replied to your inquiry${property ? ' about ' + property : ''}. Book a tour: ${url}`;
  try {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: msg, key: TEXTBELT_KEY }),
    });
    console.log('SMS sent to:', phone);
  } catch (err) { console.error('SMS error:', err.message); }
}

async function saveLead(fromEmail, fromName, subject, body, replyText, phone, client) {
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
        phone: phone || existing[0].phone || null,  // prefer newly provided phone over old
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
      client: client || 'rosalia',
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
      text: `New lead email received!\n\nFrom: ${fromName}\nSubject: ${subject}${phone ? '\nPhone: ' + phone + (callAllowed ? '\nAlex is calling...' : '\nCall queued for business hours') : '\nNo phone  reply sent'}`,
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
    const processedEmails = new Set(); // Prevent processing same sender twice per run

    for (const raw of rawEmails) {
      try {
        const parsed = await simpleParser(raw.raw);
        const from = parsed.from?.text || '';
        const subject = parsed.subject || '(no subject)';
        // Use text body, fall back to HTML with tags stripped
        const rawHtml = parsed.html || '';
        const strippedHtml = rawHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        // For Avail emails, prefer HTML (has structured Name/Email/Phone labels)
        // For others, prefer plain text
        const body = (isAvailLead(from) && strippedHtml) ? strippedHtml : (parsed.text || strippedHtml || '');
        const replyTo = parsed.replyTo?.text || from;

        const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
        const fromEmail = emailMatch?.[1] || from;
        const fromName = from.replace(/<[^>]+>/, '').trim().replace(/"/g, '') || null;

        console.log('Processing:', from, '|', subject);

        // Per-run dedup: skip if we already processed this sender
        if (processedEmails.has(fromEmail.toLowerCase())) {
          console.log('Skipping (already processed this run):', fromEmail);
          results.skipped++;
          continue;
        }
        processedEmails.add(fromEmail.toLowerCase());

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

        const previousReply = await getPreviousThread(fromEmail);
        const isReply = subject.toLowerCase().startsWith('re:') || !!previousReply;
        if (isReply) console.log('Thread reply detected');

        let phone = null;
        let realEmail = fromEmail;
        let realName = fromName;
        let leadClient = null;

        if (isFUBLead(from, subject)) {
          const p = parseFUBEmail(body);
          if (p.phone) phone = p.phone;
          if (p.email) realEmail = p.email;
          if (p.name) realName = p.name;
          // Detect Iron 65 from subject, body or source
          const sl = subject.toLowerCase();
          const bl = (body || '').toLowerCase();
          if (sl.includes('iron 65') || sl.includes('mcwhorter') || bl.includes('iron 65') ||
              bl.includes('mcwhorter') || bl.includes('loft') || bl.includes('iron65')) {
            leadClient = 'iron65';
          }
          console.log('FUB lead - Name:', realName, 'Phone:', phone, 'Email:', realEmail, 'Client:', leadClient);
        } else if (isAvailLead(from)) {
          const p = parseAvailEmail(body);
          if (p.phone) phone = p.phone;
          if (p.email) realEmail = p.email;
          if (p.name) realName = p.name;
          // Detect Iron 65 property from subject or body
          const subjectLower = subject.toLowerCase();
          const bodyLower = body.toLowerCase();
          if (subjectLower.includes('mcwhorter') || subjectLower.includes('iron 65') ||
              bodyLower.includes('mcwhorter') || bodyLower.includes('iron 65')) {
            leadClient = 'iron65';
          }
          console.log('Avail lead - Name:', realName, 'Email:', realEmail, 'Client:', leadClient || 'rosalia');
        } else if (isWebflowLead(from, subject)) {
          const p = parseWebflowEmail(body);
          if (p.phone) phone = p.phone;
          if (p.email) realEmail = p.email;
          if (p.name) realName = p.name;
          console.log('Webflow lead - Name:', realName, 'Email:', realEmail);
        } else if (isZillowLead(from)) {
          // Zillow relay emails don't contain phone numbers
          const p = parseZillowEmail(body);
          if (p.email) realEmail = p.email;
          phone = null; // Zillow relay never has phone
          console.log('Zillow lead - no phone in relay email');
        } else {
          // Strip emails from text before extracting phone
          phone = extractPhone(body + ' ' + subject);
        }
        // For reply threads: always try to extract phone from body regardless of source
        if (!phone && isReply) {
          const replyPhone = extractPhone(body);
          if (replyPhone) {
            phone = replyPhone;
            console.log('Phone extracted from reply body:', phone);
          }
        }

        console.log('Lead detected! Phone:', phone || 'none found');

        const checkEmail = (isAvailLead(from) || isWebflowLead(from, subject)) ? realEmail : fromEmail;
        const skipRecentCheck = isAvailLead(from) || from.includes('reply.avail.co') || from.includes('@avail.co') || isFUBLead(from, subject);

        if (!skipRecentCheck && await repliedRecently(checkEmail, isReply ? 2 : 24)) {
          console.log('Skipping (replied recently):', checkEmail, isReply ? '(thread, 2h window)' : '(new, 24h window)');
          results.skipped++;
          continue;
        }

        const leadContext = await getLeadContext(checkEmail, realName);

        if (leadContext?.status === 'dnc') {
          console.log('Skipping DNC lead:', checkEmail);
          results.skipped++;
          continue;
        }

        const calendarAppt = await getCalendarAppointment(realName || fromName);
        if (calendarAppt) console.log('Calendar appointment found:', calendarAppt.date, calendarAppt.time);
        if (leadContext) console.log('Lead context found:', leadContext.status);

        const replyText = await generateReply(from, subject, body, previousReply, leadContext, calendarAppt, realName, leadClient);
        if (!replyText) { results.skipped++; continue; }

        const effectiveReplyTo = (isAvailLead(from) || isWebflowLead(from, subject)) ? realEmail : replyTo;
        // For Avail leads: reply to relay so it appears in Avail platform, CC real email
        const avail = isAvailLead(from);
        const isFUB = isFUBLead(from, subject);
        const replyTarget = avail ? fromEmail : realEmail || effectiveReplyTo;
        const ccEmail = avail && realEmail && realEmail !== fromEmail ? realEmail : null;
        await sendReply(replyTarget, subject, replyText, ccEmail);
        await saveLead(realEmail || fromEmail, realName || fromName, subject, body, replyText, phone, leadClient);
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
          const propertyMatch = subject.match(/for\s+(.+?)(?:,\s*Unit|\s*$)/i);
          const propertyName = propertyMatch ? propertyMatch[1].trim() : '';
          const smsBookingUrl = leadClient === 'iron65' ? IRON65_BOOKING_URL : BOOKING_FORM_URL;
          // Send SMS immediately: new lead OR phone newly provided in reply
          const shouldSendSMS = !hadPhone || !isReply;
          if (shouldSendSMS) {
            if (isReply && !hadPhone) console.log('Phone newly provided in reply — sending SMS immediately:', phone);
            await sendSMS(phone, realName || fromName, propertyName, smsBookingUrl);
            if (callAllowed) {
              await triggerCall(phone, realName || fromName);
              console.log('Call triggered during business hours for:', realName || fromName);
            } else {
              console.log('Outside business hours — SMS sent, autocall will handle:', realName || fromName);
            }
          } else {
            console.log('Phone already on record — skipping duplicate SMS');
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
