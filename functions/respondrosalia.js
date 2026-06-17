const nodemailer = require('nodemailer');
const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TEXTBELT_KEY = process.env.TEXTBELT_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANA_PHONE = '+16462269189';
const BOOKING_FORM_URL = 'https://book.rosaliagroup.com/book';
const IRON65_BOOKING_URL = 'https://book.rosaliagroup.com/iron65';

const GMAIL_USER = process.env.GMAIL_USER || 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES || process.env.GMAIL_PASS;

async function sendEmail(to, subject, textBody, htmlOverride) {
  if (!to || to.includes('privaterelay') || to.includes('appfolio.com')) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
  const fallbackHtml = `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.8;color:#333;max-width:600px;">${(textBody || '').replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<>"]+)/g, (match) => {
    if (match.includes('properties.rosaliagroup.com') || match.includes('drive.google.com') || match.includes('abrevo.co/properties') || match.includes('silver-ganache-1ee2ca.netlify.app/properties')) {
      var lbl = 'View Photos &amp; Videos';
      if (match.includes('1Ufb0l-4L')) lbl = 'Studio \u2014 View Photos &amp; Videos';
      else if (match.includes('15QalYV80cwWyJ6')) lbl = '1 Bedroom \u2014 View Photos &amp; Videos';
      else if (match.includes('1g0v-wXqjGRPwyd')) lbl = '1 Bedroom \u2014 View Photos &amp; Videos';
      else if (match.includes('1Q_dfJG97uFZHCC')) lbl = '2 Bedroom \u2014 View Photos &amp; Videos';
      return '<a href="' + match + '" style="color:#C9A84C;font-weight:bold;text-decoration:none;">\u{1F4F8} ' + lbl + '</a>';
    }
    if (match.includes('book.rosaliagroup.com')) {
      return '<a href="' + match + '" style="color:#C9A84C;font-weight:bold;text-decoration:none;">\u{1F4C5} Book a Tour</a>';
    }
    return '<a href="' + match + '" style="color:#C9A84C;text-decoration:none;">' + match + '</a>';
  })}</div>`;
  await transporter.sendMail({
    from: `"Rosalia Group Inquiries" <${GMAIL_USER}>`,
    to,
    cc: 'inquiries@rosaliagroup.com',
    subject,
    html: htmlOverride || fallbackHtml,
    text: textBody,
  });
}

// -- DETECT BUYER vs RENTAL --
function detectCategory(lead) {
  const source = (lead.source || '').toLowerCase();
  const message = (lead.message || '').toLowerCase();
  const pipeline = (lead.pipeline || '').toLowerCase();
  const price = Number(lead.price) || 0;

  if (pipeline.includes('buyer') || pipeline.includes('seller')) return 'buyer';
  if (price > 100000) return 'buyer';
  if (/buy|purchas|mortgage|pre.approv|down payment|sell.*before|closing/i.test(message)) return 'buyer';
  if (source.includes('avail') || source.includes('resipointe')) return 'rental';
  if (/rent|lease|apartment|unit|tenant|move.in|monthly/i.test(message)) return 'rental';
  if (/iron.?pointe|market.?st|madison.?st|elks|hobson/i.test(lead.property || '')) return 'rental';
  return price > 0 ? 'buyer' : 'rental';
}

function getBookingLink(lead) {
  const prop = (lead.property || lead.source || '').toLowerCase();
  const isIron65 = prop.includes('iron 65') || prop.includes('iron65') || prop.includes('mcwhorter');
  return isIron65 ? IRON65_BOOKING_URL : BOOKING_FORM_URL;
}

