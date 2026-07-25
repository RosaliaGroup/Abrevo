'use strict';

// Eligible lead statuses for automated follow-up. Only leads actively being
// nurtured receive follow-ups; every other status — dnc (opted out), booked,
// applied, needs_specialist, and any unknown/future status — is excluded.
// Opt-out compliance: single source of truth for both the Supabase query filter
// and the in-loop defensive dnc guard in followup.js. Requires nothing external.

const ELIGIBLE_STATUSES = ['new', 'contacted'];

function isEligibleStatus(status) {
  return ELIGIBLE_STATUSES.includes(status);
}

// PostgREST filter fragment built from the whitelist: status=in.(new,contacted)
const ELIGIBLE_STATUS_FILTER = `status=in.(${ELIGIBLE_STATUSES.join(',')})`;

module.exports = { ELIGIBLE_STATUSES, isEligibleStatus, ELIGIBLE_STATUS_FILTER };
