'use strict';

// Dependency-free reply-safety helpers shared by the production email flow
// (functions/readmail.js) and the plain-node check scripts under __checks__/.
// This module intentionally requires nothing external so it loads without
// node_modules present. Do NOT add imports of nodemailer/imap/mailparser here.

const FENCE_START = '<<<UNTRUSTED_LEAD_MESSAGE>>>';
const FENCE_END = '<<<END_UNTRUSTED_LEAD_MESSAGE>>>';

// Wrap lead-controlled text so the model treats it strictly as data, never as
// instructions. Any attempt by the lead to forge the fence markers inside their
// own message is neutralized so they cannot "close" the untrusted block early.
function fenceUntrusted(text) {
  const raw = text == null ? '' : String(text);
  const neutralized = raw
    .replace(/<<<\s*END_UNTRUSTED_LEAD_MESSAGE\s*>>>/gi, '[marker removed]')
    .replace(/<<<\s*UNTRUSTED_LEAD_MESSAGE\s*>>>/gi, '[marker removed]');
  return `${FENCE_START}\n${neutralized}\n${FENCE_END}`;
}

// Identity framing for the reply prompt. Deliberately does NOT impersonate a
// specific named human, and only discloses automation when a lead asks directly
// (never proactively). Kept as a builder so the check can import and assert it.
function buildIdentityLine() {
  return 'IDENTITY: You are writing on behalf of the Rosalia Group leasing team. '
    + 'Write like a busy, warm leasing coordinator: brief, personal, and helpful. '
    + 'Reply only with the email body, with no meta-commentary. '
    + 'Never claim to be a specific human individual. '
    + 'If directly asked whether the response is automated, say the inquiries team '
    + 'uses an automated assistant and that a leasing agent can follow up personally. '
    + 'Do not mention this unless directly asked.';
}

// Corrected booking-intent rule (prompt "Rule 0"). Broad words like "available",
// "interested", and "when" no longer force the link-only path — genuine
// questions get answered first, then the link is still included.
const BOOKING_INTENT_RULE =
  'BOOKING INTENT DETECTION: If the lead\'s message clearly asks to schedule, book, '
  + 'or come see the apartment (e.g. "book", "schedule", "set up a tour", "come in", '
  + '"ready to tour", "what times work", "make an appointment") — respond with ONE '
  + 'sentence confirming you are sending the link, then put the booking link on the '
  + 'next line. IMPORTANT: general words like "available", "interested", or "when" do '
  + 'NOT by themselves signal booking intent. If the lead is actually asking a question '
  + '(e.g. whether a unit is available, what the price is, when something is ready), '
  + 'ANSWER their question first in one sentence, then include the booking link. Only '
  + 'skip straight to the link when the message is purely a request to book.';

module.exports = {
  FENCE_START,
  FENCE_END,
  fenceUntrusted,
  buildIdentityLine,
  BOOKING_INTENT_RULE,
};
