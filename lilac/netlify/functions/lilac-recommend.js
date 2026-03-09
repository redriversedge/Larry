// ============================================================
// LILAC - Recipe Recommendation Netlify Function
// Uses Claude to suggest recipes based on taste profile
// ============================================================
const https = require('https');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const { profile, count } = JSON.parse(event.body);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Add it in Netlify site settings.' })
      };
    }

    const numSuggestions = count || 5;

    let profileSummary = 'User taste profile:\n';
    if (profile.totalRecipes) profileSummary += '- Total saved recipes: ' + profile.totalRecipes + '\n';
    if (profile.topCuisines && profile.topCuisines.length > 0) {
      profileSummary += '- Favorite cuisines: ' + profile.topCuisines.join(', ') + '\n';
      profileSummary += '- Cuisine breakdown: ' + JSON.stringify(profile.cuisineCounts) + '\n';
    }
    if (profile.topIngredients && profile.topIngredients.length > 0) {
      profileSummary += '- Commonly used ingredients: ' + profile.topIngredients.join(', ') + '\n';
    }
    if (profile.avgPrepTime) profileSummary += '- Average prep time: ' + profile.avgPrepTime + ' minutes\n';
    if (profile.mealTypeCounts) profileSummary += '- Meal type preferences: ' + JSON.stringify(profile.mealTypeCounts) + '\n';
    if (profile.dietaryCounts && Object.keys(profile.dietaryCounts).length > 0) {
      profileSummary += '- Dietary preferences: ' + JSON.stringify(profile.dietaryCounts) + '\n';
    }

    const prompt = `You are a recipe recommendation engine. Based on the user's taste profile, suggest ${numSuggestions} recipes they would enjoy.

${profileSummary}

Suggest recipes that:
1. Match their cuisine preferences but also introduce variety
2. Use ingredients they commonly cook with
3. Match their typical prep time range
4. Include a mix of familiar and slightly adventurous options
5. Are real, well-known recipes (not made up)

Return ONLY valid JSON in this exact format:
{
  "suggestions": [
    {
      "title": "Recipe Name",
      "description": "Brief appetizing description",
      "cuisine": "Cuisine type",
      "mealType": "dinner/lunch/breakfast/etc",
      "prepTime": 30,
      "cookTime": 20,
      "difficulty": "easy/intermediate/advanced",
      "servings": "4",
      "ingredients": ["ingredient 1", "ingredient 2", "..."],
      "instructions": ["Step 1...", "Step 2...", "..."],
      "whyYoullLikeIt": "Brief reason why this matches their taste",
      "dietary": ["any applicable dietary tags"],
      "tags": ["relevant tags"]
    }
  ]
}`;

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const data = await callClaude(apiKey, payload);
    const parsed = JSON.parse(data);

    let responseText = '';
    if (parsed.content) {
      parsed.content.forEach(function(block) {
        if (block.type === 'text') responseText += block.text;
      });
    }

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(result) };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ suggestions: [], error: 'Could not generate recommendations' })
    };

  } catch (error) {
    console.error('Recommendation error:', error.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to get recommendations: ' + error.message })
    };
  }
};

function callClaude(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com', port: 443,
      path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error('Claude API returned ' + res.statusCode));
        } else { resolve(body); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Claude API timed out')); });
    req.write(payload);
    req.end();
  });
}
