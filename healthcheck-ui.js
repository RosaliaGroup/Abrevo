/**
 * Shared healthcheck UI helpers (Gate A).
 *
 * Loaded by the admin dashboard (rosalia.html) via <script src="/healthcheck-ui.js">
 * AND required by Node unit tests. Keep it dependency-free and side-effect-free so
 * the single source of truth is testable without a DOM.
 */
(function (root) {
  /**
   * Decide how to treat an admin-healthcheck-run HTTP response BEFORE parsing JSON.
   * Returns { kind, message } where kind is one of:
   *   'auth'        -> 401/403: not authorized
   *   'http_error'  -> any other non-2xx
   *   'bad_content' -> 2xx but not application/json
   *   'ok'          -> safe to parse JSON
   */
  function classifyHealthcheckResponse(status, contentType) {
    if (status === 401 || status === 403) {
      return { kind: 'auth', message: 'Not authorized. Please sign in to the operator dashboard and try again.' };
    }
    if (status < 200 || status >= 300) {
      return { kind: 'http_error', message: 'Health check failed (HTTP ' + status + ').' };
    }
    if (!/application\/json/i.test(String(contentType || ''))) {
      return { kind: 'bad_content', message: 'Health check returned an unexpected (non-JSON) response.' };
    }
    return { kind: 'ok', message: '' };
  }

  /** Human label for a scheduler execution state that is always "unknown" here. */
  function executionLabel(state) {
    return state === 'unknown' ? 'Unknown' : String(state || 'Unknown');
  }

  /** Human label for the informational business-activity freshness flag. */
  function activityLabel(fresh) {
    if (fresh === true) return 'Recent activity';
    if (fresh === false) return 'No recent activity';
    return 'Unknown';
  }

  var api = { classifyHealthcheckResponse: classifyHealthcheckResponse, executionLabel: executionLabel, activityLabel: activityLabel };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.HealthcheckUI = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
