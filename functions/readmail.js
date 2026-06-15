const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const INBOX_EMAIL = 'inquiries@rosaliagroup.com';
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const BOOKING_FORM_URL = 'https://book.rosaliagroup.com/book';
const IRON65_BOOKING_URL = 'https://book.rosaliagroup.com/iron65';

const APPLICATION_TEMPLATES = {
  iron65: {
    applyLink: 'https://apply.weimark.com/ifw/b0f05d8828bbaf86e049a659c4fe1171/5965/new/',
    emailSubject: 'Iron 65 — Application Details & Next Steps',
    emailBody: `Hello,

Here are the details for your Iron 65 application.

CURRENT PROMOTIONS:
- 2 months free on a 14-month lease
- Apply within 24 hours of touring for an additional month free
- Amenities fee waived for 12 months

INITIAL PAYMENT:
- Security Deposit: $1,000 (if you qualify)
- 1st month's rent

UTILITIES:
- Electricity: tenant pays directly through PSEG
- Renters insurance required
- Water billed in arrears via tenant portal

APPLICATION PROCESS:
Submit your application here: https://apply.weimark.com/ifw/b0f05d8828bbaf86e049a659c4fe1171/5965/new/
Every occupant must apply. Application fee: $50 per person.

REQUIRED DOCUMENTS:
- Government-issued photo ID
- Last 2 bank statements
- Last 3 pay stubs
- Owner reference or proof of rent (previous year)
- Tax documents (last tax return, W2, 1099, etc.)

Feel free to reach out with any questions or to schedule a tour.

Best regards,
Ana Haynes | Rosalia Group
(862) 333-1681 | inquiries@rosaliagroup.com`,
  },
  rosalia: {
    applyLink: 'https://book.rosaliagroup.com/book',
    emailSubject: 'Rosalia Group — Application Details',
    emailBody: `Hello,

Thank you for your interest in Rosalia Group apartments.

To get started, please schedule a tour using the link below. After your tour, we will send you the full application details.

Book your tour: https://book.rosaliagroup.com/book

GENERAL REQUIREMENTS:
- 625+ credit score
- Income ~3x monthly rent
- Co-signers and TheGuarantors.com accepted

DOCUMENTS NEEDED:
- Government-issued photo ID
- Last 2 bank statements
- Last 3 pay stubs
- Proof of previous rent or owner reference

Feel free to reach out with any questions.

Best regards,
Ana Haynes | Rosalia Group
(862) 333-1681 | inquiries@rosaliagroup.com`,
  },
};

const PROPERTY_MEDIA = {
  'iron 65': 'https://drive.google.com/drive/folders/16xZ3T4KPWBibAlRESOs181BxstZMDHXJ',
  'mcwhorter': 'https://drive.google.com/drive/folders/16xZ3T4KPWBibAlRESOs181BxstZMDHXJ',
  '39 madison': 'https://drive.google.com/drive/folders/1My5d_o0U6DUfpkLl0af6xd-puxOFPOWg',
  'iron pointe': 'https://drive.google.com/drive/folders/1My5d_o0U6DUfpkLl0af6xd-puxOFPOWg',
  '502 market': 'https://drive.google.com/drive/folders/1eXb5UtI9md7MJzqSAGyPjA5opyiv88hO',
  '486 market': 'https://drive.google.com/drive/folders/1WdGEkpiYT_cX13qW-OGVsBfuv9lWWEUp',
  '556 market': 'https://drive.google.com/drive/folders/1kTW7etuGZkD5_g81EDpl1ydOF_9TdnOR',
  '76 webster': 'https://drive.google.com/drive/folders/1t1cEj0WMOHAwhTkTTfPhMxxDiBwhTLHW',
  '74 webster': 'https://drive.google.com/drive/folders/1t1cEj0WMOHAwhTkTTfPhMxxDiBwhTLHW',
  '11 thomas': 'https://drive.google.com/drive/folders/1kX67b4Ap7XIR8drfgRA3ftbSn8Ez22-C',
  '162 university': 'https://drive.google.com/drive/folders/1H2jyLzFgB3XyqaYU8bAB4lk4TaQ2vL0k',
  '164 university': 'https://drive.google.com/drive/folders/1H2jyLzFgB3XyqaYU8bAB4lk4TaQ2vL0k',
  '289 halsey': 'https://drive.google.com/drive/folders/1kev7bJ_fghfiTZMKxfPCVd0OHU6GXRqQ',
  '136 s 7th': 'https://drive.google.com/drive/folders/1hMtOsq7yD9Am8hoNxayrqS9XvRrYkVGF',
  '276 duncan': 'https://drive.google.com/drive/folders/1Of1V_qyNadngRyy2croUqDEXoQIaT7QT',
  '440 elizabeth': 'https://drive.google.com/drive/folders/1Hs2PO3lHQ0S1Pp_9VWO2sWXdFsyQCbv8',
  'the elks': 'https://drive.google.com/drive/folders/1EZHwoZwuZtBMXPe_SuytMVmTC0ujcJB9',
  '180 ferry': 'https://drive.google.com/drive/folders/1C4u8bniEiZlecCxl1dCJLE4fhgYXz0SE',
  '80 freeman': 'https://drive.google.com/drive/folders/1R5lzPHPkbtncNt6XPjTZ7D57J6FYQhXe',
};

function getPropertyMedia(property, message, unitNumber) {
  const text = ((property || '') + ' ' + (message || '')).toLowerCase();

  // Iron 65 — use model-specific folder
  if (text.includes('iron 65') || text.includes('mcwhorter') || text.includes('iron65')) {
    return getIron65MediaLink(unitNumber);
  }

  for (const [key, url] of Object.entries(PROPERTY_MEDIA)) {
    if (text.includes(key)) return url;
  }
  return null;
}

const IRON65_MODELS = {
  '00': 'https://drive.google.com/drive/folders/1oZe9iypPYM3KMOR3gwXmlyDdqdyT45ov',
  '01': 'https://drive.google.com/drive/folders/1_B_EDL60g6OpUhUYnHVIQxskINyR-cIl',
  '02': 'https://drive.google.com/drive/folders/1XXd-DXtk7HmIkpi4wmCF_RtQx-J3UY_G',
  '03': 'https://drive.google.com/drive/folders/1tmnRsaXEMNTv6Xvbo_7KVIdx_2GEqN6z',
  '04': 'https://drive.google.com/drive/folders/1nEVrGQtQVmv_U4oH6T4q6hAmKw0r9HG1',
  '05': 'https://drive.google.com/drive/folders/12HlkVz4mdBAyLH-vzXt6XhWQg3CHPIxC',
  '06': 'https://drive.google.com/drive/folders/1oSEHRyThSwa5JhKmu_AQqFdf25naUZCn',
  '07': 'https://drive.google.com/drive/folders/1tOzpWgE3wpkb--puXOgcdLuUO87A2DaT',
  '08': 'https://drive.google.com/drive/folders/1BTiTvDKkT_IinFq4pp7DVKE655_yaYFg',
  '09': 'https://drive.google.com/drive/folders/1GlmMtMTecohkKx9rRsAALOX02txl-t1c',
  '10': 'https://drive.google.com/drive/folders/1RQEKUZe7nyuz9cc5M8KiDBVAPUBuz5Oh',
  '11': 'https://drive.google.com/drive/folders/1zFV5-jiAzN34Toq9Y_Sv6jU3ASg8JawO',
  '12': 'https://drive.google.com/drive/folders/14ZKXgjgsy3C4pWAaAJfWDptZmU-xQKGG',
  'loft': 'https://drive.google.com/drive/folders/1VetphM-E2AghDux37UkGXu5vNkNcefh5',
  'duplex': 'https://drive.google.com/drive/folders/1T6y7Bv5HV3jOyjtRLkQm7SFZc9cfskfh',
  'amenities': 'https://drive.google.com/drive/folders/1hhM81AfHpCjph6aBqGzEgW1_O8oac9CY',
};

function getIron65MediaLink(unitNumber) {
  if (!unitNumber) return IRON65_MODELS['amenities'];
  const match = unitNumber.toString().match(/\d*?(\d{2})$/);
  if (match) {
    const model = match[1];
    if (IRON65_MODELS[model]) return IRON65_MODELS[model];
  }
  if (/loft/i.test(unitNumber)) return IRON65_MODELS['loft'];
  if (/duplex/i.test(unitNumber)) return IRON65_MODELS['duplex'];
  return 'https://drive.google.com/drive/folders/16xZ3T4KPWBibAlRESOs181BxstZMDHXJ';
}

const TEXTBELT_KEY = process.env.TEXTBELT_KEY;

const VAPI_KEY = process.env.VAPI_KEY;

async function syslog(level, message, metadata = {}) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/system_logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ level, function_name: 'readmail', message, metadata }),
    });
  } catch (_) {}
}

const CARRIER_GATEWAYS = {
  'att': 'txt.att.net',
  'at&t': 'txt.att.net',
  'verizon': 'vtext.com',
  'tmobile': 'tmomail.net',
  't-mobile': 'tmomail.net',
  'sprint': 'messaging.sprintpcs.com',
  'metro': 'mymetropcs.com',
  'metropcs': 'mymetropcs.com',
  'boost': 'sms.myboostmobile.com',
  'cricket': 'sms.cricketwireless.net',
  'us cellular': 'email.uscc.net',
  'google': 'msg.fi.google.com',
};

