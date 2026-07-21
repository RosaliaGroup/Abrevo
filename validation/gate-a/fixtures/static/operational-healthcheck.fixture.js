// NEGATIVE FIXTURE — a healthcheck-style worker that probes OPERATIONAL function
// URLs. Proves the operational-URL detector (GATEA_OP_URL_RE) fires. Gate A
// intent: a healthcheck must not attempt operational function URLs. Not wired in.
const BASE_URL = 'https://abrevo.co/.netlify/functions';

async function probe() {
  // BAD: hitting live operational endpoints from the healthcheck
  await fetch(`${BASE_URL}/book`, { method: 'POST', body: '{}' });
  await fetch('https://abrevo.co/.netlify/functions/sendemail', { method: 'POST' });
  await fetch('/.netlify/functions/autocall');
}

module.exports = { probe };
