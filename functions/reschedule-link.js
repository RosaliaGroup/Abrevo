// functions/reschedule-link.js
// Branded reschedule redirector: GET /r/<code>
// <code> = bookings.short_code. 302 to the right reschedule form for the booking's
// property, passing ?code so the form can prefill. Unknown code -> generic
// /reschedule (never a dead end).

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const SB_H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const RESCHEDULE = 'https://book.rosaliagroup.com/reschedule';
const IRON65_RESCHEDULE = 'https://book.rosaliagroup.com/iron65-reschedule';

function codeFromEvent(event) {
  const parts = (event.path || '').split('?')[0].split('/').filter(Boolean);
  const last = decodeURIComponent(parts[parts.length - 1] || '');
  const m = last.match(/[0-9a-fA-F]{1,16}/);
  return m ? m[0] : '';
}

function isIron65(property) {
  if (!property) return false;
  const p = property.toLowerCase();
  return p.includes('iron 65') || p.includes('mcwhorter') || p.includes('65 mcwhorter');
}

function redirect(target) {
  return { statusCode: 302, headers: { Location: target, 'Cache-Control': 'no-cache' }, body: '' };
}

exports.handler = async (event) => {
  const code = codeFromEvent(event);
  if (!code || !SUPABASE_KEY) {
    console.log('Reschedule link:', code || '(none)', 'UNKNOWN');
    return redirect(RESCHEDULE);
  }

  let booking = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?short_code=ilike.${encodeURIComponent(code)}&select=id,type&limit=1`,
      { headers: SB_H }
    );
    const rows = await r.json();
    booking = Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    console.error('reschedule-link: lookup failed:', err.message);
  }

  if (!booking) {
    console.log('Reschedule link:', code, 'UNKNOWN');
    return redirect(RESCHEDULE);
  }

  const propertyAddress = booking.type || '';
  const base = isIron65(propertyAddress) ? IRON65_RESCHEDULE : RESCHEDULE;
  const target = `${base}?code=${encodeURIComponent(code)}`;
  console.log('Reschedule link:', code, booking.id, '->', target);
  return redirect(target);
};
