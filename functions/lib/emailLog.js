// functions/lib/emailLog.js
// Records each email as its own row so the CRM shows a real thread. Previously
// readmail overwrote leads.email_reply on every exchange, keeping only the last.
// Deduped on RFC Message-ID because readmail polls IMAP every minute and can see
// the same message twice. Best-effort: never throws, never blocks a reply.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MAX_BODY = 20000;
function clip(v) { const s = v == null ? null : String(v); return s && s.length > MAX_BODY ? s.slice(0, MAX_BODY) : s; }
async function logEmail(e) {
  try {
    if (!SUPABASE_KEY || !e || !e.leadId || !e.direction) return { logged: false };
    if (!e.body || !String(e.body).trim()) return { logged: false, reason: 'empty_body' };
    const res = await fetch(SUPABASE_URL + '/rest/v1/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        lead_id: e.leadId, direction: e.direction,
        subject: clip(e.subject) || null, body: clip(e.body),
        from_email: e.fromEmail || null, to_email: e.toEmail || null,
        message_id: e.messageId || null,
        created_at: e.createdAt || new Date().toISOString(),
      }),
    });
    if (!res.ok) { console.warn('[emailLog] insert failed', res.status); return { logged: false }; }
    return { logged: true };
  } catch (err) { console.warn('[emailLog] error:', err.message); return { logged: false }; }
}
module.exports = { logEmail };