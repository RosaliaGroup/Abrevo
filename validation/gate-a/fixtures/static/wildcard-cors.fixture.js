// NEGATIVE FIXTURE — a privileged-style function that IS gated but still emits
// wildcard CORS. Proves the wildcard-CORS detector (GATEA_WILDCARD_CORS_RE)
// fires. Not wired into the app.
const { requireGateA } = require('./_gate-a-auth');

exports.handler = async (event) => {
  const gate = requireGateA(event);
  if (!gate.ok) return gate.response;
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',            // <-- wildcard on a privileged endpoint (BAD)
    },
    body: JSON.stringify({ ok: true }),
  };
};