async function generateReply(lead) {
  const category = lead.category || detectCategory(lead);
  const bookingLink = getBookingLink(lead);
  const firstName = lead.name?.split(' ')[0] || 'there';

  let prompt;

  if (category === 'buyer') {
    prompt = `You are Ana Haynes, Licensed Realtor at Rosalia Group in New Jersey. You help buyers and sellers across Newark, Jersey City, East Orange, Elizabeth, and surrounding areas.

A new BUYER lead came in. Write a SHORT personalized email reply that:
1. Greets them by first name: "${firstName}"
2. Thanks them for their interest in real estate in New Jersey
3. Mentions you specialize in the area and would love to help them find the right home
4. Invites them to schedule a quick call or meeting (say 'use the link below' or 'click below to book' — do NOT write out any URL)
5. Signs off as: Ana Haynes | Rosalia Group | (862) 333-1681 | inquiries@rosaliagroup.com

Source: ${lead.source || 'online inquiry'}
Message: ${lead.message || 'Interested in properties'}
Price range: ${lead.price ? '$' + Number(lead.price).toLocaleString() : 'not specified'}
Timeframe: ${lead.timeframe || 'not specified'}

Do NOT reference or repeat any details the lead mentioned (pets, lease length, budget, income, etc). Do NOT say things like 'you'd be a great fit', 'you qualify', 'sounds perfect', 'no pets noted', 'noted on 12 months'. Do NOT use excited or enthusiastic language like 'I'm excited', 'I'd love to', 'Great news', 'Amazing'. Keep the tone warm and professional but not overly enthusiastic. Just greet them, thank them for their interest, and invite them to book a tour. Under 80 words. No bullet points. Reply with ONLY the email body.`;

  } else {
    const isIronPointe = /iron.?pointe|resipointe|madison/i.test(lead.property || '');
    const building = isIronPointe ? 'Iron Pointe' : (lead.property || 'our available rentals');
    const isApplication = lead.type === 'application';

    prompt = `You are Ana Haynes, Leasing Manager at Rosalia Group in New Jersey. You manage rentals across Newark, Jersey City, East Orange, Elizabeth, and Orange NJ.

${isApplication ? 'A renter has COMPLETED A RENTAL APPLICATION.' : 'A new rental inquiry came in.'} Write a SHORT personalized email reply that:
1. Greets them by first name: "${firstName}"
2. ${isApplication ? 'Thanks them for completing their application, says you will review within 24 hours' : `Thanks them for their interest in ${building}`}
3. ${isApplication ? 'Explains next steps: review, possible interview, lease signing' : `Invites them to schedule a tour (say 'use the link below' or 'click below to book' — do NOT write out any URL)`}
4. ${lead.budget ? `Acknowledges their budget of ${lead.budget}` : ''}
5. Signs off as: Ana Haynes | Rosalia Group | (862) 333-1681 | inquiries@rosaliagroup.com

Property: ${building}
Message: ${lead.message || 'Interested in renting'}
${lead.bedrooms ? 'Bedrooms: ' + lead.bedrooms : ''}
${lead.budget ? 'Budget: ' + lead.budget : ''}

Do NOT reference or repeat any details the lead mentioned (pets, lease length, budget, income, etc). Do NOT say things like 'you'd be a great fit', 'you qualify', 'sounds perfect', 'no pets noted', 'noted on 12 months'. Do NOT use excited or enthusiastic language like 'I'm excited', 'I'd love to', 'Great news', 'Amazing'. Keep the tone warm and professional but not overly enthusiastic. Just greet them, thank them for their interest, and invite them to book a tour. Under 80 words. No bullet points. Reply with ONLY the email body.`;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  const reply = data.content?.[0]?.text || '';
  if (!reply) {
    console.error('Anthropic returned empty reply:', JSON.stringify(data).slice(0, 200));
  }
  return reply;
}

async function generateFollowUp(lead, followUpNumber) {
  const category = lead.category || detectCategory(lead);
  const first = lead.name?.split(' ')[0] || 'there';
  const prop = lead.property || (category === 'buyer' ? 'your dream home' : 'the property');
  const bookingLink = getBookingLink(lead);

  if (category === 'buyer') {
    const msgs = {
      1: `Hi ${first}, just following up from Ana at Rosalia Group! Are you still looking for a home in NJ? I'd love to help -- schedule a quick call: ${bookingLink} -- (862) 333-1681`,
      2: `Hi ${first}, last follow up from Ana at Rosalia Group. The market is moving fast -- if you're still looking, I'm here to help: ${bookingLink}`,
    };
    return msgs[followUpNumber] || msgs[1];
  } else {
    const msgs = {
      1: `Hi ${first}, just following up on your inquiry about ${prop}! We still have availability. Schedule a tour: ${bookingLink} -- Ana, Rosalia Group (862) 333-1681`,
      2: `Hi ${first}, last follow up from Ana at Rosalia Group -- ${prop} is still available but going fast. Book a tour: ${bookingLink}`,
    };
    return msgs[followUpNumber] || msgs[1];
  }
}

async function sendSMS(phone, message) {
  if (!phone) return null;
  let p = phone.toString().replace(/\D/g, '');
  if (p.length === 10) p = '+1' + p;
  else if (p.length === 11 && !p.startsWith('+')) p = '+' + p;
  const res = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: p, message, key: TEXTBELT_KEY }),
  });
  return res.json();
}

