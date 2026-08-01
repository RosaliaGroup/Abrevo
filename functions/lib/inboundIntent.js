// functions/lib/inboundIntent.js
//
// Notice when an inbound text is asking to change an appointment, and reply with
// the reschedule link.
//
// WHY THIS EXISTS
// A lead texted "Can we reschedule to 3:30PM?" and nothing read it. Inbound
// messages were stored and shown in the CRM, but no automation answered them, so
// a direct question sat unanswered until someone happened to look. That lead
// then clicked the reminder's reschedule link, found only hourly slots, and took
// 3:00 instead of the 3:30 he asked for.
//
// DELIBERATELY NOT AUTO-RESCHEDULING
// This sends the link. It does NOT parse "3:30PM" and move the appointment,
// because a misread time means someone arrives at an empty building — and the
// booking form is the only place that knows which slots are actually available.
// The lead picks; the system never guesses on their behalf.

const RESCHEDULE_PATTERNS = [
  /\breschedul/i,
  /\bmove (?:my |the )?(?:appointment|tour|showing|time)/i,
  /\bchange (?:my |the )?(?:appointment|tour|showing|time|date)/i,
  /\b(?:different|another) (?:time|day|date)\b/i,
  /\bcan (?:we|i|you) (?:do|make it|come)\b.{0,24}\b(?:instead|different)\b/i,
  /\bpush (?:it |my |the )?(?:back|to)\b/i,
  /\bearlier or later\b/i,
];

// "Can we do 3:30?" / "how about Tuesday" — a proposed time is a reschedule ask
// even without the word itself.
const PROPOSES_TIME = /\b(?:can we|could we|how about|what about|is)\b.{0,20}\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i;

const CANCEL_PATTERNS = [
  /\bcancel\b/i,
  /\bcan'?t (?:make|come|attend)\b/i,
  /\bnot (?:going to|gonna) (?:make|be able)\b/i,
];

/**
 * @param {string} text inbound message body
 * @returns {'reschedule'|'cancel'|null}
 */
function detectIntent(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 300) return null;   // long messages are conversation, not a command

  // Cancel is checked first: "cancel and reschedule" should be treated as a
  // cancellation, which needs a person rather than a link.
  if (CANCEL_PATTERNS.some((re) => re.test(t))) return 'cancel';
  if (RESCHEDULE_PATTERNS.some((re) => re.test(t))) return 'reschedule';
  if (PROPOSES_TIME.test(t)) return 'reschedule';
  return null;
}

/**
 * The reply to send. Deliberately does not confirm anything — it hands back the
 * link so the lead chooses from real availability.
 */
function intentReply(intent, firstName, shortCode, isIron65) {
  const who = firstName ? `Hi ${firstName}! ` : '';
  if (intent === 'reschedule') {
    const link = shortCode
      ? `book.rosaliagroup.com/r/${shortCode}`
      : (isIron65 ? 'book.rosaliagroup.com/iron65-reschedule' : 'book.rosaliagroup.com/reschedule');
    return `${who}No problem — pick a new time here: ${link}\nYour current time stays booked until you choose a new one.`;
  }
  if (intent === 'cancel') {
    // A cancellation is a person's decision to walk away; a link is the wrong
    // response, so this routes to a human.
    return `${who}Sorry to hear that — someone from our team will call you shortly to sort this out. Or reach us at (862) 333-1681.`;
  }
  return null;
}

module.exports = { detectIntent, intentReply };
