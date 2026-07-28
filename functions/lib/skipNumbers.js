// functions/lib/skipNumbers.js
// Shared never-call / never-text list: our own business, callback, and Telnyx
// sender lines. Any lead holding one of these (e.g. a contact saved with our
// support number) must never be dialed or texted by autocall / missedcalls.

const { toE164 } = require('./sms');

const ANA_PHONE = '+16462269189';

const SKIP_NUMBERS = new Set([
  ANA_PHONE,                                                   // Ana's cell
  toE164(process.env.TELNYX_FROM_ROSALIA) || '+12014269354',  // Rosalia Telnyx sender
  '+15512499795', // Rosalia Group line (551) 249-9795
  '+18623331681', // Iron 65 line (862) 333-1681
  '+16404009681', // Rosalia account business line (toNumber)
].filter(Boolean));

// Accepts any format; normalizes to E.164 before comparing.
function isSkipNumber(raw) {
  const e = toE164(raw);
  return !!e && SKIP_NUMBERS.has(e);
}

module.exports = { SKIP_NUMBERS, isSkipNumber, ANA_PHONE };
