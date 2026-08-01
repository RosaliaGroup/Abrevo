// functions/lib/bookingTime.js
//
// Turn the free-text preferred_date / preferred_time on a booking into a real
// timestamp, so appointments can be sorted and placed on a calendar.
//
// The source text is whatever captured the booking — Vapi transcribing a caller,
// or a web form. Across 652 real bookings it looks like:
//     '2026-05-23'  / '1:00 PM'      the common case
//     'March 9'     / '4:00 PM'      no year
//     '2026-04-01'  / '16:00'        24-hour
//     'tomorrow'    / '12:30 PM'     relative — not recoverable later
//     'Tuesday'     / '5:00 PM'      weekday only — not recoverable later
//
// Relative forms are deliberately NOT guessed. 'Tuesday' recorded three months
// ago could be any of a dozen dates, and a wrong appointment time on a calendar
// is worse than a blank one: it sends someone to an empty building.
//
// Times are interpreted as America/New_York, which is where every property is.

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Eastern offset in hours for a given date — EDT (-4) or EST (-5). */
function easternOffset(y, m, d) {
  // US DST: second Sunday in March to first Sunday in November.
  const secondSunMarch = (() => {
    const first = new Date(Date.UTC(y, 2, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7;
  })();
  const firstSunNov = (() => {
    const first = new Date(Date.UTC(y, 10, 1)).getUTCDay();
    return 1 + ((7 - first) % 7);
  })();
  if (m > 3 && m < 11) return 4;
  if (m === 3) return d >= secondSunMarch ? 4 : 5;
  if (m === 11) return d < firstSunNov ? 4 : 5;
  return 5;
}

function parseDatePart(raw, fallbackYear) {
  const s = String(raw || '').trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };

  // 'March 9 2026', 'March 9, 2026', 'March 9'
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const y = m[3] ? +m[3] : fallbackYear;
    if (!y) return null;
    return { y, m: MONTHS[m[1].toLowerCase()], d: +m[2] };
  }

  // '9 March 2026'
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+),?\s*(\d{4})?$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3] ? +m[3] : fallbackYear;
    if (!y) return null;
    return { y, m: MONTHS[m[2].toLowerCase()], d: +m[1] };
  }

  // 'tomorrow', 'Tuesday', 'next week' — not recoverable after the fact.
  return null;
}

function parseTimePart(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?\.?$/);
  if (m) {
    let h = +m[1];
    const mi = +(m[2] || 0);
    if (h < 1 || h > 12 || mi > 59) return null;
    const pm = m[3].toLowerCase() === 'p';
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return { h, mi };
  }

  m = s.match(/^(\d{1,2}):(\d{2})$/); // 24-hour
  if (m) {
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return { h, mi };
  }
  return null;
}

/**
 * @param {string} dateText  e.g. '2026-05-23' or 'March 9 2026'
 * @param {string} timeText  e.g. '1:00 PM' or '13:00'
 * @param {string} [createdAt] the booking's created_at, used to fill a missing year
 * @returns {string|null} ISO timestamp, or null when the text can't be trusted
 */
function parseBookingStart(dateText, timeText, createdAt) {
  const fallbackYear = createdAt ? Number(String(createdAt).slice(0, 4)) : null;
  const d = parseDatePart(dateText, fallbackYear);
  const t = parseTimePart(timeText);
  if (!d || !t) return null;
  if (d.m < 1 || d.m > 12 || d.d < 1 || d.d > 31) return null;

  const off = easternOffset(d.y, d.m, d.d);
  const ms = Date.UTC(d.y, d.m - 1, d.d, t.h + off, t.mi, 0);
  const out = new Date(ms);
  if (isNaN(out.getTime())) return null;
  // Reject a rolled-over date (e.g. 31 February becoming 3 March).
  if (out.getUTCMonth() + 1 !== d.m && out.getUTCDate() !== d.d) return null;
  return out.toISOString();
}

module.exports = { parseBookingStart };
