// functions/lib/fubAccounts.js
// Single source of truth for the Follow Up Boss accounts we sync. Shared by
// fubsync.js (people) and any sibling puller (e.g. missed-call text-back) so a
// second per-account endpoint pull reuses the same account list + auth.
//
// Each entry: { label, key, auth }. `auth` is null when the key is unset -- the
// caller should skip that account with a logged warning rather than crash.

function fubAuth(key) {
  return key ? 'Basic ' + Buffer.from(key + ':').toString('base64') : null;
}

// Ordered account list. The first (FUB_API_KEY) is the original/default account;
// a missing ?acct= on the webhook falls back to its label.
function fubAccounts() {
  return [
    { label: 'iron65-acct', key: process.env.FUB_API_KEY },
    { label: 'rosalia-acct', key: process.env.FUB_API_KEY_ROSALIA },
  ].map(a => ({ label: a.label, key: a.key, auth: fubAuth(a.key) }));
}

const DEFAULT_ACCT_LABEL = 'iron65-acct';

module.exports = { fubAccounts, fubAuth, DEFAULT_ACCT_LABEL };