async function findExistingLead(email, phone) {
  if (email) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[0];
  }
  if (phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${cleanPhone}*&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[0];
  }
  return null;
}

async function saveOrUpdateLead(lead, emailReply) {
  const category = lead.category || detectCategory(lead);
  const existing = await findExistingLead(lead.email, lead.phone);

  if (existing) {
    console.log('Existing lead found:', existing.id, '-- merging');
    const newNote = `[${new Date().toLocaleDateString()}] ${lead.source || 'inquiry'}: ${lead.message || 'no message'}`;
    const mergedNotes = existing.notes ? existing.notes + '\n' + newNote : newNote;
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        notes: mergedNotes,
        replied_at: new Date().toISOString(),
        email_reply: emailReply,
        phone: existing.phone || lead.phone || null,
      }),
    });
    return existing;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      name: lead.name || null,
      email: lead.email || null,
      phone: lead.phone || null,
      source: lead.source || null,
      message: lead.message || null,
      property: lead.property || null,
      client: 'rosalia',
      status: lead.type === 'application' ? 'applied' : 'new',
      replied_at: new Date().toISOString(),
      follow_up_count: 0,
      email_reply: emailReply,
      notes: [
        `Category: ${category}`,
        lead.budget && `Budget: ${lead.budget}`,
        lead.bedrooms && `Bedrooms: ${lead.bedrooms}`,
        lead.price && `Price: $${lead.price}`,
        lead.timeframe && `Timeframe: ${lead.timeframe}`,
      ].filter(Boolean).join(' | ') || null,
    }),
  });
  const text = await res.text();
  console.log('Supabase insert:', res.status, text.substring(0, 200));
  try {
    const saved = JSON.parse(text);
    return Array.isArray(saved) ? saved[0] : saved;
  } catch (e) {
    return null;
  }
}

