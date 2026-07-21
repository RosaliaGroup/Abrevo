// NEGATIVE FIXTURE — intentionally "leaky" file used to prove scan-secrets.sh
// catches embedded secrets. NONE of these are real credentials (all FAKE).
// Lives under validation/gate-a/fixtures/ so real scans (which exclude that
// path) never trip on it; only selftest.sh points the scanner here.

// (1) service_role Supabase JWT literal (FAKE) — must be HARD FAIL.
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJyZWYiOiJGQUtFRkFLRUZBS0UifQ.FAKE_signature_not_a_real_key_000000';

// (2) anon Supabase JWT literal (FAKE) — public-by-design → WARN, NOT a fail.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwicmVmIjoiRkFLRUZBS0VGQUtFIn0.FAKE_signature_not_a_real_key_000000';

// (3) Google service-account private key (FAKE) — must be HARD FAIL.
const creds = {
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIFAKEfakeFAKEfakeNOTAREALKEY0000000000000000000000000000000000\n-----END PRIVATE KEY-----\n',
};

// (4) Gmail app password literal (FAKE) — must be HARD FAIL.
const GMAIL_PASS = 'abcd efgh ijkl mnop';

// (5) Textbelt send-key embedded in a URL (FAKE) — must be HARD FAIL.
const quota = 'https://textbelt.com/quota/FAKEtextbeltKEY0000';

// SAFE reference (must NOT be flagged): sourced from env, not a literal.
const realKeyFromEnv = process.env.SUPABASE_SERVICE_ROLE;

module.exports = { SUPABASE_SERVICE_ROLE, SUPABASE_ANON_KEY, creds, GMAIL_PASS, quota, realKeyFromEnv };