async function getSMSGateway(phone) {
  try {
    const digits = phone.replace(/\D/g,'').slice(-10);
    const apiKey = process.env.ABSTRACT_PHONE_KEY;
    if (!apiKey) return null;
    const res = await fetch(`https://phoneintelligence.abstractapi.com/v1/?api_key=${apiKey}&phone=1${digits}`);
    const data = await res.json();
    const smsEmail = data?.phone_messaging?.sms_email;
    if (smsEmail) { console.log(`SMS gateway: ${smsEmail}`); return smsEmail; }
    const carrier = (data?.phone_carrier?.name || '').toLowerCase();
    if (data?.phone_carrier?.line_type !== 'mobile') return null;
    for (const [k, gateway] of Object.entries(CARRIER_GATEWAYS)) {
      if (carrier.includes(k)) return `${digits}@${gateway}`;
    }
    return null;
  } catch(e) { console.error('AbstractAPI error:', e.message); return null; }
}

const VAPI_ASSISTANT_ID = '1cae5323-6b83-4434-8461-6330472da140';
const VAPI_PHONE_ID = process.env.VAPI_PHONE_ID || '2e2b6713-f631-4e9e-95fa-3418ecc77c0a';

const ANA_CONTEXT = `
You are the Rosalia Group Inquiries Team  a warm, professional leasing team in New Jersey managing multiple luxury apartment communities.

CRITICAL RULES:
- Your #1 goal in every email is to schedule a tour as quickly as possible  regardless of which property they ask about
- ALWAYS use the lead's first name in the greeting  never say "Hi there"  use "Hi [Name]" using the name from the FROM field
- Do NOT proactively mention or discuss other properties  only answer what was asked, then push to book the tour
- For ANY property inquiry regardless of address — always send https://book.rosaliagroup.com/book as the booking link. The form allows any property to be entered. Never qualify or filter by property address. Never say the property isn't ours or we don't manage it
- For ANY property or unit questions, always say "Our leasing agent will be best able to answer that at your tour" then send booking link
- Always include the booking link in every reply
- Prequalify in every first reply: naturally ask for unit size, move-in date, budget, and phone number
- Never confirm specific unit availability  the leasing agent will confirm at the tour
- Anyone can schedule a tour regardless of credit score  never turn anyone away
- If someone asks about Section 8, housing vouchers, or rental assistance programs: say "We welcome all legal sources of income. We show the apartment to everyone  our management team reviews all applications individually including credit criteria. Schedule a tour and our leasing agent will walk you through the process"
- All legal sources of income accepted  management reviews all applications
- Never discuss income or credit as a barrier to touring  only the leasing agent discusses this at the tour
- Keep replies SHORT — 3 sentences maximum, then the booking link on its own line
- Answer the specific question asked in ONE sentence — do not volunteer extra info
- PRICING RULES:
  - Do NOT volunteer pricing unprompted
  - When a lead ASKS about price, rent, cost, or how much — answer directly with the correct pricing for the property they mentioned
  - Use ONLY these verified prices (always mention incentives when sharing pricing):
    502 Market St: 1BR from $2,300/mo, 2BR from $2,499/mo. Incentives: 1 month free on 13mo lease, 2 months free on 24mo lease, $500 security deposit
    486 Market St (River Pointe): 1BR from $2,350/mo. Incentives: 1 month free on 13mo lease, 2 months free on 24mo lease, $500 security deposit. ONLY 4 UNITS LEFT — mention urgency
    39 Madison St (Iron Pointe): 1BR from $2,400/mo, 1BR backyard from $2,750/mo, 2BR from $3,300/mo. Incentives: 18 units available, rooftop gym lounge, 8 min walk to Penn Station
    475 Main St Orange (The Elks): Studios from $1,955/mo, 1BR from $2,145/mo, 2BR from $3,095/mo, 3BR from $3,775/mo. No current promotions
    80 Freeman St (The Ballantine): Studios from $2,065/mo, 1BR from $2,375/mo, 2BR from $3,340/mo. No current promotions
    556 Market St: 1BR from $2,100/mo, 3BR Duplex $3,100/mo. Incentives: 1 month free on 13mo lease, 2 months free on 24mo lease, $500 security deposit
    289 Halsey St: from $2,250/mo. Incentives: 1 month free on 13mo lease, 6 months free parking on 18mo lease
    276 Duncan St Jersey City: 2BR at $2,850/mo. Incentives: rooftop access, in-unit laundry
    1369 South Ave Plainfield: 2BR from $2,775/mo. Incentives: free parking, gym, in-unit washer/dryer
    74 Webster St Newark: 1BR from $1,900/mo, 2BR from $2,700/mo, 3BR from $3,400/mo. Incentives: 1 month free on 13mo lease, 2 months free on 24mo lease, $500 SD
    11 Thomas St Newark: Studio $1,450/mo, 1BR $1,675/mo. Incentives: 1 month free on 12mo lease, 2 months free on 24mo lease
    164 University Ave Newark: Studio $1,870/mo utilities included. Incentives: 1 month free on 13mo lease, 2 months free on 18mo lease, $500 SD
    53 Bleeker St Newark: 3BR $2,800/mo. Incentives: 1 month free on 13mo lease, $500 SD
    176 Garfield Jersey City: 3BR $2,350/mo. Private backyard
    136 S 7th St Newark: 3BR $2,250/mo. Backyard
    86 Wilson Pl Orange: 2BR $1,850/mo. Private entrance + backyard
    883 Springfield Ave Irvington: 3BR $1,950/mo
    Iron 65 (65 Mcwhorter): Studios from $2,200/mo, 1BR from $2,724/mo, 2BR from $3,288/mo, Lofts from $3,488/mo. Incentives: 2 months free on 14-month lease | Amenities fee waived 12 months | Apply within 24hrs of tour for additional month free. Rooftop, gym, yoga, cold plunge, sauna, NYC views
  - When sharing pricing, always mention the incentives for that property in the same reply. Example: "1BR units at 502 Market start at $1,999/month — and we currently offer 1 month free on a 13-month lease, which brings your effective monthly rent down. Prices subject to change."
  - When sharing pricing always add: 'Prices are subject to change — our leasing agent will confirm current availability at your tour.'
  - FLOOR PLANS: If asked for floor plans, say: 'I am sending your request to our leasing team who will email you the floor plans directly. Can I also schedule a tour so you can see the layout in person?'
  - Always answer questions about amenities, utilities, parking, pets, move-in requirements, and lease terms if you know them
- Never use markdown bold (**text**) or italic (*text*)
- Never suggest specific appointment times  always direct to the booking link
- Ask for phone number if not provided
- NEVER confirm or deny existing appointments you don't have record of  say "let me confirm with our leasing team and we will reach out shortly"
- Sign off as: Rosalia Group | Inquiries Team | (862) 333-1681 | inquiries@rosaliagroup.com
- IMPORTANT: Never tell a lead that a property is outside our portfolio or not one of our properties. For ANY property inquiry — whether it is in our knowledge base or not — greet them by first name, acknowledge their interest in that specific address in ONE sentence, then send the booking link https://book.rosaliagroup.com/book. The booking form allows any property address to be entered so all inquiries should be funneled there. Never qualify or filter by property address.

PROPERTY KNOWLEDGE BASE:
# ROSALIA GROUP  KNOWLEDGE BASE
# Last updated: June 15, 2026
# NOTE: Only mention prices if the lead's message contains words like: price, cost, rent, how much, affordable, budget. Otherwise focus on features and booking a tour.

## BOOKING LINKS
- All Rosalia properties (general): https://book.rosaliagroup.com/book
- Iron 65 specifically: https://book.rosaliagroup.com/iron65
- Reschedule (Rosalia): https://book.rosaliagroup.com/reschedule
- Reschedule (Iron 65): https://book.rosaliagroup.com/iron65-reschedule

## UTILITIES  ALL BUILDINGS
- Electric: tenant pays (all buildings use electric  no gas)
- Water & trash: INCLUDED at River Pointe (486 Market), 502 Market, Iron Pointe (39 Madison), 556 Market
- Water & trash: tenant pays at 289 Halsey, 77 Christie, 1369 South Ave, The Elks, Iron 65
- Internet: tenant pays

## CREDIT & QUALIFICATION POLICY
- Anyone can schedule a tour regardless of credit score  no minimum to tour
- Standard application requirement: 625+ credit score and income ~3x rent
- Below 625 or lower income: still welcome to tour and apply  management reviews all applications individually
- TheGuarantors.com and co-signers accepted  best to discuss with leasing agent at tour
- Self-employed: 2 years tax returns + bank statements accepted

## PROPERTIES

### 486 MARKET STREET  RIVER POINTE, NEWARK NJ
Utilities included: water, trash | Tenant pays: electric
PROMOTIONS: 1 month free on 13 month lease | 2 months free on 24 month lease | $500 security deposit
Pet: $65/month + $500 security | Storage: $300/month | In-unit laundry
Staged unit: 401 (4th floor, balcony) | ONLY 4 UNITS LEFT
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
- Unit 1C: 2BR  $2,499/mo
- Unit 4A: 2BR  $2,900/mo
- Unit 5B: 1BR  $2,300/mo

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
- Unit 1C: 3BR Duplex  $3,100/mo
- Unit 3A: 1BR/1BTH  $2,200/mo
- Unit 5E: 1BR/1BTH  $2,100/mo

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
PROMOTIONS: 2 months free on 14-month lease | Amenities fee waived 12 months | Apply within 24hrs of tour for additional month free | Security deposit: $1,000
NOTE: Only share pricing details below if the lead specifically asks about price, cost, rent, or budget.
Amenities: Rooftop with NYC skyline views | Fitness center | Yoga studio | Cold plunge | Saunas | Outdoor kitchen | Game room | Business center | Pet park | Bike storage | Front desk 7 days | Doorman | Security | In-unit W/D
Tours: Tue-Fri 12pm-6pm | Sat-Sun 12pm-4pm
Tour booking: https://book.rosaliagroup.com/iron65

### 74 WEBSTER ST, NEWARK NJ
Building code: 2580
PROMOTIONS: 1 month free on 13 month lease | 2 months free on 24 month lease | $500 security deposit
Available units:
- 1BR from $1,900/mo
- 2BR from $2,700/mo
- 3BR from $3,400-$3,500/mo
Tour booking: https://book.rosaliagroup.com/book

### 11 THOMAS ST, NEWARK NJ
Building code: 4351 | Apt door unlocked
PROMOTIONS: 1 month free on 12 month lease | 2 months free on 24 month lease
Available units:
- Studio  $1,450/mo
- 1BR  $1,675/mo
Tour booking: https://book.rosaliagroup.com/book

### 164 UNIVERSITY AVE, NEWARK NJ
Lockbox: 3766 | Utilities included in rent
PROMOTIONS: 1 month free on 13 month lease | 2 months free on 18 month lease | $500 security deposit
Available units:
- Studio  $1,870/mo (utilities included)
Tour booking: https://book.rosaliagroup.com/book

### 53 BLEEKER ST, NEWARK NJ
Lockbox: 3766
PROMOTIONS: 1 month free on 13 month lease | $500 security deposit
Available units:
- 3BR  $2,800/mo
Tour booking: https://book.rosaliagroup.com/book

### 176 GARFIELD, JERSEY CITY NJ
Lockbox: 3766 | Private backyard
Available units:
- 3BR  $2,350/mo
Tour booking: https://book.rosaliagroup.com/book

### 136 S 7TH ST, NEWARK NJ
Lockbox: 8120 | Backyard
Available units:
- 3BR  $2,250/mo
Tour booking: https://book.rosaliagroup.com/book

### 86 WILSON PL, ORANGE NJ
Lockbox: 3766 | Private entrance + backyard
Available units:
- 2BR  $1,850/mo
Tour booking: https://book.rosaliagroup.com/book

### 883 SPRINGFIELD AVE, IRVINGTON NJ
Lockbox: 3766
Available units:
- 3BR  $1,950/mo
Tour booking: https://book.rosaliagroup.com/book

### 276 DUNCAN STREET, JERSEY CITY NJ
Utilities included: none | Tenant pays: electric, water, trash
In-unit laundry | Rooftop access
Available units:
- 2BR at $2,850/mo
Tour booking: https://book.rosaliagroup.com/book

### 303 WASHINGTON STREET, NEWARK NJ — COMING SOON
Utilities included: none | Tenant pays: electric, water, trash
Studios from $2,500/mo | 1BR from $2,500/mo | 2BR from $3,200/mo
9 floors | Market rate + affordable units available
Credit: 625+ | Income: ~3x rent
COMING SOON — not yet available for touring
Interested leads: collect name, email, phone and add to waitlist. Say "We are not yet accepting tours but I can add you to our priority list and you will be the first to know when we open."
Tour booking: https://book.rosaliagroup.com/book

## FAQ
Q: Are utilities included?
A: Depends on the building. Water and trash are included at River Pointe, 502 Market, Iron Pointe, and 556 Market. All other buildings tenants pay their own electric, water, and trash. There is no gas in any building  all electric.

Q: What credit score do I need?
A: Anyone can schedule a tour regardless of credit score. Our standard application requirement is 625+ but management reviews every application individually. TheGuarantors.com and co-signers are accepted options  best to discuss with the leasing agent at your tour.

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
  'mail.zillow',  // voice.google.com removed — GV texts/calls processed separately
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
  'appointment confirmed', 'your tour is confirmed', 'booking confirmed', 'tour confirmed', 'your appointment is confirmed',
];

function isGoogleVoiceLead(from, subject) {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  if (f.includes('voice.google.com') || f.includes('txt.voice.google')) return true;
  if (s.includes('new text message from') || s.includes('new voicemail from') ||
      s.includes('missed call from') || s.includes('new group message')) return true;
  return false;
}

function parseGoogleVoice(from, subject, body, replyTo) {
  const result = { type: null, callerPhone: null, message: null, agentEmail: null, duration: null };
  const s = (subject || '').toLowerCase();
  if (s.includes('new text message')) result.type = 'sms';
  else if (s.includes('new voicemail')) result.type = 'voicemail';
  else if (s.includes('missed call')) result.type = 'missed_call';
  const phoneMatch = subject.match(/from\s+([\(\d\s\)\-\.]+\d)/i);
  if (phoneMatch) {
    let p = phoneMatch[1].replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11) p = '+' + p;
    result.callerPhone = p;
  }
  const msgMatch = body.match(/([\s\S]+?)\s*(?:To respond|To reply|Google Voice|Your Google|YOUR ACCOUNT)/i);
  if (msgMatch && msgMatch[1].trim().length > 2) {
    result.message = msgMatch[1].trim().slice(0, 500);
  } else {
    const firstChunk = body.split(/To respond|To reply|Google Voice|YOUR ACCOUNT/i)[0];
    if (firstChunk && firstChunk.trim().length > 2) result.message = firstChunk.trim().slice(0, 500);
  }
  const durMatch = body.match(/Duration:\s*([\d:]+)/i);
  if (durMatch) result.duration = durMatch[1];
  result.replyTo = replyTo || null;
  result.agentEmail = replyTo || null;
  return result;
}

function isZillowLead(from) {
  const f = from.toLowerCase();
  return f.includes('convo.zillow.com') || f.includes('comet.zillow.com') || f.includes('rentalclientservices@zillowrentals');
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
  // Original Webflow/Resipointe detection
  if ((f.includes('webflow.com') || f.includes('resipointe')) &&
      (s.includes('submission') || s.includes('application') || s.includes('new form') || s.includes('new lead'))) return true;
  // Brevo/Iron65 form emails
  if ((f.includes('brevo') || f.includes('liveiron65') || f.includes('sendinblue') || f.includes('iron65.com')) &&
      (s.includes('tour') || s.includes('lead') || s.includes('inquiry') || s.includes('request') || s.includes('interested') || s.includes("you've got new message"))) return true;
  return false;
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

function parseWebflowEmail(body, subject) {
  const lead = {};

  // Normalize: strip HTML tags, decode entities, collapse whitespace for inline parsing
  const normalized = (body || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|td|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/\s+/g, ' ')
    .trim();

  // Iron 65 tour confirmation format: "Thank you Willie j, Bethea for requesting a tour...at email or phone"
  const tourConfirmMatch = normalized.match(/Thank you ([^,]+),?\s*(\S+)?\s+for requesting a tour.*?at\s+([^\s]+@[^\s]+)\s+or\s+([\d]+)/i);
  if (tourConfirmMatch) {
    lead.name = (tourConfirmMatch[1] + ' ' + (tourConfirmMatch[2] || '')).trim();
    lead.email = tourConfirmMatch[3];
    let p = tourConfirmMatch[4].replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    lead.phone = p;
    lead.message = 'Requested a tour at Iron 65';
    return lead;
  }

  // Resipointe uses numbered fields: "Name 3:", "Email 3:", "Phone 2:"
  // Also handle original format: "Full Name:", "Email Address:", "Cell Phone:"
  // Iron 65 contact form: "Name:", "Email:", "Phone:", "select:", "Your Message:"
  const nameMatch = body.match(/Full\s+Name\s*[:\-]\s*([^\n\r]+)/i)
    || body.match(/(?:(?<!\w\s)Name\s*\d*):\s*([^\n\r]+)/i)
    || body.match(/\bName\b\s*\n([^\n]+)/i)
    || normalized.match(/\bName\b\s*:\s*([^E\n]+?)(?=\s*Email|\s*Phone|\s*$)/i);
  const emailMatch = body.match(/(?:Email Address|Email\s*\d*):\s*([^\s\n]+@[^\s\n]+)/i)
    || body.match(/\bEmail\b\s*\n([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
    || normalized.match(/\bEmail\b\s*:?\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  const phoneMatch = body.match(/Cell\s+Phone\s*[:\-]\s*([\d\s\(\)\-\+]+)/i)
    || body.match(/(?:Phone\s*\d*):\s*([\d\s\(\)\-\.]+)/i)
    || body.match(/\bPhone\b\s*\n([\d\s\(\)\-\.]+)/i)
    || normalized.match(/\bPhone\b\s*:?\s*([\d\s\(\)\-\.]{7,})/i);
  const buildingMatch = body.match(/Building\s*[:\-]\s*([^\n\r]+)/i);
  const bedroomsMatch = body.match(/Bedrooms:\s*(.+)/i);
  // Iron 65 contact form: "select" = unit type, "Your Message" = lead's message
  const selectMatch = body.match(/\bselect\b\s*:?\s*(.+)/i)
    || normalized.match(/\bselect\b\s*:?\s*([^\n]+?)(?=\s*Your Message|\s*Message|\s*$)/i);
  const messageMatch = body.match(/Your Message\s*:?\s*([\s\S]+?)(?=\s*--|\s*$)/i)
    || body.match(/\bMessage\b\s*:?\s*([\s\S]+?)(?=\s*--|\s*$)/i)
    || normalized.match(/Your Message\s*:?\s*(.+?)(?=\s*--|\s*$)/i);

  if (nameMatch) lead.name = nameMatch[1].trim();
  if (emailMatch) lead.email = emailMatch[1].trim();
  if (phoneMatch) {
    let p = phoneMatch[1].replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11) p = '+' + p;
    if (p.length >= 11) lead.phone = p;
  }
  if (buildingMatch) lead.property = buildingMatch[1].split('--')[0].trim();
  if (bedroomsMatch) lead.bedrooms = bedroomsMatch[1].split('--')[0].trim();
  if (selectMatch) lead.unitType = selectMatch[1].trim();
  if (messageMatch) lead.message = messageMatch[1].trim();

  // Fallback: extract name from subject "You've got new message from [Name]"
  if (!lead.name && subject) {
    const subjName = subject.match(/new message from\s+(.+)/i);
    if (subjName) lead.name = subjName[1].trim();
  }

  // Fallback: inline single-line format "Full Name: X Email Address: Y Cell Phone: Z"
  if (!lead.email) {
    const inlineEmail = normalized.match(/(?:Email Address|Email\s*\d*)\s*:?\s*([^\s]+@[^\s]+)/i);
    if (inlineEmail) lead.email = inlineEmail[1].trim();
  }
  if (!lead.name) {
    const inlineName = normalized.match(/(?:Full\s+Name|(?<!\w\s)Name\s*\d*)\s*:?\s*([^E]+?)(?=Email|$)/i);
    if (inlineName) lead.name = inlineName[1].trim();
  }
  if (!lead.phone) {
    const inlinePhone = normalized.match(/(?:Cell Phone|Phone\s*\d*)\s*:?\s*([\d\s\(\)\-\.]+?)(?=Current|Building|Bedrooms|Company|select|Your Message|$)/i);
    if (inlinePhone) {
      let p = inlinePhone[1].replace(/\D/g, '');
      if (p.length === 10) p = '+1' + p;
      if (p.length >= 11) lead.phone = p;
    }
  }

  return lead;
}

const LEAD_KEYWORDS = /rent|apartment|unit|tour|showing|available|bedroom|studio|price|lease|apply|application|move.in|listing|looking|interested|inquiry|inquire|buy|purchase|mortgage|home|house|sell|property|schedule|viewing|question|info|information/i;

function isListingAlert(from, subject) {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  const alertSenders = ['zillowrentals', 'mail.zillow', 'noreply@avail.co', 'notifications@avail.co'];
  const alertSubjects = ['expir', 'renew', 'relist', 'repost', 'your listing', 'listing update', 'listing expired', 'activate your listing', 'boost your listing', 'listing ending', 'listing paused'];
  const senderMatch = alertSenders.some(a => f.includes(a));
  const subjectMatch = alertSubjects.some(a => s.includes(a));
  return senderMatch && subjectMatch;
}

async function saveListingAlert(from, subject, body) {
  const f = (from || '').toLowerCase();
  const platform = f.includes('zillow') ? 'zillow' : 'avail';
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/listing_alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        platform,
        subject: (subject || '').slice(0, 500),
        body: (body || '').slice(0, 2000),
        received_at: new Date().toISOString()
      })
    });
    console.log('Listing alert saved:', platform, subject);
  } catch (e) {
    console.error('Failed to save listing alert:', e.message);
  }
}

function shouldSkip(from, subject) {
  if (isGoogleVoiceLead(from, subject)) return false;
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
  if (isGoogleVoiceLead(from || '', subject || '')) return true;
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
function parseZillowEmail(body, from) {
  const lead = {};
  // For RELAY emails (convo.zillow.com), phone is NEVER in body — don't extract
  const isRelay = from && (from.includes('convo.zillow.com') || from.includes('comet.zillow.com'));

  // Name from "New Contact ... says:" (Zillow Group Rentals format only)
  if (!isRelay) {
    const nameMatch = body.match(/New Contact\s+(.+?)\s+says:/i);
    if (nameMatch) lead.name = nameMatch[1].trim();
  }
  // For relay: name from "X says:" pattern
  if (isRelay) {
    const relayName = body.match(/^([^\n]{2,60})\s+says:/m);
    if (relayName) lead.name = relayName[1].trim();
  }
  // Email — fallback: first non-Zillow/non-system email in body
  const emailMatch = body.match(/([a-zA-Z0-9._%+\-]+@(?!zillowrentals|zillow\.com|amazonses\.com|hotpads\.com|rosaliagroup\.com)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) lead.email = emailMatch[1].trim();
  // Phone — ONLY for Zillow Group Rentals format, NEVER for relay
  // Strip URLs first to avoid matching tracking IDs
  if (!isRelay) {
    const bodyNoUrls = body.replace(/https?:\/\/\S+/g, ' ').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ');
    const phoneMatch = bodyNoUrls.match(/(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
    if (phoneMatch) {
      let p = phoneMatch[1].replace(/\D/g, '');
      if (p.length === 10) p = '+1' + p;
      else if (p.length === 11) p = '+' + p;
      lead.phone = p;
    }
  }
  return lead;
}

function isGoogleVoice(from) {
  const f = (from || '').toLowerCase();
  return f.includes('voice.google.com') || f.includes('txt.voice.google');
}

function parseGoogleVoiceEmail(body) {
  const gv = { callerPhone: null, message: null };
  // Extract phone number from GV email body
  const phoneMatch = (body || '').match(/(\+?1?\s*\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})/);
  if (phoneMatch) {
    let p = phoneMatch[1].replace(/\D/g, '');
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11 && p.startsWith('1')) p = '+' + p;
    gv.callerPhone = p;
  }
  // Extract the actual text message — GV emails typically have the message after the phone line
  const lines = (body || '').split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  // Skip header lines (phone, timestamp, etc) and grab the message content
  const msgLines = [];
  let foundPhone = false;
  for (const line of lines) {
    if (!foundPhone && phoneMatch && line.includes(phoneMatch[1])) { foundPhone = true; continue; }
    if (foundPhone || !phoneMatch) {
      // Skip common GV footer lines
      if (/^(YOUR GOOGLE VOICE|To respond|Get the app|https:\/\/voice)/i.test(line)) break;
      if (line.length > 0) msgLines.push(line);
    }
  }
  gv.message = msgLines.join(' ').trim() || (body || '').slice(0, 500).trim();
  return gv;
}

const SB_H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

async function processGoogleVoice(from, body) {
  const gv = parseGoogleVoiceEmail(body);
  if (!gv.callerPhone) {
    console.log('GV: no phone number found, skipping');
    return;
  }
  console.log(`GV SMS from ${gv.callerPhone}: "${(gv.message || '').slice(0, 80)}"`);

  // Look up lead by phone
  const digits = gv.callerPhone.replace(/\D/g, '').slice(-10);
  const leadR = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${digits}&limit=1`,
    { headers: SB_H }
  );
  let lead = null;
  const leadData = await leadR.json();
  if (Array.isArray(leadData) && leadData.length > 0) lead = leadData[0];

  // Fetch conversation history
  let fullHistory = [];
  if (lead) {
    const histR = await fetch(
      `${SUPABASE_URL}/rest/v1/activities?lead_id=eq.${lead.id}&type=eq.sms&order=created_at.asc&limit=20&select=direction,body,summary,created_at`,
      { headers: SB_H }
    );
    fullHistory = await histR.json() || [];
  } else {
    // No lead record — search activities by phone number in summary
    const histR = await fetch(
      `${SUPABASE_URL}/rest/v1/activities?type=eq.sms&summary=ilike.*${digits}*&order=created_at.asc&limit=20&select=direction,body,summary,created_at`,
      { headers: SB_H }
    );
    fullHistory = await histR.json() || [];
  }

  // Auto-create lead if not found
  if (!lead && gv.callerPhone) {
    const newLeadR = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: { ...SB_H, Prefer: 'return=representation' },
      body: JSON.stringify({ phone: gv.callerPhone, source: 'google_voice_sms', status: 'new', client: 'rosalia' })
    });
    const newLeadData = await newLeadR.json();
    lead = Array.isArray(newLeadData) ? newLeadData[0] : newLeadData;
    console.log(`Auto-created lead for ${gv.callerPhone}: ${lead?.id}`);
  }

  // Add current inbound message to history if not already last item
  const lastMsg = fullHistory[fullHistory.length - 1];
  if (!lastMsg || lastMsg.direction !== 'inbound' || !(lastMsg.body || '').includes((gv.message || '').slice(0, 20))) {
    fullHistory.push({ direction: 'inbound', body: gv.message, created_at: new Date().toISOString() });
  }

  // Build conversation history string
  const convHistory = fullHistory.map(h => {
    const dir = h.direction === 'inbound' ? 'LEAD' : 'ANA';
    return `${dir}: ${h.body || h.summary || '(no content)'}`;
  }).join('\n');

  // AI decision: how to respond
  const prompt = `You are Ana Haynes, leasing agent at Rosalia Group in New Jersey. You are responding to an SMS conversation via Google Voice.

CONVERSATION SO FAR:
${convHistory}

CURRENT MESSAGE: "${gv.message}"
CALLER PHONE: ${gv.callerPhone}

RULES:
- If Ana (agent) has already responded to this specific message — choose WAIT, do not repeat the same reply
- If the lead mentioned their email — update your reply to acknowledge you will send details to that email
- Read ALL previous messages carefully before deciding — never treat a continuing conversation as a new inquiry
- Keep replies SHORT (1-2 sentences max) — this is SMS not email
- Always push toward booking a tour: https://book.rosaliagroup.com/book
- Sign off as: Ana | Rosalia Group

Decide ONE action. Reply with EXACTLY one of:
REPLY: <your SMS text here>
WAIT (if already responded or no action needed)`;

  console.log('GV: calling Claude for SMS response...');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  const aiText = data.content?.[0]?.text || '';
  console.log('GV AI decision:', aiText.slice(0, 100));

  if (aiText.startsWith('WAIT')) {
    console.log('GV: AI chose WAIT, no reply needed');
    return;
  }

  const replyMatch = aiText.match(/^REPLY:\s*(.+)/s);
  if (!replyMatch) {
    console.log('GV: unexpected AI response format, skipping');
    return;
  }

  const smsReply = replyMatch[1].trim();
  console.log(`GV: sending SMS reply to ${gv.callerPhone}: "${smsReply.slice(0, 80)}"`);

  // Send SMS via Textbelt
  if (TEXTBELT_KEY) {
    await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: gv.callerPhone, message: smsReply, key: TEXTBELT_KEY }),
    });
    console.log('GV: SMS reply sent');
  }

  // Log activity
  if (lead?.id) {
    await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
      method: 'POST',
      headers: { ...SB_H, Prefer: 'return=minimal' },
      body: JSON.stringify({
        lead_id: lead.id,
        type: 'sms',
        direction: 'outbound',
        body: smsReply,
        summary: `SMS to ${gv.callerPhone}: ${smsReply.slice(0, 100)}`,
        created_at: new Date().toISOString()
      })
    });
    // Also log the inbound message
    await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
      method: 'POST',
      headers: { ...SB_H, Prefer: 'return=minimal' },
      body: JSON.stringify({
        lead_id: lead.id,
        type: 'sms',
        direction: 'inbound',
        body: gv.message,
        summary: `SMS from ${gv.callerPhone}: ${(gv.message || '').slice(0, 100)}`,
        created_at: new Date().toISOString()
      })
    });
  }
}

