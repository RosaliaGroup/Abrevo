// functions/lib/googleCreds.js
// Google service-account credentials are stored in the Supabase `app_config`
// table (key/value) instead of Netlify env vars — the two JSON blobs were 4.8KB
// and blew past AWS Lambda's 4KB env limit, blocking every deploy.
//
// getGoogleCredentials(which) fetches the row, parses it, and caches it in a
// module-level variable so warm invocations don't re-fetch. If the fetch fails
// it falls back to the (legacy) env var, so nothing breaks during the transition.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Accepts short names ('google' / 'mechanical') or the full app_config row keys.
const SOURCES = {
  google: { row: 'google_credentials', env: 'GOOGLE_CREDENTIALS' },
  mechanical: { row: 'mechanical_google_credentials', env: 'MECHANICAL_GOOGLE_CREDENTIALS' },
};
SOURCES.google_credentials = SOURCES.google;
SOURCES.mechanical_google_credentials = SOURCES.mechanical;

const cache = {}; // which -> parsed credentials object

async function getGoogleCredentials(which = 'google') {
  const src = SOURCES[which] || SOURCES.google;
  if (cache[src.row]) return cache[src.row];

  // Primary source: app_config in Supabase.
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/app_config?key=eq.${encodeURIComponent(src.row)}&select=value&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (r.ok) {
      const rows = await r.json();
      const value = Array.isArray(rows) && rows[0] && rows[0].value;
      if (value) {
        const parsed = JSON.parse(value);
        cache[src.row] = parsed;
        return parsed;
      }
    } else {
      console.warn(`googleCreds: app_config lookup for ${src.row} returned HTTP ${r.status}`);
    }
  } catch (err) {
    console.error(`googleCreds: app_config fetch for ${src.row} failed, falling back to env:`, err.message);
  }

  // Fallback: legacy env var (kept working until the vars are removed).
  try {
    const parsed = JSON.parse(process.env[src.env] || '{}');
    cache[src.row] = parsed;
    return parsed;
  } catch (err) {
    console.error(`googleCreds: env fallback ${src.env} parse failed:`, err.message);
    return {};
  }
}

module.exports = { getGoogleCredentials };
