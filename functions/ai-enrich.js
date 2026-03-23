exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { name, email, phone } = JSON.parse(event.body || '{}');
  if (!name) return { statusCode: 400, headers, body: JSON.stringify({ error: 'name required' }) };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for the social media profiles and web presence of this person. Name: "${name}", Email: "${email || 'unknown'}", Phone: "${phone || 'unknown'}". Find their LinkedIn URL, Facebook profile URL, Instagram handle, and any notable web mentions. Return as JSON with fields: linkedin, facebook, instagram, web_mentions (array of strings), confidence (low/medium/high).`
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('');

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { linkedin: null, facebook: null, instagram: null, web_mentions: [], confidence: 'low' };
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ linkedin: null, facebook: null, instagram: null, web_mentions: [text], confidence: 'low' }) };
  }
};