async function updateLeadFollowUp(leadId, count) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ follow_up_count: count, last_follow_up_at: new Date().toISOString() }),
  });
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { action = 'reply', lead = {}, lead_id, follow_up_number = 1 } = body;

    const parsedLead = { ...lead };
    parsedLead.category = parsedLead.category || detectCategory(parsedLead);

    console.log('respondRosalia | Action:', action, '| Category:', parsedLead.category, '| Source:', parsedLead.source);
    console.log('Lead:', JSON.stringify({ name: parsedLead.name, email: parsedLead.email, phone: parsedLead.phone, property: parsedLead.property }));

    if (action === 'reply') {
      if (!parsedLead.email && !parsedLead.phone) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No email or phone found' }) };
      }

      let emailReply = await generateReply(parsedLead);
      console.log('Email reply length:', emailReply.length);

      // Add property photos link
      const RESP_PROPERTY_MEDIA = {
        'iron 65': 'https://silver-ganache-1ee2ca.netlify.app/properties/iron65.html',
        'mcwhorter': 'https://silver-ganache-1ee2ca.netlify.app/properties/iron65.html',
        '39 madison': 'https://silver-ganache-1ee2ca.netlify.app/properties/39-madison.html',
        'iron pointe': 'https://silver-ganache-1ee2ca.netlify.app/properties/39-madison.html',
        '28 jefferson': 'https://silver-ganache-1ee2ca.netlify.app/properties/39-madison.html',
        '502 market': 'https://silver-ganache-1ee2ca.netlify.app/properties/502-market.html',
        '500 market': 'https://silver-ganache-1ee2ca.netlify.app/properties/502-market.html',
        '486 market': 'https://silver-ganache-1ee2ca.netlify.app/properties/486-market.html',
        '6 madison': 'https://silver-ganache-1ee2ca.netlify.app/properties/486-market.html',
        '556 market': 'https://silver-ganache-1ee2ca.netlify.app/properties/556-market.html',
        '554 market': 'https://silver-ganache-1ee2ca.netlify.app/properties/556-market.html',
        '74 webster': 'https://silver-ganache-1ee2ca.netlify.app/properties/74-webster.html',
        '76 webster': 'https://silver-ganache-1ee2ca.netlify.app/properties/74-webster.html',
        '11 thomas': 'https://silver-ganache-1ee2ca.netlify.app/properties/11-thomas.html',
        '164 university': 'https://silver-ganache-1ee2ca.netlify.app/properties/164-university.html',
        '162 university': 'https://silver-ganache-1ee2ca.netlify.app/properties/164-university.html',
        '176 garfield': 'https://silver-ganache-1ee2ca.netlify.app/properties/other-listings.html',
        '136 s 7th': 'https://silver-ganache-1ee2ca.netlify.app/properties/other-listings.html',
        '86 wilson': 'https://silver-ganache-1ee2ca.netlify.app/properties/other-listings.html',
        '883 springfield': 'https://silver-ganache-1ee2ca.netlify.app/properties/other-listings.html',
        '53 bleeker': 'https://silver-ganache-1ee2ca.netlify.app/properties/other-listings.html',
      };

      const propText = (parsedLead.property || parsedLead.source || '').toLowerCase();
      let mediaLink = null;
      let mediaLink2 = null;
      for (const [key, url] of Object.entries(RESP_PROPERTY_MEDIA)) {
        if (propText.includes(key)) { mediaLink = url; break; }
      }

      // Iron Pointe / 39 Madison — floor plans and 2BR video
      const msg = (parsedLead.message || '').toLowerCase();
      const isIronPointe = /iron.?pointe|39.?madison|28.?jefferson/i.test(propText);
      if (isIronPointe) {
        if (/floor.?plan|blueprint|layout/i.test(msg)) {
          mediaLink = 'https://drive.google.com/file/d/1XKjfX9SNN8Gf7yvP_w3VKhGHM79_FlLU/view';
        } else if (/2\s*b(?:ed|r)|two\s*bed/i.test(msg)) {
          mediaLink = 'https://drive.google.com/file/d/1WmD2LsDCbjE26LBv-qAxodSpK40NcWqi/view';
        }
      }

      // 502 Market — unit-specific folders
      if (propText.includes('502 market') || propText.includes('500 market')) {
        const wants1BR = /1\s*b(?:ed|r)|one\s*bed/i.test(msg);
        const wants2BR = /2\s*b(?:ed|r)|two\s*bed/i.test(msg);
        if (wants1BR && !wants2BR) {
          mediaLink = 'https://drive.google.com/drive/folders/1g0v-wXqjGRPwyd_0ZMW4e9DV-4-bDFS0';
        } else if (wants2BR && !wants1BR) {
          mediaLink = 'https://drive.google.com/drive/folders/1Q_dfJG97uFZHCC_4fuGZt0o1M0qZmD_B';
        } else {
          mediaLink = 'https://drive.google.com/drive/folders/1g0v-wXqjGRPwyd_0ZMW4e9DV-4-bDFS0';
          mediaLink2 = 'https://drive.google.com/drive/folders/1Q_dfJG97uFZHCC_4fuGZt0o1M0qZmD_B';
        }
      }

      // Iron 65 special case — send studio + 1BR links if no specific unit type mentioned
      const isIron65Lead = propText.includes('iron 65') || propText.includes('mcwhorter') || propText.includes('iron65');
      if (isIron65Lead) {
        const wantsStudio = /studio|st\b|485|465|560|607/.test(msg);
        const wants1BR = /1\s*b(ed|r)|one\s*bed|1bed/.test(msg);
        const wantsLoft = /loft|den|penthouse/.test(msg);

        if (wantsStudio && !wants1BR) {
          mediaLink = 'https://drive.google.com/file/d/1Ufb0l-4L-uNxpzIBKIA2g2upR2YsWMI-/view';
        } else if (wants1BR && !wantsStudio) {
          mediaLink = 'https://drive.google.com/file/d/15QalYV80cwWyJ6W8r0DGmmHXV7121yoe/view';
        } else if (wantsLoft) {
          mediaLink = 'https://drive.google.com/drive/folders/1VetphM-E2AghDux37UkGXu5vNkNcefh5';
        } else {
          // Don't send videos — AI will ask unit type
          mediaLink = null;
          mediaLink2 = null;
        }
      }

      // Strip booking URLs and signature from AI reply — we add them explicitly at the bottom
      const bookingLinkUrl = getBookingLink(parsedLead);
      const cleanReply = emailReply
        .replace(/\u{1F4C5}\s*https?:\/\/book\.rosaliagroup\.com[^\s]*/gu, '')
        .replace(/https?:\/\/book\.rosaliagroup\.com[^\s]*/g, '')
        .replace(/Ana Haynes[\s\S]*?inquiries@rosaliagroup\.com/g, '')
        .replace(/Rosalia Group[\s|]+\(862\)[\s\S]*?inquiries@rosaliagroup\.com/g, '')
        .replace(/Looking forward to (connecting|meeting you|hearing from you|speaking with you|connecting with you)[.!]?/gi, '')
        .replace(/Don't hesitate to reach out.*$/gim, '')
        .replace(/Feel free to reach out.*$/gim, '')
        .replace(/\bwith you soon\.?\s*$/gim, '')
        .replace(/\n\s*soon\.?\s*\n/gi, '\n')
        .replace(/^soon\.?\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const signature = '<br><br><span style="color:#555;font-size:14px;">Rosalia Group | Inquiries Team | (862) 333-1681 | <a href="mailto:inquiries@rosaliagroup.com" style="color:#C9A84C;">inquiries@rosaliagroup.com</a></span>';

      const htmlEmail = `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.8;color:#333;max-width:600px;">
        ${cleanReply.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<>"]+)/g, (match) => {
          if (match.includes('properties.rosaliagroup.com') || match.includes('drive.google.com') || match.includes('abrevo.co/properties') || match.includes('silver-ganache-1ee2ca.netlify.app/properties')) {
            var lbl2 = 'View Photos &amp; Videos';
            if (match.includes('1Ufb0l-4L')) lbl2 = 'Studio \u2014 View Photos &amp; Videos';
            else if (match.includes('15QalYV80cwWyJ6')) lbl2 = '1 Bedroom \u2014 View Photos &amp; Videos';
            else if (match.includes('1g0v-wXqjGRPwyd')) lbl2 = '1 Bedroom \u2014 View Photos &amp; Videos';
            else if (match.includes('1Q_dfJG97uFZHCC')) lbl2 = '2 Bedroom \u2014 View Photos &amp; Videos';
            return '<a href="' + match + '" style="color:#C9A84C;font-weight:bold;text-decoration:none;">\u{1F4F8} ' + lbl2 + '</a>';
          }
          return '<a href="' + match + '" style="color:#C9A84C;text-decoration:none;">' + match + '</a>';
        })}
        ${mediaLink ? `
        <br><br>
        <a href="${mediaLink}" style="color:#C9A84C;font-weight:bold;text-decoration:none;display:block;margin:8px 0;">\u{1F4F8} ${
          mediaLink.includes('1Ufb0l-4L') ? 'Studio \u2014 ' :
          mediaLink.includes('1g0v-wXqjGRPwyd') ? '1 Bedroom \u2014 ' :
          mediaLink2 ? '' : ''
        }View Photos &amp; Videos</a>
        ${mediaLink2 ? `<a href="${mediaLink2}" style="color:#C9A84C;font-weight:bold;text-decoration:none;display:block;margin:8px 0;">\u{1F4F8} ${
          mediaLink2.includes('15QalYV80cwWyJ6') ? '1 Bedroom' :
          mediaLink2.includes('1Q_dfJG97uFZHCC') ? '2 Bedroom' :
          'Additional'
        } \u2014 View Photos &amp; Videos</a>` : ''}
        <em style="font-size:12px;color:#999;">*Actual unit may vary. Photos shown are of the same layout/model.</em>
        ` : ''}
        <br>
        <a href="${bookingLinkUrl}" style="color:#C9A84C;font-weight:bold;text-decoration:none;font-size:17px;display:block;margin:12px 0;">\u{1F4C5} Book a Tour</a>
        <br><br>
        <span style="color:#555;">Looking forward to connecting with you!</span>
        ${signature}
      </div>`;

      const savedLead = await saveOrUpdateLead(parsedLead, emailReply);
      console.log('Lead saved/merged, id:', savedLead?.id);

      // SMS to lead -- no URLs (Textbelt whitelist pending)
      if (parsedLead.phone) {
        const smsText = parsedLead.category === 'buyer'
          ? `Hi ${parsedLead.name?.split(' ')[0] || 'there'}! This is Ana from Rosalia Group following up on your real estate inquiry. I'll reach out shortly -- (862) 333-1681.`
          : `Hi ${parsedLead.name?.split(' ')[0] || 'there'}! This is Ana from Rosalia Group following up on your rental inquiry. I'll reach out shortly -- (862) 333-1681.`;
        const smsResult = await sendSMS(parsedLead.phone, smsText);
        console.log('Lead SMS:', JSON.stringify(smsResult));
      }

      // Notify Ana -- no URLs
      const anaMsg = `New ${(parsedLead.category || 'lead').toUpperCase()} Lead! (${parsedLead.source || 'rosalia'})\nName: ${parsedLead.name || 'N/A'}\nEmail: ${parsedLead.email || 'N/A'}\nPhone: ${parsedLead.phone || 'N/A'}\nProperty: ${parsedLead.property || 'N/A'}`;
      const anaResult = await sendSMS(ANA_PHONE, anaMsg);
      console.log('Ana SMS:', JSON.stringify(anaResult));

      const subject = parsedLead.category === 'buyer'
        ? `Re: Your real estate inquiry -- Rosalia Group`
        : parsedLead.type === 'application'
        ? `Application received -- ${parsedLead.property || 'your property'}`
        : `Re: Your inquiry about ${parsedLead.property || 'the property'}`;

      // Actually send the email
      if (parsedLead.email && emailReply) {
        try {
          await sendEmail(parsedLead.email, subject, emailReply, htmlEmail);
          console.log('Email sent to:', parsedLead.email);
        } catch (err) {
          console.error('Email send error:', err.message);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          email_reply: emailReply,
          subject,
          to_email: parsedLead.email,
          lead_id: savedLead?.id || null,
          category: parsedLead.category,
        }),
      };
    }

    if (action === 'follow_up') {
      const followUpText = await generateFollowUp(parsedLead, follow_up_number);
      if (parsedLead.phone) await sendSMS(parsedLead.phone, followUpText);
      if (lead_id) await updateLeadFollowUp(lead_id, follow_up_number);
      const subject = follow_up_number === 1
        ? `Following up -- ${parsedLead.property || 'your inquiry'}`
        : `Still interested? -- ${parsedLead.property || 'the property'}`;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, follow_up_text: followUpText, subject, to_email: parsedLead.email }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('respondRosalia error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
