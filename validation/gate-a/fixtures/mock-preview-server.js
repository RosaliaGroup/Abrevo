#!/usr/bin/env node
/* ===========================================================================
 * mock-preview-server.js — deterministic stand-in for a Netlify preview.
 * ---------------------------------------------------------------------------
 * Lets validate-gate-a.sh be exercised end-to-end with ZERO real infrastructure
 * and zero side effects. Two scenarios:
 *
 *   MODE=good  — a correctly Gate-A-hardened deploy (everything should PASS)
 *   MODE=bad   — a deploy with the exact defects the validator must catch:
 *                * admin dashboard served anonymously WITH a service_role JWT
 *                * admin function answering 405 to unauth (405-as-auth trap)
 *                * internal endpoint returning 200 to no-token POST
 *                * removed function still 200
 *                * healthcheck mapping scheduler "unknown" -> healthy:true,
 *                  leaking a raw provider error + a service_role key
 *
 * Usage:  node mock-preview-server.js <port> <good|bad>
 * Reads nothing, writes nothing, listens on 127.0.0.1 only.
 * ===========================================================================*/
const http = require('http');
const PORT = parseInt(process.argv[2] || '8791', 10);
const MODE = (process.argv[3] || 'good').toLowerCase();

// A syntactically-valid but FAKE service_role JWT (header.payload.sig). The
// payload decodes to {"role":"service_role"} so the validator's role decoder
// classifies it correctly. This is NOT a real credential.
const FAKE_HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const FAKE_PAYLOAD = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase', ref: 'FAKEFAKEFAKE' })).toString('base64url');
const FAKE_SERVICE_JWT = `${FAKE_HEADER}.${FAKE_PAYLOAD}.FAKE_signature_not_real_00000000000000`;

const CLEAN_DASH = `<!doctype html><title>Login</title><body><form>Sign in to continue</form></body>`;
const LEAKY_DASH = `<!doctype html><title>Rosalia Admin Dashboard</title><script>
  const SUPABASE_KEY = "${FAKE_SERVICE_JWT}";
  function monFetchSupabase(){ /* embedded admin client */ }
</script>`;

const PUBLIC_PAGE = `<!doctype html><title>Booking</title><body>Book an appointment</body>`;

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'text/html' }, headers || {}));
  res.end(body || '');
}
function json(res, code, obj, headers) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const m = req.method;
  const fn = url.startsWith('/.netlify/functions/') ? url.slice('/.netlify/functions/'.length) : null;

  // ---------- admin dashboards ----------
  const adminPages = ['/rosalia.html', '/crm.html', '/social.html', '/mechanical.html'];
  if (adminPages.includes(url)) {
    if (MODE === 'good') return send(res, 401, CLEAN_DASH, { 'WWW-Authenticate': 'Basic realm="Rosalia Admin (Gate A)"' });
    // bad: anonymously serves the real dashboard WITH a service_role key
    return send(res, 200, LEAKY_DASH);
  }
  // bare aliases
  if (['/rosalia', '/crm', '/social', '/mechanical'].includes(url)) {
    if (MODE === 'good') return send(res, 401, CLEAN_DASH, { 'WWW-Authenticate': 'Basic realm="Gate A"' });
    return send(res, 200, LEAKY_DASH);
  }

  // ---------- public pages ----------
  if (['/index.html', '/booking-rosalia.html', '/booking-form.html', '/reschedule-rosalia.html', '/cancel-reschedule.html'].includes(url)) {
    return send(res, 200, PUBLIC_PAGE);
  }

  // ---------- functions ----------
  if (fn) {
    const priv = ['inventory', 'ai-enrich', 'admin-healthcheck-run'];
    const internal = ['respondrosalia', 'hvac-outreach', 'sendemail', 'sendcallrecap'];
    const removed = ['sms-campaign-hvac', 'bulkemail'];
    const publicFns = ['book', 'get-availability', 'reschedule', 'cancel'];

    if (fn === 'admin-healthcheck-run') {
      if (m === 'OPTIONS') return send(res, 204, '');
      // auth: Basic admin:admin only
      const auth = req.headers['authorization'] || '';
      const okAuth = auth.startsWith('Basic ') && Buffer.from(auth.slice(6), 'base64').toString() === 'admin:admin';
      if (!okAuth) return json(res, 401, { error: 'Authentication required' });
      if (m !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });
      if (MODE === 'good') {
        return json(res, 200, {
          ok: true, effectiveDryRun: true,
          probes: { readmail_execution: 'unknown' },
          summary: 'dry-run; scheduler heartbeat unknown',
        });
      }
      // bad: unknown mapped to healthy + leaks raw provider error + a secret
      return json(res, 200, {
        ok: true, effectiveDryRun: false,
        probes: { readmail_execution: 'unknown', healthy: true },
        raw_error: 'Error: getaddrinfo ETIMEDOUT smtp.gmail.com\n    at Object.<anonymous>',
        embedded_key: FAKE_SERVICE_JWT,
      });
    }

    if (priv.includes(fn)) {
      if (MODE === 'good') return json(res, 401, { error: 'Authentication required' });
      // bad: 405 to unauth (the classic "405 is not auth" trap) + wildcard CORS
      return json(res, 405, { error: 'Method Not Allowed' }, { 'Access-Control-Allow-Origin': '*' });
    }

    if (internal.includes(fn)) {
      if (m === 'OPTIONS') return send(res, 204, '');
      const tok = req.headers['x-internal-token'];
      if (MODE === 'good') {
        // reject before ANY body parse / provider work
        if (!tok || tok !== 'THE_REAL_TOKEN_never_used_by_tests') return json(res, 401, { error: 'invalid internal token' });
        return json(res, 200, { ok: true });
      }
      // bad: 200 to a no-token POST (no guard)
      return json(res, 200, { ok: true, sent: true });
    }

    if (removed.includes(fn)) {
      if (MODE === 'good') return json(res, 404, { error: 'Not Found' });
      return json(res, 200, { ok: true }); // bad: still deployed
    }

    if (publicFns.includes(fn)) {
      // reachable, non-auth; GET returns 405 (POST-only) which still proves reachability
      if (m === 'GET') return json(res, 405, { error: 'Use POST' });
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Not Found' });
  }

  return send(res, 200, PUBLIC_PAGE); // SPA-ish fallback
});

// drain request bodies so sockets close cleanly (we don't need the content)
server.on('request', (req) => { req.on('data', () => {}); req.on('end', () => {}); });

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`mock-preview [${MODE}] on http://127.0.0.1:${PORT}\n`);
});
