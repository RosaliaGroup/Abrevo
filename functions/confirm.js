// functions/confirm.js
// One-tap tour confirmation: GET /c/<code>
// <code> = bookings.short_code (8 hex chars). No HMAC, no uuid in the URL.

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPPORT_PHONE = '(862) 419-1763';

const SB_H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

// Path -> code, sanitized to hex so it can't inject PostgREST operators.
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

function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return 'your scheduled day';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// Dark/gold shell — fluid, mobile-first (no fixed pixel widths).
function page(headline, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rosalia Group</title>
  <style>
    * { box-sizing: border-box; }
    body { margin:0; padding:24px 16px; background:#0A0A0A; font-family:'Georgia',serif; }
    .card { width:100%; max-width:600px; margin:0 auto; background:#111111; border:1px solid #C9A84C; border-radius:4px; overflow:hidden; }
    .head { background:#0A0A0A; padding:28px 20px; text-align:center; border-bottom:1px solid #C9A84C; }
    .brand { color:#C9A84C; font-size:11px; letter-spacing:4px; text-transform:uppercase; }
    .diamond { color:#C9A84C; font-size:18px; margin-top:6px; }
    .body { padding:32px 24px; }
    h1 { color:#C9A84C; font-size:20px; font-weight:normal; letter-spacing:2px; text-transform:uppercase; margin:0 0 20px 0; }
    p { color:#E8E8E8; font-size:16px; line-height:1.7; margin:0 0 16px 0; }
    .muted { color:#999; font-size:14px; }
    .btn { display:inline-block; background:#C9A84C; color:#0A0A0A; font-size:12px; letter-spacing:3px; text-transform:uppercase; padding:14px 28px; text-decoration:none; font-weight:bold; border-radius:2px; }
    .foot { background:#0A0A0A; padding:18px 20px; text-align:center; border-top:1px solid #222; color:#555; font-size:11px; letter-spacing:2px; text-transform:uppercase; }
    a { color:#C9A84C; }
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <div class="brand">Rosalia Group</div>
      <div class="diamond">&#9670;</div>
    </div>
    <div class="body">
      <h1>${headline}</h1>
      ${bodyHtml}
    </div>
    <div class="foot">Rosalia Group &nbsp;|&nbsp; rosaliagroup.com</div>
  </div>
</body>
</html>`;
}

function successHtml(displayDate, displayTime, rescheduleUrl) {
  return page('Tour Confirmed', `
    <p>Tour confirmed — see you <strong style="color:#C9A84C;">${displayDate}</strong> at <strong style="color:#C9A84C;">${displayTime}</strong>.</p>
    <p class="muted" style="margin-bottom:20px;">Need to change your plans?</p>
    <p style="margin:0;"><a class="btn" href="${rescheduleUrl}">Need to Reschedule?</a></p>`);
}

function invalidHtml() {
  return page('Link Expired', `
    <p>This confirmation link has expired or is invalid.</p>
    <p class="muted" style="margin:0;">Please call us at <strong style="color:#C9A84C;">${SUPPORT_PHONE}</strong> and we'll confirm your tour.</p>`);
}

exports.handler = async (event) => {
  const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
  const invalid = () => ({ statusCode: 200, headers: htmlHeaders, body: invalidHtml() });

  const code = codeFromEvent(event);
  if (!code || !SUPABASE_KEY) {
    console.log('Confirm hit:', code || '(none)', 'UNKNOWN');
    return invalid();
  }

  // Case-insensitive exact match (ilike, no wildcards — code is hex-sanitized).
  let booking = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?short_code=ilike.${encodeURIComponent(code)}&select=id,preferred_date,preferred_time,type,property,property_address,confirmed_at&limit=1`,
      { headers: SB_H }
    );
    const rows = await r.json();
    booking = Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    console.error('confirm: lookup failed:', err.message);
  }

  if (!booking) {
    console.log('Confirm hit:', code, 'UNKNOWN');
    return invalid();
  }

  // Stamp confirmed_at once (idempotent). Already-confirmed -> same success page.
  if (!booking.confirmed_at) {
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking.id)}&confirmed_at=is.null`,
        {
          method: 'PATCH',
          headers: { ...SB_H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ confirmed_at: new Date().toISOString() }),
        }
      );
    } catch (err) {
      console.error('confirm: PATCH confirmed_at failed:', err.message);
    }
  }

  const propertyAddress = booking.type || booking.property_address || booking.property || 'your tour';
  const displayDate = formatDate(booking.preferred_date);
  const displayTime = booking.preferred_time || 'your scheduled time';
  const rescheduleUrl = `https://book.rosaliagroup.com/r/${code}`;

  console.log('Confirm hit:', code, booking.id);
  return { statusCode: 200, headers: htmlHeaders, body: successHtml(displayDate, displayTime, rescheduleUrl) };
};
