// ============================================================
// sms-campaign-hvac.js
// Mechanical Enterprise HVAC — Textbelt SMS Outreach Campaign
// ============================================================
// USAGE:
//   node sms-campaign-hvac.js --dry-run         (preview + credit check)
//   node sms-campaign-hvac.js --limit 20        (send first 20)
//   node sms-campaign-hvac.js                   (send all 'new')
//
// TEXTBELT KEY: 06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr
// NOTE: ~42 credits remaining — top up before full run at https://textbelt.com
//       1,100 texts ≈ $55 at $0.05/text (bulk pricing available)
//
// COMPLIANCE:
//   - "Reply STOP" included in every message (required)
//   - Best send times: Tue–Thu 10am–7pm EST
// ============================================================

const https = require('https');
const fs    = require('fs');

// ─── CONFIG ────────────────────────────────────────────────
const CONFIG = {
  TEXTBELT_KEY:  process.env.TEXTBELT_KEY || '06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr',
  SUPABASE_URL:  process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL',
  SUPABASE_KEY:  process.env.SUPABASE_KEY || 'YOUR_SUPABASE_SERVICE_KEY',
  SOURCE:        'hvac-list-07105',
  STATUS:        'new',
  DELAY_MS:      1200,
  DRY_RUN:       process.argv.includes('--dry-run'),
  LIMIT:         getLimitArg(),
  BOOKING_URL:   'https://mwbe-enterprises.com/free-assessment',
  COMPANY_PHONE: '(973) 555-0100',  // ← update with real number
};

function getLimitArg() {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 && process.argv[idx+1] ? parseInt(process.argv[idx+1]) : null;
}

// ─── SMS TEMPLATES ─────────────────────────────────────────
const TEMPLATES = [
  (l) => `Hi ${fn(l.name)}, your home at ${addr(l.page)} may qualify for a FREE heating checkup from Mechanical Enterprise. Homes built ${yr(l.message)} often need attention. Book: ${CONFIG.BOOKING_URL} Reply STOP to opt out.`,
  (l) => `${fn(l.name)} - Is your heating system 15+ yrs old? Mechanical Enterprise is offering FREE assessments to NJ homeowners this month. No cost, no obligation. ${CONFIG.BOOKING_URL} Reply STOP`,
  (l) => `Hi ${fn(l.name)}! Older HVAC systems can waste $300-500/yr on energy. Mechanical Enterprise offers a FREE home heating checkup - honest, no pressure. ${CONFIG.BOOKING_URL} Reply STOP`,
];

function fn(name) {
  if (!name) return 'Homeowner';
  const f = name.trim().split(' ')[0];
  return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
}
function addr(page) { return page?.split(',')[0]?.trim() || 'your property'; }
function yr(msg)    { const m = msg?.match(/Year Built: (\d{4})/); return m ? m[1] : 'the 2000s'; }
function getMsg(lead, i) {
  const msg = TEMPLATES[i % TEMPLATES.length](lead);
  return msg.length > 320 ? TEMPLATES[1](lead) : msg;
}

// ─── TEXTBELT ──────────────────────────────────────────────
function checkCredits() {
  return new Promise((resolve, reject) => {
    https.get(`https://textbelt.com/quota/${CONFIG.TEXTBELT_KEY}`, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    }).on('error', reject);
  });
}

