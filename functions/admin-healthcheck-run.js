// ============================================================================
// admin-healthcheck-run.js  —  authenticated manual healthcheck [v3]
// ----------------------------------------------------------------------------
// Dashboard "Run Health Check" button target. Behind Gate A admin auth.
//   - requireGateA() runs BEFORE the body is parsed.
//   - Manual execution DEFAULTS to dryRun:true.
//   - A REAL write requires BOTH an authenticated request AND a server-side flag
//     (ALLOW_MANUAL_HEALTHCHECK_WRITE==='true'). A browser-supplied {dryRun:false}
//     alone can NOT cause a real write.
//   - Method restricted to POST (+ OPTIONS preflight handled by the guard).
//   - No wildcard CORS; uses adminCorsHeaders.
// ============================================================================

const { requireGateA, adminCorsHeaders } = require('./_gate-a-auth');
const { runHealthcheck } = require('./_healthcheck-worker');

exports.handler = async (event) => {
  // Auth first (also returns the harmless 204 for OPTIONS and 401/403 otherwise).
  const gate = requireGateA(event);
  if (!gate.ok) return gate.response;

  const headers = adminCorsHeaders(event);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Parse body only AFTER auth. Default dryRun:true.
  let requestedDryRun = true;
  try {
    const parsed = JSON.parse(event.body || '{}');
    if (parsed.dryRun === false) requestedDryRun = false;
  } catch { /* keep default dryRun:true */ }

  // A real write additionally requires a server-side flag. Without it, force dryRun.
  const serverAllowsWrite = process.env.ALLOW_MANUAL_HEALTHCHECK_WRITE === 'true';
  const effectiveDryRun = requestedDryRun || !serverAllowsWrite;

  const result = await runHealthcheck({ dryRun: effectiveDryRun });
  // Preserve the original scheduled healthcheck's FLAT response contract
  // ({ status, ...record }) that the dashboard consumes (data.book_ok, etc.).
  // The worker nests probe fields under result.record; flatten them back up.
  const { record, ...rest } = result;
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ...rest, ...(record || {}), effectiveDryRun })
  };
};
