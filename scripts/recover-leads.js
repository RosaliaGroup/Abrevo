const Imap = require('imap');
const { simpleParser } = require('mailparser');
const path = require('path');

// Import pipeline functions from readmail.js
const readmail = require(path.join(__dirname, '..', 'functions', 'readmail'));
const {
  parseZillowEmail, parseAvailEmail, parseWebflowEmail, parseFUBEmail,
  extractPhone, isZillowLead, isAvailLead, isWebflowLead, isFUBLead,
  generateReply, sendReply, saveLead, sendSMS, triggerCall, notifyAna,
} = readmail;

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const BOOKING_FORM_URL = 'https://book.rosaliagroup.com/book';
const IRON65_BOOKING_URL = 'https://book.rosaliagroup.com/iron65';

const EXECUTE = process.argv.includes('--execute');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 30;
})();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Fetch ALL emails (read + unread) from lead senders in the last 14 days
function fetchLeadEmails() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: GMAIL_USER,
      password: GMAIL_PASS,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 15000,
    });
    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => { // true = read-only, won't mark seen
        if (err) return reject(err);
        const since = new Date();
        since.setDate(since.getDate() - 14);
        const sinceStr = since.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        // Search by sender patterns — OR across all lead sources
        const senderSearches = [
          ['HEADER', 'FROM', 'rentalclientservices@zillowrentals.com'],
          ['HEADER', 'FROM', 'convo.zillow.com'],
          ['HEADER', 'FROM', 'comet.zillow.com'],
          ['HEADER', 'FROM', 'avail.co'],
          ['HEADER', 'FROM', 'webflow.com'],
          ['HEADER', 'FROM', 'followupboss.com'],
        ];

        let allResults = [];
        let completed = 0;

        senderSearches.forEach((senderCriteria) => {
          imap.search([['SINCE', sinceStr], senderCriteria], (err, results) => {
            if (err) { console.error('Search error:', err.message); }
            else if (results && results.length > 0) { allResults = allResults.concat(results); }
            completed++;

            if (completed === senderSearches.length) {
              // Deduplicate UIDs
              const unique = [...new Set(allResults)];
              console.log(`IMAP found ${unique.length} emails from lead sources (last 14 days)`);
              if (unique.length === 0) { imap.end(); return resolve([]); }

              const fetch = imap.fetch(unique, { bodies: '' });
              fetch.on('message', (msg) => {
                let buffer = '';
                msg.on('body', (stream) => { stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); }); });
                msg.once('end', () => { emails.push({ raw: buffer }); });
              });
              fetch.once('error', (err) => { console.error('Fetch error:', err.message); reject(err); });
              fetch.once('end', () => { imap.end(); });
            }
          });
        });
      });
    });

    imap.once('end', () => resolve(emails));
    imap.once('error', reject);
    imap.connect();
  });
}