function fetchUnreadEmails(forceDays) {
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
        since.setDate(since.getDate() - (forceDays || 14));
        const sinceStr = since.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const searchCriteria = forceDays ? [['SINCE', sinceStr]] : ['UNSEEN', ['SINCE', sinceStr]];
        imap.search(searchCriteria, (err, results) => {
          if (err) return reject(err);
          if (!results || results.length === 0) { imap.end(); return resolve([]); }
          const toFetch = results.slice(0, 20);
          const fetch = imap.fetch(toFetch, { bodies: '', markSeen: !forceDays });
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

async function hasExistingBooking(phone, email) {
  try {
    const q = [];
    if (phone) q.push(`phone.eq.${phone}`);
    if (email) q.push(`email.eq.${email}`);
    if (!q.length) return false;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings?or=(${q.join(',')})&preferred_date=not.is.null&limit=1`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const data = await res.json();
    return Array.isArray(data) && data.length > 0;
  } catch(e) { return false; }
}

async function getPreviousThread(fromEmail) {
  const lead = await getLeadData(fromEmail);
  return lead?.email_reply || null;
}

async function repliedRecently(fromEmail, hours = 24, emailReceivedAt = null) {
  const lead = await getLeadData(fromEmail);
  if (!lead?.replied_at) return false;
  const lastReply = new Date(lead.replied_at);

  // For thread replies (hours === 2): if the lead's email arrived AFTER our last reply,
  // they wrote back — always respond regardless of time window
  if (emailReceivedAt && hours === 2) {
    const received = new Date(emailReceivedAt);
    if (received > lastReply) {
      console.log(`Thread reply: lead email (${received.toISOString()}) is newer than our reply (${lastReply.toISOString()}) — responding`);
      return false;
    }
    // Our reply was sent AFTER this email — we already replied to it
    console.log(`Thread reply: already replied (${lastReply.toISOString()}) after this email (${received.toISOString()}) — skipping`);
    return true;
  }

  const hoursSince = (Date.now() - lastReply.getTime()) / (1000 * 60 * 60);
  if (hoursSince < hours) {
    console.log(`Duplicate check: already replied to ${fromEmail} ${hoursSince.toFixed(1)} hours ago, skipping`);
    return true;
  }
  return false;
}

async function createTask(leadName, leadEmail, leadPhone, taskType, description) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ lead_name: leadName, lead_email: leadEmail, lead_phone: leadPhone, task_type: taskType, description })
    });
    console.log('Task created:', taskType, leadEmail);
  } catch(e) { console.error('Task creation failed:', e.message); }
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

${previousReply ? 'A lead is REPLYING to your previous email. Read their reply carefully and answer EXACTLY what they asked — do not reintroduce yourself or repeat anything already said.' : `A new inquiry came in. ${nameGreeting}${detectedCity}${/Name\s*:/.test(body) && /(?:Email|Phone|Message|Your Message)\s*:/i.test(body) ? '\nIMPORTANT: This is a CONTACT FORM SUBMISSION from a website — the fields (Name, Email, Phone, select, Your Message) are the lead\'s info. The "Your Message" field contains what they wrote. If their message mentions availability or preferred times, acknowledge those times and send the booking link so they can pick a slot. If "Your Message" is empty or short, the lead is interested but didn\'t write a specific question — respond warmly and invite them to book a tour. NEVER say "I don\'t have a message" or "I\'m not sure what you\'re asking" — this is always a new lead contacting you.' : ''}`}

${userMessage}

REPLY FORMAT RULES (follow strictly):
0. BOOKING INTENT DETECTION: If the lead's message indicates they want to schedule, book, or see the apartment (e.g. contains words like yes, ready, available, schedule, book, tour, when, times, appointment, interested, come in) — respond with ONE sentence max confirming you are sending the link, then put the booking link on the next line. Nothing else. No questions. No follow-up. Example: Great — here is your booking link to pick a time that works for you.
1. FIRST sentence: directly answer the specific question they asked. Do not start with pleasantries.
2. SECOND sentence (optional): one relevant follow-up point or qualifying question — only if genuinely useful.
3. FINAL line (required, on its own line): the booking link — ${leadClient === 'iron65' ? 'always https://book.rosaliagroup.com/iron65' : 'always https://book.rosaliagroup.com/book (use https://book.rosaliagroup.com/iron65 ONLY if the inquiry is specifically about Iron 65 / 65 McWhorter)'}.
4. Never repeat anything said in a previous reply.
5. No bullet points. No lists. No markdown. No HTML. No subject line.
6. Do NOT end with "Please let me know if you have any other questions" or similar filler phrases.
7. Sign off once per email as: Rosalia Group | Inquiries Team | (862) 333-1681

Write ONLY the email body.`;

  console.log('Calling Claude API...');
  if (!ANTHROPIC_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — cannot generate reply');
    await syslog('error', 'ANTHROPIC_API_KEY not set', { from });
    return '';
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
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
    } catch (fetchErr) {
      console.error(`Claude API fetch failed (attempt ${attempt + 1}):`, fetchErr.message);
      if (attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
      await syslog('error', `Claude API fetch failed after retry: ${fetchErr.message}`, { from });
      return '';
    }

    const data = await res.json();
    if (!res.ok || data.type === 'error') {
      const errMsg = data.error?.message || JSON.stringify(data);
      console.error(`Claude API error (attempt ${attempt + 1}):`, res.status, errMsg);
      if (attempt === 1 || (res.status !== 429 && res.status !== 529 && res.status < 500)) {
        await syslog('error', `Claude API error ${res.status}: ${errMsg}`, { from, status: res.status });
      }
      if (attempt === 0 && (res.status === 429 || res.status === 529 || res.status >= 500)) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      return '';
    }
    return data.content?.[0]?.text || '';
  }
  return '';
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
  let replyHtml = cleaned.replace(/__URL_(\d+)__/g, (_, i) => {
    const url = urls[parseInt(i)];
    if (url.includes('drive.google.com')) {
      return `<br><strong>\u{1F4F8} <a href="${url}" style="color:#C9A84C;text-decoration:underline;">View Photos &amp; Videos</a></strong><br><em style="font-size:12px;color:#888;">*Actual unit may vary. Photos shown are of the same layout/model.</em>`;
    }
    return `<a href="${url}" style="color:#C9A84C;text-decoration:underline;">Book Your Tour Here</a>`;
  });
  const htmlBody = `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.8;color:#333;max-width:600px;">${replyHtml}</div>`;
  // Always CC inquiries@ so Ana sees every reply; merge with any extra ccEmail
  const ccAddresses = new Set();
  ccAddresses.add('inquiries@rosaliagroup.com');
  if (ccEmail && ccEmail !== replyTo) ccAddresses.add(ccEmail);
  // Don't CC the lead's own address
  ccAddresses.delete(replyTo);
  const mailOptions = {
    from: `"Rosalia Group Inquiries" <${INBOX_EMAIL}>`,
    to: replyTo,
    cc: [...ccAddresses].join(', ') || undefined,
    subject: replySubject,
    text: plainText,
    html: htmlBody,
  };
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
        phone: existing[0].phone || phone || null,  // keep existing phone; only fill if missing
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
      Prefer: 'return=representation,resolution=merge-duplicates',
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

async function processGoogleVoice(gv, fromEmail) {
  const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const SB_H = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  console.log(`GV ${gv.type} from ${gv.callerPhone}`);
  let lead = null;
  if (gv.callerPhone) {
    const digits = gv.callerPhone.replace(/\D/g, '');
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${digits}*&order=created_at.desc&limit=1`, { headers: SB_H });
    const data = await r.json();
    if (Array.isArray(data) && data.length > 0) lead = data[0];
  }
  let agent = null;
  if (fromEmail) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=eq.${encodeURIComponent(fromEmail)}&limit=1`, { headers: SB_H });
    const data = await r.json();
    if (Array.isArray(data) && data.length > 0) agent = data[0];
  }

  // Resolve SMS target: prefer GV replyTo, fall back to carrier gateway
  let smsTarget = gv.replyTo;
  if (!smsTarget && gv.callerPhone) {
    smsTarget = await getSMSGateway(gv.callerPhone);
    if (smsTarget) console.log(`Using carrier gateway: ${smsTarget}`);
  }
  const activitySummary = gv.type === 'sms'
    ? `Text from ${gv.callerPhone}: "${(gv.message||'').slice(0,80)}"`
    : gv.type === 'missed_call' ? `Missed call from ${gv.callerPhone}`
    : `Voicemail from ${gv.callerPhone}${gv.duration ? ' ('+gv.duration+')' : ''}`;
  if (lead) {
    await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
      method: 'POST', headers: { ...SB_H, Prefer: 'return=minimal' },
      body: JSON.stringify({ lead_id: lead.id, agent_id: agent?.id||null, type: gv.type==='sms'?'sms':'call', direction: 'inbound', summary: activitySummary, body: gv.message||null })
    });
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
      method: 'PATCH', headers: SB_H,
      body: JSON.stringify({ last_contact_at: new Date().toISOString() })
    });
  }
  if (gv.type === 'sms' && gv.message && ANTHROPIC_KEY) {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200,
        messages: [{ role: 'user', content: `Analyze this rental lead text message. Return JSON only:\nMessage: "${gv.message}"\nToday: ${new Date().toLocaleDateString()}\n\nReturn: {"action":"book_tour"|"create_task"|"none","date":"YYYY-MM-DD or null","time":"HH:MM AM/PM or null","task_title":"string or null","task_type":"call|followup|tour|null","task_due":"ISO or null"}` }]
      })
    });
    const aiData = await aiRes.json();
    let parsed = {};
    try { parsed = JSON.parse((aiData.content?.[0]?.text||'{}').replace(/```json|```/g,'').trim()); } catch(e){}
    console.log('GV AI action:', parsed.action);
    if (parsed.action === 'book_tour' && lead && parsed.date) {
      await fetch('https://abrevo.co/.netlify/functions/book', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: lead.name||'Lead', phone: lead.phone, email: lead.email, type: lead.property||'Tour', preferred_date: parsed.date, preferred_time: parsed.time||'10:00 AM', source: 'google_voice_sms' })
      });
    } else if (parsed.action === 'create_task' && parsed.task_title) {
      await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
        method: 'POST', headers: { ...SB_H, Prefer: 'return=minimal' },
        body: JSON.stringify({ lead_id: lead?.id||null, assigned_to: agent?.id||null, title: parsed.task_title, type: parsed.task_type||'followup', due_at: parsed.task_due||null, notes: `Auto from GV text: "${gv.message}"` })
      });
    }

    // AI reply via Google Voice — conversation-aware REPLY/WAIT decision
    try {
        // Read full conversation history (both inbound and outbound)
        const callerDigits = gv.callerPhone.replace(/\D/g,'');
        let fullHistory = [];
        try {
          // Get all activities for this lead
          if (lead) {
            const histR = await fetch(
              `${SUPABASE_URL}/rest/v1/activities?lead_id=eq.${lead.id}&type=eq.sms&order=created_at.asc&limit=20&select=direction,body,summary,created_at`,
              { headers: SB_H }
            );
            fullHistory = await histR.json() || [];
          }
        } catch(e) {}

        // Build conversation string
        const convHistory = fullHistory.map(h => {
          const who = h.direction === 'outbound' ? 'Ana' : 'Lead';
          const msg = (h.body || h.summary || '').replace(/<https[^>]+>/g,'').replace(/To respond.*/s,'').trim().slice(0,200);
          return msg ? `${who}: ${msg}` : null;
        }).filter(Boolean).join('\n');

        const lastOutbound = fullHistory.filter(h => h.direction === 'outbound').pop();
        const lastOutboundTime = lastOutbound ? new Date(lastOutbound.created_at) : null;
        const minutesSinceReply = lastOutboundTime ? (Date.now() - lastOutboundTime.getTime()) / 60000 : 999;

        // Ask AI: should I respond, and if so what should I say?
        const decisionRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 250,
            messages: [{ role: 'user', content: `You are Ana from Rosalia Group managing a rental lead conversation via SMS.

CONVERSATION SO FAR:
${convHistory || 'No previous messages'}

NEW MESSAGE FROM LEAD: "${gv.message}"
Minutes since last reply was sent: ${minutesSinceReply.toFixed(0)}

RULES:
- If the last reply already addressed this message — respond with ACTION: WAIT
- If the lead is asking for something not yet addressed (application, tour, pricing, availability) — respond with ACTION: REPLY
- If lead asks for application: reply with the apply link for their property. Iron 65: https://apply.weimark.com/ifw/b0f05d8828bbaf86e049a659c4fe1171/5965/new/ — All others: https://book.rosaliagroup.com/book (tour first, then application)
- If you send the application link and lead has provided email — mention you are sending full details to their email
- After sending application link, ask: 'Did you receive the email with the full application details?' if email was known
- If lead credit score mentioned below 625: explain minimum is 625, offer co-signer/guarantor option
- If lead confirmed they found the link or booked — respond ACTION: WAIT
- If lead says "thank you" or "ok" with nothing actionable — ACTION: WAIT
- Never send fake URLs. Only use: https://book.rosaliagroup.com/book or https://book.rosaliagroup.com/iron65 or https://apply.weimark.com/ifw/b0f05d8828bbaf86e049a659c4fe1171/5965/new/
- Keep reply under 160 chars
- Sign off: — Ana, Rosalia Group

Respond in this exact format:
ACTION: REPLY or WAIT
MESSAGE: [your SMS reply if ACTION is REPLY, otherwise leave blank]` }]
          })
        });

        const decisionData = await decisionRes.json();
        const decisionText = decisionData.content?.[0]?.text || '';
        const shouldReply = decisionText.includes('ACTION: REPLY');
        const messageMatch = decisionText.match(/MESSAGE:\s*(.+)/s);
        let smsReply = messageMatch ? messageMatch[1].trim() : '';

        console.log(`GV decision for ${gv.callerPhone}: ${shouldReply ? 'REPLY' : 'WAIT'}`);

        if (shouldReply && smsReply && smsTarget) {
          // Send main reply
          const nodemailer = require('nodemailer');
          const t = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
          await t.sendMail({
            from: `"Rosalia Group" <${GMAIL_USER}>`,
            to: smsTarget,
            subject: `Re: New text message from ${gv.callerPhone}`,
            text: smsReply
          });

          // Send booking link as separate message if not already in reply
          if (!smsReply.includes('book.rosaliagroup.com') && !smsReply.includes('liveiron65.com') && !smsReply.toLowerCase().includes('application')) {
            const isIron65msg = /iron.?65|mcwhorter/i.test(gv.message||'') || /iron.?65|mcwhorter/i.test(lead?.property||'');
            const bookingLink = isIron65msg ? 'https://book.rosaliagroup.com/iron65' : 'https://book.rosaliagroup.com/book';
            const t2 = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
            await t2.sendMail({
              from: `"Rosalia Group" <${GMAIL_USER}>`,
              to: smsTarget,
              subject: `Re: New text message from ${gv.callerPhone}`,
              text: `${bookingLink}\n— Ana, Rosalia Group (201) 497-0225`
            });
          }

          // If application requested and lead has email — send full application email
          const isAppRequest = /application|apply|how do i apply|submit/i.test(gv.message||'');
          const isIron65app = /iron.?65|mcwhorter/i.test(gv.message||'') || /iron.?65|mcwhorter/i.test(lead?.property||'');
          const appTemplate = APPLICATION_TEMPLATES[isIron65app ? 'iron65' : 'rosalia'];

          if (isAppRequest && lead?.email) {
            try {
              const emailTrans = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
              await emailTrans.sendMail({
                from: `"Rosalia Group" <${GMAIL_USER}>`,
                to: lead.email,
                cc: 'inquiries@rosaliagroup.com',
                subject: appTemplate.emailSubject,
                text: appTemplate.emailBody
              });
              console.log(`Application email sent to ${lead.email}`);
              // Follow up SMS confirming email sent
              const t3 = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
              await t3.sendMail({
                from: `"Rosalia Group" <${GMAIL_USER}>`,
                to: smsTarget,
                subject: `Re: New text message from ${gv.callerPhone}`,
                text: `I just sent the full application details to ${lead.email} — please check your inbox (and spam folder). Let me know if you have any questions! — Ana`
              });
            } catch(e) { console.error('Application email error:', e.message); }
          }

          // Log outbound reply
          if (lead) {
            await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
              method: 'POST', headers: { ...SB_H, Prefer: 'return=minimal' },
              body: JSON.stringify({ lead_id: lead.id, agent_id: agent?.id||null, type: 'sms', direction: 'outbound', summary: `GV SMS: "${smsReply.slice(0,80)}"`, body: smsReply })
            });
          }
          console.log(`GV SMS sent: "${smsReply.slice(0,80)}"`);
        }
    } catch(e) { console.error('GV AI reply error:', e.message); }
  }
  // Missed call — create task + immediately call back + SMS
  if (gv.type === 'missed_call') {
    // Create callback task
    if (lead) {
      await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
        method: 'POST', headers: { ...SB_H, Prefer: 'return=minimal' },
        body: JSON.stringify({ lead_id: lead.id, assigned_to: agent?.id||null, title: `Call back ${lead.name||gv.callerPhone}`, type: 'call', due_at: new Date().toISOString(), notes: `Missed GV call at ${new Date().toLocaleTimeString()}` })
      });
    }

    // Check business hours before calling
    const nowUTC = new Date();
    const etOffset = -4; // EDT (UTC-4), use -5 for EST
    const nowET = new Date(nowUTC.getTime() + etOffset * 3600000);
    const day = nowET.getUTCDay();
    const hour = nowET.getUTCHours() + nowET.getUTCMinutes()/60;
    const inHours = (day===0||day===6) ? (hour>=10&&hour<17) : (hour>=9&&hour<18);
    console.log(`GV missed call business hours check: ET ${nowET.toUTCString()} day=${day} hour=${hour.toFixed(1)} inHours=${inHours}`);

    if (inHours && gv.callerPhone) {
      // Call back via Vapi
      try {
        await fetch('https://api.vapi.ai/call/phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VAPI_KEY}` },
          body: JSON.stringify({
            phoneNumberId: '2e2b6713-f631-4e9e-95fa-3418ecc77c0a',
            assistantId: '1cae5323-6b83-4434-8461-6330472da140',
            customer: { number: gv.callerPhone, name: lead?.name || undefined },
            assistantOverrides: { variableValues: { lead_name: lead?.name||'', lead_property: lead?.property||'' } }
          })
        });
        console.log(`GV callback call triggered to ${gv.callerPhone}`);
      } catch(e) { console.error('GV callback call error:', e.message); }

      // SMS via Google Voice reply-to (threads in GV conversation)
      if (smsTarget) {
        try {
          const smsMsg = `Hi${lead?.name ? ' ' + lead.name.split(' ')[0] : ''}! This is Ana from Rosalia Group — sorry we missed your call. Calling you back now. Feel free to call or text (201) 497-0225 anytime.`;
          const nodemailer = require('nodemailer');
          const smsTrans = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
          await smsTrans.sendMail({ from: `"Rosalia Group" <${GMAIL_USER}>`, to: smsTarget, subject: smsMsg, text: smsMsg });
          console.log(`GV missed call SMS sent to ${smsTarget}`);
        } catch(e) { console.error('GV callback SMS error:', e.message); }
      } else {
        console.log('GV missed call SMS skipped — no replyTo or carrier gateway');
      }
    } else {
      console.log('GV missed call outside business hours — task created, no auto-call');
    }
  }
  // VOICEMAIL — read transcript, call back + text reply
  if (gv.type === 'voicemail' && gv.message) {
    const nowUTC = new Date();
    const etOffset = -4;
    const nowET = new Date(nowUTC.getTime() + etOffset * 3600000);
    const day = nowET.getUTCDay();
    const hour = nowET.getUTCHours() + nowET.getUTCMinutes()/60;
    const inHours = (day===0||day===6) ? (hour>=10&&hour<17) : (hour>=9&&hour<18);

    // Create task with voicemail transcript
    if (lead) {
      await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
        method: 'POST', headers: { ...SB_H, Prefer: 'return=minimal' },
        body: JSON.stringify({ lead_id: lead.id, assigned_to: agent?.id||null, title: `Voicemail from ${lead.name||gv.callerPhone}`, type: 'call', due_at: new Date().toISOString(), notes: `Voicemail transcript: "${gv.message}"` })
      });
    }

    if (inHours && gv.callerPhone && ANTHROPIC_KEY) {
      // AI reads voicemail and generates SMS reply
      const vmRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150,
          messages: [{ role: 'user', content: `You are Ana from Rosalia Group. A rental lead left a voicemail. Write a warm SMS reply acknowledging their voicemail and offering to help. 1-2 sentences max 160 chars. End with: — Ana, Rosalia Group\nLead: ${lead?.name||'there'} | Property: ${lead?.property||'our apartments'}\nVoicemail: "${gv.message}"\nReply ONLY the SMS text.` }]
        })
      });
      const vmData = await vmRes.json();
      const vmReply = (vmData.content?.[0]?.text||'').slice(0,160);

      // Send SMS reply via GV replyTo
      if (vmReply && smsTarget) {
        try {
          const nodemailer = require('nodemailer');
          const vmTrans = nodemailer.createTransport({ service:'gmail', auth:{ user: GMAIL_USER, pass: GMAIL_PASS }});
          await vmTrans.sendMail({ from: `"Rosalia Group" <${GMAIL_USER}>`, to: smsTarget, subject: vmReply, text: vmReply });
          console.log(`GV voicemail SMS reply sent to ${smsTarget}: "${vmReply.slice(0,60)}"`);
        } catch(e) { console.error('GV voicemail SMS error:', e.message); }
      } else if (vmReply) {
        console.log('GV voicemail SMS skipped — no replyTo or carrier gateway');
      }

      // Call back via Vapi
      try {
        await fetch('https://api.vapi.ai/call/phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VAPI_KEY}` },
          body: JSON.stringify({
            phoneNumberId: '2e2b6713-f631-4e9e-95fa-3418ecc77c0a',
            assistantId: '1cae5323-6b83-4434-8461-6330472da140',
            customer: { number: gv.callerPhone, name: lead?.name||undefined },
            assistantOverrides: { variableValues: { lead_name: lead?.name||'', lead_property: lead?.property||'', missed_call: 'true' } }
          })
        });
        console.log(`GV voicemail callback call triggered to ${gv.callerPhone}`);
      } catch(e) { console.error('GV voicemail call error:', e.message); }
    } else {
      console.log('GV voicemail outside business hours — task created, no auto-call/text');
    }
  }

  return { lead: lead?.name||null, agent: agent?.name||null, action: gv.type };
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!GMAIL_PASS) return { statusCode: 500, headers, body: JSON.stringify({ error: 'GMAIL_PASS_INQUIRIES not set' }) };

  const body = event.body ? JSON.parse(event.body) : {};
  const forceDays = body.force_days ? parseInt(body.force_days, 10) : null;

  try {
    console.log(`readmail: fetching ${forceDays ? `emails from last ${forceDays} days` : 'unread emails'} via IMAP...`);
    const rawEmails = await fetchUnreadEmails(forceDays);
    console.log(`Found ${rawEmails.length} unread emails`);
    const results = { processed: 0, skipped: 0, not_lead: 0, errors: 0, aiFailures: 0 };
    const processedEmails = new Set(); // Prevent processing same sender+subject twice per run

    for (const raw of rawEmails) {
      try {
        const parsed = await simpleParser(raw.raw);
        const from = parsed.from?.text || '';
        const subject = parsed.subject || '(no subject)';
        // Use text body, fall back to HTML with tags stripped
        const rawHtml = parsed.html || '';
        const strippedHtml = rawHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        // For Avail and Iron65/Brevo form emails, prefer HTML (has structured Name/Email/Phone labels)
        // For others, prefer plain text
        const preferHtml = (isAvailLead(from) || isWebflowLead(from, subject)) && strippedHtml;
        const body = preferHtml ? strippedHtml : (parsed.text || strippedHtml || '');
        const replyTo = parsed.replyTo?.text || from;

        const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
        const fromEmail = emailMatch?.[1] || from;
        const fromName = from.replace(/<[^>]+>/, '').trim().replace(/"/g, '') || null;

        console.log('Processing:', from, '|', subject);

        // Per-run dedup: skip if we already processed this sender+subject
        const dedupKey = `${fromEmail.toLowerCase()}::${subject}`;
        if (processedEmails.has(dedupKey)) {
          console.log('Skipping (already processed this run):', fromEmail, subject);
          results.skipped++;
          continue;
        }
        processedEmails.add(dedupKey);

        // Detect listing expiration/renewal alerts
        if (isListingAlert(from, subject)) {
          console.log('Listing alert detected:', from, subject);
          await saveListingAlert(from, subject, body);
          results.skipped++;
          continue;
        }

        // Google Voice SMS — process separately
        if (isGoogleVoice(from)) {
          console.log('Google Voice SMS detected:', from);
          await processGoogleVoice(from, body);
          results.processed++;
          continue;
        }

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
        } else if (isGoogleVoiceLead(from, subject)) {
          const gv = parseGoogleVoice(from, subject, body, replyTo || fromEmail);
          if (gv.callerPhone || gv.type) {
            try {
              const gvResult = await processGoogleVoice(gv, fromEmail);
              console.log('GV processed:', JSON.stringify(gvResult));
              results.processed++;
            } catch(e) {
              console.error('GV processing error:', e.message);
              results.errors++;
            }
          } else { results.skipped++; }
          continue;
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
          console.log('Webflow/Iron65 lead detected - from:', from, 'subject:', subject);
          const p = parseWebflowEmail(body, subject);
          console.log('Parsed lead:', JSON.stringify(p));
          if (p.phone) phone = p.phone;
          if (p.email) realEmail = p.email;
          if (p.name) realName = p.name;
          // Detect Iron 65 from sender or subject/body
          const fl = from.toLowerCase();
          const sl2 = subject.toLowerCase();
          const bl2 = (body || '').toLowerCase();
          if (fl.includes('iron65') || fl.includes('liveiron65') || sl2.includes('iron 65') || sl2.includes('mcwhorter') ||
              bl2.includes('iron 65') || bl2.includes('mcwhorter') || bl2.includes('iron65')) {
            leadClient = 'iron65';
          }
          if (!realEmail) {
            console.error('WARNING: Webflow/Iron65 lead but no email extracted from body! from:', from, 'subject:', subject, 'body snippet:', body.substring(0, 300));
          }
          console.log('Webflow lead - Email:', realEmail, 'Phone:', phone, 'Name:', realName, 'Client:', leadClient || 'rosalia');
        } else if (isZillowLead(from)) {
          const p = parseZillowEmail(body, from);
          // Zillow Group Rentals sets Reply-To to lead's real email — most reliable source
          if (replyTo && replyTo !== from && !replyTo.includes('zillowrentals') && !replyTo.includes('zillow.com')) {
            realEmail = replyTo;
          } else if (p.email) {
            realEmail = p.email;
          }
          if (p.name) realName = p.name;
          if (p.phone) phone = p.phone;
          // Defensive: relay emails NEVER have phone, regardless of what parser returned
          if (from.includes('convo.zillow.com') || from.includes('comet.zillow.com')) {
            phone = null;
          }
          console.log('Zillow lead - Name:', realName, 'Email:', realEmail, 'Phone:', phone || 'none');
        } else {
          // Strip emails from text before extracting phone
          // Only extract phone from generic body for non-Webflow sources
          // Webflow/Resipointe replies come from lead's Gmail — signature contains office numbers
          if (!isWebflowLead(from, subject)) {
            phone = extractPhone(body + ' ' + subject);
          }
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

        const checkEmail = (isAvailLead(from) || isWebflowLead(from, subject) || isZillowLead(from)) ? realEmail : fromEmail;
        const skipRecentCheck = isAvailLead(from) || from.includes('reply.avail.co') || from.includes('@avail.co') || isFUBLead(from, subject);

        // New emails get 4h throttle
        const receivedAt = parsed.date || null;
        if (!skipRecentCheck && !isReply && await repliedRecently(checkEmail, 4, receivedAt)) {
          console.log('Skipping (replied recently):', checkEmail, '(new email, 4h window)');
          results.skipped++;
          continue;
        }

        // Reply threads (Re:) — skip if we already replied within 24hrs
        if (isReply && await repliedRecently(checkEmail, 24, receivedAt)) {
          console.log('Skipping reply thread — already replied to', checkEmail, 'within 24hrs');
          results.skipped++;
          continue;
        }

        const leadContext = await getLeadContext(checkEmail, realName);

        if (leadContext?.status === 'dnc') {
          console.log('Skipping DNC lead:', checkEmail);
          results.skipped++;
          continue;
        }

        // Skip AI reply entirely if lead already has an upcoming booking (new emails only, not thread replies)
        if (!isReply && await hasExistingBooking(phone, realEmail || fromEmail)) {
          console.log('Skipping (already booked):', realEmail || fromEmail);
          results.skipped++;
          continue;
        }

        // Skip AI reply for specialist-status leads — create task for human follow-up
        const leadData = await getLeadData(checkEmail);
        if (leadData?.status === 'needs_specialist' && !isReply) {
          await createTask(realName || fromName, checkEmail, phone, 'specialist_followup', `Specialist lead sent new email: "${body.slice(0,300)}"`);
          console.log('Skipping (specialist lead):', checkEmail);
          results.skipped++;
          continue;
        }

        // Task detection — skip for form submissions (Webflow/Resipointe and FUB) since these are fresh inquiries
        if (!isWebflowLead(from, subject) && !isFUBLead(from, subject) && !isAvailLead(from)) {
          const leadName = realName || fromName || '';
          const msgLower = body.toLowerCase();
          const wantsFloorPlan = /floor\s*plan|layout|floorplan/.test(msgLower);
          const wantsPricing = /\bprice\b|\bpricing\b|how much|what.{0,10}cost|monthly rent|what.{0,10}rate/.test(msgLower);
          const wantsSpecificUnit = /specific unit|unit number|apartment number|which unit/.test(msgLower);
          const wantsOptOut = /remove me|unsubscribe|stop email|opt out|do not contact|no further|don.t contact/.test(msgLower);

          if (wantsOptOut) {
            await createTask(leadName, checkEmail, phone, 'opt_out', `Lead requested opt-out: "${body.slice(0,200)}"`);
            await fetch(`${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(checkEmail)}`, { method: 'PATCH', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'dnc', call_attempts: 99 }) });
            console.log('Opt-out processed for:', checkEmail);
            results.skipped++;
            continue;
          }
          if (wantsFloorPlan) {
            await createTask(leadName, checkEmail, phone, 'floor_plan_request', `Lead requested floor plans for ${leadContext?.property || 'property'}: "${body.slice(0,200)}"`);
          }
          if (wantsPricing) {
            await createTask(leadName, checkEmail, phone, 'pricing_request', `Lead requested specific pricing: "${body.slice(0,200)}"`);
          }
          if (wantsSpecificUnit) {
            await createTask(leadName, checkEmail, phone, 'unit_request', `Lead requested specific unit info: "${body.slice(0,200)}"`);
          }
        }

        // Cross-run dedup: if another cron run already replied in the last 10 min, skip
        if (!isReply && await repliedRecently(checkEmail, 10/60)) {
          console.log('Skipping (cross-run duplicate, replied <10min ago):', checkEmail);
          results.skipped++;
          continue;
        }

        const calendarAppt = await getCalendarAppointment(realName || fromName);
        if (calendarAppt) console.log('Calendar appointment found:', calendarAppt.date, calendarAppt.time);
        if (leadContext) console.log('Lead context found:', leadContext.status);

        let replyText = await generateReply(from, subject, body, previousReply, leadContext, calendarAppt, realName, leadClient);
        if (!replyText) {
          console.error('generateReply returned empty for:', fromEmail, '| subject:', subject);
          await syslog('warn', `Empty AI reply for ${fromEmail}`, { email: fromEmail, subject });
          results.errors++;
          results.aiFailures++;
          continue;
        }

        // Extract unit number from email body for model-specific media
        const unitMatch = body.match(/unit\s*#?\s*(\d{3}[A-Z]?)/i) || body.match(/apt\.?\s*#?\s*(\d{3}[A-Z]?)/i);
        const unitNumber = unitMatch ? unitMatch[1] : null;

        // Append property photos/videos link if available
        const mediaLink = getPropertyMedia(leadContext?.property, body, unitNumber);
        if (mediaLink) {
          replyText = replyText + '\n\nView photos and videos of the unit:\n' + mediaLink;
        }

        const effectiveReplyTo = (isAvailLead(from) || isWebflowLead(from, subject)) ? realEmail : replyTo;
        // For Avail leads: reply to relay so it appears in Avail platform, CC real email
        const avail = isAvailLead(from);
        const isFUB = isFUBLead(from, subject);

        // For FUB leads with no real email (Facebook/Instagram leads) — skip email reply, use SMS+call only
        if (isFUB && !realEmail) {
          console.log('FUB lead with no email (Facebook/Instagram) — skipping email reply, SMS+call only');
          await saveLead(fromEmail, realName || fromName, subject, body, null, phone, leadClient);
          await notifyAna(realName || fromName || from, subject, phone, false);
          if (phone) {
            const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
            const etHour = nowET.getHours();
            const etDay = nowET.getDay();
            const callAllowed = (etDay >= 1 && etDay <= 5) ? (etHour >= 9 && etHour < 18) :
                                (etDay === 6) ? (etHour >= 10 && etHour < 17) :
                                (etHour >= 11 && etHour < 17);
            const smsBookingUrl = leadClient === 'iron65' ? IRON65_BOOKING_URL : BOOKING_FORM_URL;
            await sendSMS(phone, realName || fromName, '', smsBookingUrl);
            if (callAllowed) {
              await triggerCall(phone, realName || fromName);
            }
          }
          results.processed++;
          continue;
        }

        // AppFolio sends from guestcards@appfolio.com but real lead email is in reply-to
        if ((from || '').includes('appfolio.com') || (from || '').includes('guestcards')) {
          const appfolioReplyTo = parsed.replyTo?.text;
          if (appfolioReplyTo && !appfolioReplyTo.includes('appfolio.com')) {
            realEmail = appfolioReplyTo;
            effectiveReplyTo = appfolioReplyTo;
          }
          console.log('AppFolio lead — using reply-to:', effectiveReplyTo);
        }

        console.log('Reply routing — from:', from, '| realEmail:', realEmail, '| effectiveReplyTo:', effectiveReplyTo, '| replyTo:', replyTo);
        const replyTarget = avail ? fromEmail : realEmail || effectiveReplyTo;
        // Safety: never reply to the notification sender (iron65.com, brevo, etc) — only to the lead
        if (isWebflowLead(from, subject) && !realEmail) {
          console.error('ABORT: Webflow/Iron65 lead but no lead email extracted — would reply to notification sender:', from);
          await syslog('error', `Webflow lead with no extracted email — reply aborted`, { from, subject, body: body.substring(0, 500) });
          results.errors++;
          continue;
        }
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
        await syslog('error', `Error processing email: ${err.message}`, { from: raw?.from });
        results.errors++;
      }
    }

    // Alert Ana if AI replies are failing (likely dead API key or rate limit)
    if (results.aiFailures >= 3 && TEXTBELT_KEY) {
      try {
        await fetch('https://textbelt.com/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: '+16462269189',
            message: `⚠️ Rosalia AI Alert: ${results.aiFailures} emails got empty AI replies this run. Check ANTHROPIC_API_KEY or API status.`,
            key: TEXTBELT_KEY,
          }),
        });
        console.log('AI failure alert SMS sent to Ana');
      } catch (err) { console.error('AI alert SMS error:', err.message); }
    }

    if (results.errors > 0) {
      await syslog('warn', `Run completed with ${results.errors} errors`, { total: rawEmails.length, ...results });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, total_unread: rawEmails.length, results }) };

  } catch (err) {
    console.error('readmail error:', err.message);
    await syslog('error', `readmail crash: ${err.message}`, { stack: err.stack?.slice(0, 500) });
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// Shared exports for recovery script and other consumers
exports.parseZillowEmail = parseZillowEmail;
exports.parseAvailEmail = parseAvailEmail;
exports.parseWebflowEmail = parseWebflowEmail;
exports.parseFUBEmail = parseFUBEmail;
exports.isZillowLead = isZillowLead;
exports.isAvailLead = isAvailLead;
exports.isWebflowLead = isWebflowLead;
exports.isFUBLead = isFUBLead;
exports.extractPhone = extractPhone;
exports.generateReply = generateReply;
exports.sendReply = sendReply;
exports.saveLead = saveLead;
exports.sendSMS = sendSMS;
exports.triggerCall = triggerCall;
exports.notifyAna = notifyAna;
exports.syslog = syslog;
exports.repliedRecently = repliedRecently;
exports.getLeadData = getLeadData;
exports.getLeadContext = getLeadContext;
exports.createTask = createTask;
