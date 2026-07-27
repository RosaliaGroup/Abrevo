// functions/confirm.js
// One-tap tour confirmation: GET /confirm?id=<booking_id>&t=<token>
// Token = b64url(HMAC-SHA256(booking.id, CONFIRM_SECRET)) truncated to 16 chars
// (auth.confirmToken). Verified with a constant-time compare — never a plain ===.

const auth = require('./lib/auth');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CONFIRM_SECRET = process.env.CONFIRM_SECRET;
const SUPPORT_PHONE = '(862) 419-1763';

const SB_H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

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

// Dark/gold shell matching the reminder email styling.
function page(headline, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rosalia Group</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'Georgia',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#111111;border:1px solid #C9A84C;border-radius:4px;overflow:hidden;">
        <tr>
          <td style="background:#0A0A0A;padding:30px 40px;text-align:center;border-bottom:1px solid #C9A84C;">
            <div style="color:#C9A84C;font-size:11px;letter-spacing:4px;text-transform:uppercase;">Rosalia Group</div>
            <div style="color:#C9A84C;font-size:18px;margin-top:6px;">&#9670;</div>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="color:#C9A84C;font-size:22px;font-weight:normal;letter-spacing:2px;text-transform:uppercase;margin:0 0 24px 0;">${headline}</h1>
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="background:#0A0A0A;padding:20px 40px;text-align:center;border-top:1px solid #222;">
            <div style="color:#555;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Rosalia Group &nbsp;|&nbsp; rosaliagroup.com</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function successHtml(displayDate, displayTime, rescheduleUrl) {
  const body = `
    <p style="color:#E8E8E8;font-size:16px;line-height:1.7;margin:0 0 24px 0;">Tour confirmed — see you <strong style="color:#C9A84C;">${displayDate}</strong> at <strong style="color:#C9A84C;">${displayTime}</strong>.</p>
    <p style="color:#999;font-size:14px;line-height:1.7;margin:0 0 8px 0;">Need to reschedule?
      <a href="${rescheduleUrl}" style="color:#C9A84C;text-decoration:underline;">Pick a new time</a>.</p>`;
  return page('Tour Confirmed', body);
}

function invalidHtml() {
  const body = `
    <p style="color:#E8E8E8;font-size:15px;line-height:1.7;margin:0 0 16px 0;">This confirmation link has expired or is invalid.</p>
    <p style="color:#999;font-size:14px;line-height:1.7;margin:0;">Please call us at <strong style="color:#C9A84C;">${SUPPORT_PHONE}</strong> and we'll confirm your tour.</p>`;
  return page('Link Expired', body);
}

exports.handler = async (event) => {
  const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
  const invalid = () => ({ statusCode: 200, headers: htmlHeaders, body: invalidHtml() });

  const qs = (event && event.queryStringParameters) || {};
  const id = qs.id;
  const token = qs.t;

  // Missing inputs / config, or bad token -> generic invalid page.
  // Never reveal whether the booking id exists.
  if (!id || !token || !CONFIRM_SECRET || !SUPABASE_KEY) return invalid();
  const expected = auth.confirmToken(id, CONFIRM_SECRET);
  if (!auth.timingEqualStr(token, expected)) return invalid();

  // Token is valid — look up the booking to render date/time and confirm it.
  let booking = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(id)}&select=id,full_name,preferred_date,preferred_time,type,property,property_address,confirmed_at&limit=1`,
      { headers: SB_H }
    );
    const rows = await r.json();
    booking = Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    console.error('confirm: booking lookup failed:', err.message);
  }
  if (!booking) return invalid();

  // Stamp confirmed_at once. Idempotent: filter on is.null so a second tap
  // never overwrites the original confirmation time. Already confirmed -> success page.
  if (!booking.confirmed_at) {
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(id)}&confirmed_at=is.null`,
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
  const rescheduleUrl = isIron65(propertyAddress)
    ? 'https://book.rosaliagroup.com/iron65-reschedule'
    : 'https://book.rosaliagroup.com/reschedule';

  console.log('Confirm', booking.id, booking.confirmed_at ? 'already-confirmed' : 'confirmed-now');
  return { statusCode: 200, headers: htmlHeaders, body: successHtml(displayDate, displayTime, rescheduleUrl) };
};
