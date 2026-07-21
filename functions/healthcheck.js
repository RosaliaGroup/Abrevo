// ============================================================================
// healthcheck.js  —  Netlify SCHEDULED function (wrapper) [v3]
// ----------------------------------------------------------------------------
// Stays configured as a scheduled function in netlify.toml (0 * * * *).
// Scheduled functions are NOT URL-invocable in production, so no auth guard is
// applied here. Accepts NO user-controlled parameters. Runs the real job.
// Manual/dashboard runs go through admin-healthcheck-run.js instead.
// ============================================================================

const { runHealthcheck } = require('./_healthcheck-worker');

exports.handler = async () => {
  const result = await runHealthcheck({ dryRun: false });
  return { statusCode: 200, body: JSON.stringify({ ok: result.ok, status: result.status }) };
};
