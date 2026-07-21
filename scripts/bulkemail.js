// ============================================================
// bulkemail.js  —  OPERATIONAL SCRIPT (NOT a Netlify endpoint) [Gate A]
// Auto-generates and emails outreach to ALL recent unreplied leads.
// ============================================================
// Moved out of functions/ during Gate A containment. This blasts every unreplied
// lead and previously had NO auth as a public endpoint — it must never be a
// deployed/publicly-invocable surface again.
//
// SAFETY (Gate A): DRY-RUN BY DEFAULT. A live send REQUIRES BOTH:
//   --live                       (opt into sending)
//   --confirm-production SEND     (explicit production confirmation)
// Missing either one => the script previews the recipient count and aborts.
//
// USAGE:
//   node bulkemail.js                                  (dry run — preview only)
//   node bulkemail.js --live --confirm-production SEND (LIVE send)
// ============================================================

const nodemailer = require('nodemailer');

// ─── GATE A SEND GUARD ─────────────────────────────────────
const LIVE_FLAG   = process.argv.includes('--live');
const CONFIRM_IDX = process.argv.indexOf('--confirm-production');
const CONFIRMED   = CONFIRM_IDX !== -1 && process.argv[CONFIRM_IDX + 1] === 'SEND';
const IS_LIVE     = LIVE_FLAG && CONFIRMED;

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;
const BOOKING_URL = 'https://book.rosaliagroup.com/iron65';

function isValidEmail(email) {
  if (!email) return false;
  if (email.includes('incomplete-')) return false;
  if (email.includes('convo.zillow.com')) return false;
  if (email.includes('newjerseyhomesbyrosalia.com')) return false;
  if (email.includes('testlead@')) return false;
  if (!email.includes('@')) return false;
  return true;
}

async function getUnrepliedLeads() {
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?created_at=gte.${since.toISOString()}&email=not.is.null&email_reply=is.null&limit=10&order=created_at.desc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return (Array.isArray(data) ? data : []).filter(l => isValidEmail(l.email));
}

async function generateReply(name, source, message) {
  const first = (name || '').split(' ')[0] || 'there';
  const prompt = `You are the Rosalia Group Inquiries Team in New Jersey.
Write a SHORT warm outreach email to a lead we haven't contacted yet.
- Greet them by first name: ${first}
- Mention we have great rental properties available in NJ
- Invite them to schedule a tour: ${BOOKING_URL}
- Ask for their phone number if not in their info
- Keep it under 80 words, no bullet points
- Sign off: Rosalia Group | Inquiries Team | +18624191763 | inquiries@rosaliagroup.com
Lead source: ${source || 'inquiry'}
Their info: ${(message || 'General inquiry').substring(0, 200)}
Write ONLY the email body.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function sendEmail(toEmail, toName, body) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
  await transporter.sendMail({
    from: `"Rosalia Group Inquiries" <${GMAIL_USER}>`,
    to: toEmail,
    subject: `Your Inquiry -- Rosalia Group`,
    text: body,
  });
}

async function markReplied(leadId, replyText) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ email_reply: replyText, replied_at: new Date().toISOString() }),
  });
}

async function main() {
  console.log('\n📧 Rosalia Group — Bulk Unreplied-Lead Email');
  console.log(`🔁 Mode: ${IS_LIVE ? 'LIVE SEND' : 'DRY RUN (no email will be sent)'}`);

  const leads = await getUnrepliedLeads();
  console.log(`✅ ${leads.length} unreplied lead(s) matched | intended recipients: ${leads.length}\n`);
  if (!leads.length) { console.log('No unreplied leads. Nothing to do.'); return; }

  if (!IS_LIVE) {
    console.log('--- PREVIEW (first 3 recipients) ---');
    leads.slice(0, 3).forEach(l => console.log(`  To: ${l.name || 'Homeowner'} <${l.email}>`));
    console.log(`\n⛔ DRY RUN — no emails sent to ${leads.length} recipient(s).`);
    if (LIVE_FLAG && !CONFIRMED) {
      console.log('   --live was given but --confirm-production SEND was NOT. Aborting send.');
    }
    console.log('   To send for real: node bulkemail.js --live --confirm-production SEND');
    return;
  }

  console.log(`🚨 LIVE SEND CONFIRMED — emailing ${leads.length} recipient(s) in 3s...\n`);
  await new Promise(r => setTimeout(r, 3000));

  const results = { sent: 0, errors: 0, skipped: 0 };
  for (const lead of leads) {
    try {
      const reply = await generateReply(lead.name, lead.source, lead.message);
      if (!reply) { results.skipped++; continue; }

      await sendEmail(lead.email, lead.name, reply);
      await markReplied(lead.id, reply);
      results.sent++;
      console.log(`Sent to: ${lead.name} <${lead.email}>`);

      // Small delay to avoid Gmail rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`Error for ${lead.name}:`, err.message);
      results.errors++;
    }
  }

  console.log(`\n🎉 Done! Sent: ${results.sent} | Skipped: ${results.skipped} | Errors: ${results.errors}`);
}

main().catch(e => { console.error('\n❌ Fatal:', e.message); process.exit(1); });