// Check Supabase for a lead by email
async function checkLead(email) {
  if (!email) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&limit=1&select=id,name,email,replied_at,follow_up_count`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await r.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

// Determine lead source label
function getSourceLabel(from, subject) {
  const f = (from || '').toLowerCase();
  if (f.includes('rentalclientservices@zillowrentals')) return 'zillow_group';
  if (f.includes('convo.zillow.com') || f.includes('comet.zillow.com')) return 'zillow_relay';
  if (isAvailLead(from)) return 'avail';
  if (isWebflowLead(from, subject)) return 'resipointe';
  if (isFUBLead(from, subject)) return 'fub';
  return 'other';
}

// Extract lead info from an email (mirrors readmail.js logic)
function extractLeadInfo(from, subject, body, replyTo) {
  let realEmail = null;
  let realName = null;
  let phone = null;
  let leadClient = null;

  if (isZillowLead(from)) {
    const p = parseZillowEmail(body);
    // Prefer Reply-To header for Zillow Group Rentals
    if (replyTo && replyTo !== from && !replyTo.includes('zillowrentals') && !replyTo.includes('zillow.com')) {
      realEmail = replyTo;
    } else if (p.email) {
      realEmail = p.email;
    }
    if (p.name) realName = p.name;
    if (p.phone) phone = p.phone;
    // Detect Iron 65
    const sl = (subject + ' ' + body).toLowerCase();
    if (sl.includes('iron 65') || sl.includes('mcwhorter') || sl.includes('iron65')) leadClient = 'iron65';
  } else if (isAvailLead(from)) {
    const p = parseAvailEmail(body);
    if (p.email) realEmail = p.email;
    if (p.name) realName = p.name;
    if (p.phone) phone = p.phone;
    const sl = (subject + ' ' + body).toLowerCase();
    if (sl.includes('iron 65') || sl.includes('mcwhorter')) leadClient = 'iron65';
  } else if (isWebflowLead(from, subject)) {
    const p = parseWebflowEmail(body);
    if (p.email) realEmail = p.email;
    if (p.name) realName = p.name;
    if (p.phone) phone = p.phone;
  } else if (isFUBLead(from, subject)) {
    const p = parseFUBEmail(body);
    if (p.email) realEmail = p.email;
    if (p.name) realName = p.name;
    if (p.phone) phone = p.phone;
    const sl = (subject + ' ' + body).toLowerCase();
    if (sl.includes('iron 65') || sl.includes('mcwhorter') || sl.includes('iron65')) leadClient = 'iron65';
  }

  // Fallback: extract phone from body
  if (!phone) phone = extractPhone(body + ' ' + subject);

  // Extract from name from email header if not parsed
  if (!realName) {
    const nameMatch = from.replace(/<[^>]+>/, '').trim().replace(/"/g, '');
    if (nameMatch && !nameMatch.includes('@')) realName = nameMatch;
  }

  return { realEmail, realName, phone, leadClient };
}

async function main() {
  console.log(`\n=== LEAD RECOVERY SCRIPT — ${EXECUTE ? 'EXECUTE MODE' : 'DRY RUN'} ===\n`);

  if (!GMAIL_PASS) { console.error('GMAIL_PASS_INQUIRIES not set'); process.exit(1); }
  if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_KEY not set'); process.exit(1); }
  if (EXECUTE && !process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

  // Step 1: Fetch emails
  console.log('Connecting to IMAP (read-only)...');
  const rawEmails = await fetchLeadEmails();
  console.log(`Fetched ${rawEmails.length} emails\n`);

  // Step 2: Parse all emails
  const allParsed = [];
  for (const raw of rawEmails) {
    try {
      const parsed = await simpleParser(raw.raw);
      const from = parsed.from?.text || '';
      const subject = parsed.subject || '';
      const rawHtml = parsed.html || '';
      const strippedHtml = rawHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const body = (isAvailLead(from) && strippedHtml) ? strippedHtml : (parsed.text || strippedHtml || '');
      const replyTo = parsed.replyTo?.text || from;
      const date = parsed.date || new Date();
      const source = getSourceLabel(from, subject);

      if (source === 'other') continue;
      if (from.includes('rosaliagroup.com') || from.includes('mechanicalenterprise.com')) continue;

      const info = extractLeadInfo(from, subject, body, replyTo);
      if (!info.realEmail) continue;

      allParsed.push({ from, subject, body, replyTo, date, source, ...info });
    } catch (e) {
      // Skip unparseable emails
    }
  }

  // Sort by date descending BEFORE dedup — so dedup keeps the most recent email per lead
  allParsed.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Deduplicate: keep only the most recent email per lead email
  const leads = [];
  const seenEmails = new Set();
  for (const entry of allParsed) {
    const emailKey = entry.realEmail.toLowerCase();
    if (seenEmails.has(emailKey)) continue;
    seenEmails.add(emailKey);
    leads.push(entry);
  }

  // Step 3: Check Supabase for each lead
  console.log('Checking Supabase for existing leads...\n');
  const results = [];
  const bySrc = {};

  for (const lead of leads) {
    const existing = await checkLead(lead.realEmail);
    const status = existing
      ? (existing.replied_at ? 'REPLIED' : 'UNREPLIED')
      : 'MISS';
    const action = status === 'REPLIED' ? 'SKIP' : 'PROCESS';

    bySrc[lead.source] = bySrc[lead.source] || { skip: 0, process: 0 };
    bySrc[lead.source][action === 'SKIP' ? 'skip' : 'process']++;

    results.push({ ...lead, supabaseStatus: status, action });
  }

  // Step 4: Print table
  let processCount = 0;
  let skipCount = 0;

  results.forEach((r, i) => {
    const dateStr = new Date(r.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    const emailDisplay = (r.realEmail || '').substring(0, 30).padEnd(30);
    const nameDisplay = (r.realName || '(unknown)').substring(0, 22).padEnd(22);
    const phoneDisplay = (r.phone || '(no phone)').padEnd(14);
    const srcDisplay = r.source.padEnd(14);
    const statusDisplay = r.action === 'SKIP'
      ? `supabase=${r.supabaseStatus.padEnd(9)} | ACTION=SKIP`
      : `supabase=${r.supabaseStatus.padEnd(9)} | ACTION=PROCESS`;

    const marker = r.action === 'PROCESS' ? '>>>' : '   ';
    console.log(`${marker} [${String(i + 1).padStart(2)}] ${nameDisplay} | ${emailDisplay} | ${phoneDisplay} | ${srcDisplay} | ${dateStr.padEnd(18)} | ${statusDisplay}`);

    if (r.action === 'PROCESS') processCount++;
    else skipCount++;
  });

  console.log(`\n--- SUMMARY ---`);
  console.log(`Total emails scanned:    ${rawEmails.length}`);
  console.log(`Unique leads found:      ${results.length}`);
  console.log(`Already replied (skip):  ${skipCount}`);
  console.log(`Would process:           ${processCount}`);
  console.log(`Source breakdown:`);
  for (const [src, counts] of Object.entries(bySrc)) {
    console.log(`  ${src.padEnd(16)} process=${counts.process}  skip=${counts.skip}`);
  }

  if (!EXECUTE) {
    console.log(`\nDry run complete. Run with --execute to process ${Math.min(processCount, LIMIT)} leads (cap: ${LIMIT}).`);
    process.exit(0);
  }

  // Step 5: Execute
  const toProcess = results.filter(r => r.action === 'PROCESS').slice(0, LIMIT);
  console.log(`\n=== EXECUTING: processing ${toProcess.length} leads ===\n`);

  let success = 0;
  let errors = 0;

  // Business hours check
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const etHour = nowET.getHours();
  const etDay = nowET.getDay();
  const callAllowed = (etDay >= 1 && etDay <= 5) ? (etHour >= 9 && etHour < 18) :
                      (etDay === 6) ? (etHour >= 10 && etHour < 17) :
                      (etHour >= 11 && etHour < 17);

  for (let i = 0; i < toProcess.length; i++) {
    const lead = toProcess[i];
    const tag = `[${i + 1}/${toProcess.length}]`;
    try {
      process.stdout.write(`${tag} ${lead.realName || lead.realEmail}...`);

      // Generate AI reply
      const replyText = await generateReply(
        lead.from, lead.subject, lead.body,
        null, null, null,
        lead.realName, lead.leadClient
      );
      if (!replyText) {
        console.log(' SKIP (empty reply from AI)');
        errors++;
        await sleep(3000);
        continue;
      }
      process.stdout.write(' reply');

      // Send email
      await sendReply(lead.realEmail, lead.subject, replyText);
      process.stdout.write(' sent');

      // Save to Supabase
      await saveLead(lead.realEmail, lead.realName, lead.subject, lead.body, replyText, lead.phone, lead.leadClient);
      process.stdout.write(' saved');

      // SMS
      if (lead.phone) {
        const bookingUrl = lead.leadClient === 'iron65' ? IRON65_BOOKING_URL : BOOKING_FORM_URL;
        await sendSMS(lead.phone, lead.realName, '', bookingUrl);
        process.stdout.write(' sms');
      }

      // Call
      if (lead.phone && callAllowed) {
        await triggerCall(lead.phone, lead.realName);
        process.stdout.write(' call');
      }

      // Notify Ana
      await notifyAna(lead.realName || lead.realEmail, lead.subject, lead.phone, callAllowed);

      console.log(' DONE');
      success++;
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
      errors++;
    }

    if (i < toProcess.length - 1) await sleep(3000);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Processed: ${success} success, ${errors} errors`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
