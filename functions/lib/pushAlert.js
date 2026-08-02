// functions/lib/pushAlert.js
//
// Send a push notification to every registered device.
//
// Alerts were only wired to inbound texts, but a text is one of several things
// worth knowing about the moment it happens: a lead emailing, an AI call
// finishing, a tour being booked, or an appointment coming up tomorrow. This is
// the shared sender so each of those can notify without repeating the logic.
//
// Best-effort everywhere: these run inside webhooks and scheduled functions, and
// a push failure must never turn into a non-2xx or break the flow that produced
// the event.

const { sendPush } = require('./webpush');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function headers() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

/**
 * @param {object} n
 * @param {string} n.title
 * @param {string} n.body
 * @param {string} [n.tag]  same tag replaces an earlier notification rather
 *                          than stacking several from one lead
 * @param {string} [n.url]  where tapping it should land
 */
async function pushToAll(n) {
  try {
    if (!SUPABASE_KEY || !process.env.VAPID_PRIVATE_KEY) return { sent: 0, reason: 'not_configured' };

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth&failures=lt.5`,
      { headers: headers() }
    );
    const subs = await res.json();
    if (!Array.isArray(subs) || !subs.length) return { sent: 0, reason: 'no_devices' };

    const payload = {
      title: n.title || 'Rosalia CRM',
      body: String(n.body || '').slice(0, 160),
      tag: n.tag || 'rosalia',
      url: n.url || '/crm',
    };

    let sent = 0;
    for (const sub of subs) {
      const r = await sendPush(sub, payload);
      if (r.ok) { sent++; continue; }
      if (r.gone) {
        // The browser dropped this subscription — delete rather than retry.
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${sub.id}`, {
          method: 'DELETE', headers: headers(),
        });
      }
    }
    console.log(`[pushAlert] "${payload.title}" -> ${sent}/${subs.length} device(s)`);
    return { sent };
  } catch (err) {
    console.warn('[pushAlert] failed:', err.message);
    return { sent: 0, reason: 'error' };
  }
}

/** Look up a lead's name by phone, so alerts name a person not a number. */
async function nameForPhone(phone) {
  try {
    const d = String(phone || '').replace(/\D/g, '').slice(-10);
    if (!d || !SUPABASE_KEY) return null;
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${d}*&select=name&limit=1`,
      { headers: headers() }
    );
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0].name : null;
  } catch (e) {
    return null;
  }
}

module.exports = { pushToAll, nameForPhone };
