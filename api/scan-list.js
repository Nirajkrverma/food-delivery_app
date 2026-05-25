export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
      return res.status(200).end();
  }

  if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ 
      error: 'GEMINI_API_KEY not configured',
      fallback: true 
    });
  }

  const { image, mimeType } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'Image data is required' });
  }

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiPayload = {
      contents: [{
        parts: [
          {
            text: `You are a shopping list reader for a grocery delivery app. Analyze this image which contains a handwritten or printed shopping list.

Extract EVERY item from the list. For each item return:
- "name": the item name (clean, lowercase, singular form e.g. "apple" not "apples")
- "quantity": the numeric quantity written (default to 1 if not specified)
- "unit": the unit of measurement (e.g. "kg", "g", "gm", "ml", "litre", "pc", "pieces", "packet"). Empty string if none.
- "raw": the original text as read from the image

Return ONLY a valid JSON array. No markdown, no explanation. Example:
[{"name":"apple","quantity":2,"unit":"kg","raw":"2 kg Fresh Apple"},{"name":"banana","quantity":5,"unit":"pcs","raw":"5 pcs Bananas"}]

If you cannot read the image or there are no items, return an empty array: []`
          },
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: image
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024
      }
    };

    let response;
    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload)
      });
      
      if (response.ok || response.status !== 503) {
        break;
      }
      
      console.warn(`Gemini API 503 (Attempt ${attempt}/3). Retrying...`);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      let errorReason = `Gemini API returned ${response.status}`;
      if (response.status === 429) {
          errorReason = 'Gemini API Quota Exceeded (429 Too Many Requests)';
      } else if (response.status === 503) {
          errorReason = 'Gemini API is currently overloaded (503). Please try again in a few moments.';
      }
      return res.status(502).json({ 
        error: errorReason,
        fallback: true 
      });
    }

    const data = await response.json();
    const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    let items = [];
    try {
      const jsonMatch = textContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        items = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      return res.status(200).json({ 
        items: [],
        rawText: textContent,
        error: 'Could not parse items from image' 
      });
    }

    const normalizedItems = items
      .filter(item => item && item.name)
      .map(item => ({
        name: String(item.name).trim().toLowerCase(),
        quantity: Math.max(parseFloat(item.quantity) || 1, 0.1),
        unit: item.unit ? String(item.unit).trim().toLowerCase() : '',
        raw: String(item.raw || item.name).trim()
      }));

    res.json({ 
      items: normalizedItems,
      rawText: textContent,
      source: 'gemini'
    });

  } catch (error) {
    console.error('Scan list error:', error.message);
    res.status(500).json({ 
      error: error.message,
      fallback: true 
    });
  }
}
