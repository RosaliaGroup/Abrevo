const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const PROPERTIES = {
  '422-faitoute-ave': {
    address: '422 Faitoute Ave, Roselle Park, NJ 07204',
    bedrooms: 3,
    bathrooms: 1.5,
    style: 'Renovated colonial',
    price: 'Under $500,000 — contact agent for exact price',
    features: [
      'Hardwood floors throughout',
      'Updated kitchen with stainless steel appliances and pantry',
      'Full basement',
      'Enclosed front porch',
      'Large fenced backyard with deck and garden area',
      'Walking distance to NJ Transit and downtown Roselle Park',
      '1.5 bathrooms',
    ],
    openHouses: [
      'Saturday May 16, 1:00-4:00 PM — with Daiane Santos & Mara Branco',
      'Sunday May 17, 12:00-3:00 PM — with Victoria DoSantos',
    ],
    neighborhood: 'Roselle Park — commuter-friendly, near NJ Transit Raritan Valley Line (direct to Penn Station NYC), tree-lined streets, local shops, close to Garden State Parkway',
    broker: 'Grisela Flores, FloroStone Realty, grisela@florostone.com, Office: (908) 445-5339',
    listedBy: 'FloroStone Realty',
    tourUrl: '/tour/422-faitoute-ave',
  },
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  if (!ANTHROPIC_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const { message, propertyId, history } = JSON.parse(event.body || '{}');

    if (!message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing message' }) };
    }

    const property = PROPERTIES[propertyId];
    if (!property) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown property' }) };
    }

    const systemPrompt = `You are a friendly, knowledgeable AI assistant for a real estate listing. You answer questions about this property and gently guide visitors toward scheduling a private tour.

PROPERTY DETAILS:
- Address: ${property.address}
- ${property.bedrooms} Bedrooms, ${property.bathrooms} Bathrooms
- Style: ${property.style}
- Price: ${property.price}
- Features: ${property.features.join('; ')}
- Open Houses: ${property.openHouses.join(' | ')}
- Neighborhood: ${property.neighborhood}
- Listed by: ${property.listedBy}
- Broker: ${property.broker}

RULES:
1. Be warm, helpful, and concise (2-3 sentences max per reply).
2. Answer factual questions accurately from the details above.
3. If you don't know something specific (exact sq ft, exact price, HOA, taxes), say "I'd recommend checking with Grisela at FloroStone Realty for that detail" and suggest scheduling a tour.
4. Naturally push toward booking a private tour: "${property.tourUrl}"
5. If someone shares their phone or email, acknowledge it and say the team will reach out.
6. Never invent facts not in the property details above.
7. Keep the tone like a helpful neighbor, not a pushy salesperson.`;

    // Build messages from history
    const messages = [];
    if (history && history.length > 0) {
      history.slice(-8).forEach(h => {
        if (h.role === 'user' || h.role === 'assistant') {
          messages.push({ role: h.role, content: h.content });
        }
      });
    }
    // Ensure last message is the current user message
    if (messages.length === 0 || messages[messages.length - 1].content !== message) {
      messages.push({ role: 'user', content: message });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 300,
        system: systemPrompt,
        messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic API error:', res.status, errText);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI service error' }) };
    }

    const data = await res.json();
    const reply = data.content?.[0]?.text || 'Sorry, I had trouble with that. Try asking another way?';

    // Detect suggested action
    let suggestedAction = null;
    if (/tour|schedule|visit|see it|come by/i.test(reply)) {
      suggestedAction = 'schedule_tour';
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply, suggestedAction }),
    };

  } catch (err) {
    console.error('listing-chat error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