function sendSMS(phone, message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ phone, message, key: CONFIG.TEXTBELT_KEY });
    const req = https.request({
      hostname: 'textbelt.com', path: '/text', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({ success: false, error: buf }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── SUPABASE ──────────────────────────────────────────────
function sbReq(method, path, body) {
  const host = new URL(CONFIG.SUPABASE_URL).hostname;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: host, path, method,
      headers: {
        'apikey': CONFIG.SUPABASE_KEY, 'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve({status:res.statusCode,data:b})); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function fetchLeads() {
  let q = `/rest/v1/leads?source=eq.${CONFIG.SOURCE}&status=eq.${CONFIG.STATUS}&phone=not.is.null&select=id,name,phone,page,message&order=id.asc`;
  if (CONFIG.LIMIT) q += `&limit=${CONFIG.LIMIT}`;
  const r = await sbReq('GET', q);
  return JSON.parse(r.data || '[]');
}

async function updateStatus(id, status, tbId) {
  return sbReq('PATCH', `/rest/v1/leads?id=eq.${id}`, {
    status, call_id: tbId||null, updated_at: new Date().toISOString(),
  });
}

// ─── MAIN ──────────────────────────────────────────────────
async function main() {
  console.log('\n📱 Mechanical Enterprise — HVAC SMS Campaign (Textbelt)');
  console.log(`🔁 Mode: ${CONFIG.DRY_RUN ? 'DRY RUN' : 'LIVE SEND'}`);
  if (CONFIG.LIMIT) console.log(`🔢 Limit: ${CONFIG.LIMIT}`);

  const quota = await checkCredits();
  console.log(`💳 Credits remaining: ${quota.quotaRemaining ?? 'unknown'}\n`);

  if (!CONFIG.DRY_RUN && (quota.quotaRemaining ?? 999) < 10) {
    console.log('❌ Not enough credits. Top up at https://textbelt.com');
    return;
  }

  const leads = await fetchLeads();
  console.log(`✅ ${leads.length} leads ready\n`);
  if (!leads.length) { console.log('No leads. Run import-hvac-leads.js first.'); return; }

  if (CONFIG.DRY_RUN) {
    console.log('--- PREVIEW (first 3) ---\n');
    leads.slice(0,3).forEach((l,i) => {
      const msg = getMsg(l,i);
      console.log(`To: ${l.phone} (${l.name})\n[${msg.length} chars]: ${msg}\n`);
    });
    console.log(`💳 Credits needed: ${CONFIG.LIMIT || leads.length} | Available: ${quota.quotaRemaining ?? 'unknown'}`);
    console.log('\n✅ Dry run done. Remove --dry-run to send.');
    return;
  }

  const results = []; let sent=0, failed=0;

  for (let i=0; i<leads.length; i++) {
    const lead = leads[i];
    const msg  = getMsg(lead, i);
    process.stdout.write(`[${i+1}/${leads.length}] ${lead.name} (${lead.phone})... `);

    try {
      const res = await sendSMS(lead.phone, msg);
      if (res.success) {
        console.log(`✅ (ID:${res.textId} | credits left:${res.quotaRemaining})`);
        await updateStatus(lead.id, 'sms-sent', res.textId);
        results.push({...lead, status:'sms-sent', tbId:res.textId});
        sent++;
      } else {
        const err = res.error || 'failed';
        console.log(`❌ ${err}`);
        await updateStatus(lead.id, 'sms-failed', null);
        results.push({...lead, status:'sms-failed', error:err});
        failed++;
        if (err.toLowerCase().includes('quota') || err.toLowerCase().includes('credit')) {
          console.log('\n💳 Out of credits! Top up at https://textbelt.com and re-run.');
          break;
        }
      }
    } catch(e) {
      console.log(`❌ ${e.message}`);
      results.push({...lead, status:'sms-error', error:e.message});
      failed++;
    }

    if (i < leads.length-1) await new Promise(r=>setTimeout(r, CONFIG.DELAY_MS));
  }

  // Save report
  const ts   = new Date().toISOString().slice(0,19).replace(/[:.]/g,'-');
  const file = `sms-report-${ts}.csv`;
  const lines = ['id,name,phone,status,textbelt_id,error'];
  results.forEach(r => lines.push([r.id,`"${r.name}"`,r.phone,r.status,r.tbId||'',r.error||''].join(',')));
  fs.writeFileSync(file, lines.join('\n'));

  console.log(`\n🎉 Done! Sent: ${sent} | Failed: ${failed} | Report: ${file}`);
  console.log('💡 Run email-campaign-hvac.js next for the 503 leads with real emails.');
}

main().catch(e => { console.error('\n❌ Fatal:', e.message); process.exit(1); });
