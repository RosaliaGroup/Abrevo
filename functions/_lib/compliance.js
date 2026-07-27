'use strict';
/**
 * SMS compliance keyword handling (STOP / START / HELP).
 *
 * Classification is text-based on the inbound message body and must NOT depend
 * on any UI state. The webhook processor applies the resulting action to
 * conversation opt-out state BEFORE any later outbound send is allowed.
 *
 * Standard carrier keyword sets (case-insensitive, trimmed, first token):
 *   STOP:  STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT
 *   START: START, YES, UNSTOP
 *   HELP:  HELP, INFO
 */

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);
const HELP_WORDS = new Set(['HELP', 'INFO']);

// Approved responses. Auto-sending is gated by the webhook processor (disabled
// by default; never sent during tests). Kept here so the copy is reviewable.
const REPLIES = {
  stop: 'You have been unsubscribed and will receive no further messages. Reply START to opt back in.',
  help: 'Rosalia Group. For help call (862) 419-1814 or email inquiries@rosaliagroup.com. Reply STOP to unsubscribe.',
  start: 'You are re-subscribed to messages from Rosalia Group. Reply STOP to unsubscribe.',
};

/**
 * @param {string} body
 * @returns {'stop'|'start'|'help'|null}
 */
function classifyKeyword(body) {
  if (!body) return null;
  const first = String(body).trim().toUpperCase().split(/\s+/)[0] || '';
  if (STOP_WORDS.has(first)) return 'stop';
  if (START_WORDS.has(first)) return 'start';
  if (HELP_WORDS.has(first)) return 'help';
  return null;
}

module.exports = { classifyKeyword, REPLIES, STOP_WORDS, START_WORDS, HELP_WORDS };
