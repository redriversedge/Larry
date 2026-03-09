// ============================================================
// LILAC - Parse Recipe Netlify Function
// Fetches a URL, extracts recipe data via JSON-LD or AI fallback
// ============================================================
const https = require('https');
const http = require('http');

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
    const { url } = JSON.parse(event.body);
    if (!url) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'URL required' }) };
    }

    // Fetch the page HTML
    const html = await fetchUrl(url);

    // Try JSON-LD extraction first
    const jsonLdRecipe = extractJsonLd(html);
    if (jsonLdRecipe) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(normalizeRecipe(jsonLdRecipe, url))
      };
    }

    // Fallback to AI extraction
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Could not auto-detect recipe data and AI extraction is not configured. Please enter details manually.'
        })
      };
    }

    const aiRecipe = await extractWithAI(apiKey, html, url);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(aiRecipe)
    };

  } catch (error) {
    console.error('Parse recipe error:', error.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to parse recipe: ' + error.message })
    };
  }
};

// --- Fetch URL content ---
function fetchUrl(url, redirectCount) {
  redirectCount = redirectCount || 0;
  if (redirectCount > 5) return Promise.reject(new Error('Too many redirects'));

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LilacBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    };

    const req = protocol.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          const u = new URL(url);
          redirectUrl = u.origin + redirectUrl;
        }
        resolve(fetchUrl(redirectUrl, redirectCount + 1));
        return;
      }

      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(body));
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// --- Extract JSON-LD recipe data ---
function extractJsonLd(html) {
  const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    try {
      let data = JSON.parse(match[1].trim());

      // Handle arrays
      if (Array.isArray(data)) {
        for (let item of data) {
          if (isRecipeType(item)) return item;
          if (item['@graph'] && Array.isArray(item['@graph'])) {
            for (let g of item['@graph']) {
              if (isRecipeType(g)) return g;
            }
          }
        }
      } else {
        if (isRecipeType(data)) return data;
        if (data['@graph'] && Array.isArray(data['@graph'])) {
          for (let g of data['@graph']) {
            if (isRecipeType(g)) return g;
          }
        }
      }
    } catch (e) {
      // Skip invalid JSON
    }
  }
  return null;
}

function isRecipeType(obj) {
  if (!obj) return false;
  const type = obj['@type'];
  if (typeof type === 'string') return type === 'Recipe';
  if (Array.isArray(type)) return type.includes('Recipe');
  return false;
}

// --- Normalize JSON-LD recipe to our format ---
function normalizeRecipe(ld, sourceUrl) {
  const recipe = {
    title: ld.name || '',
    description: ld.description || '',
    image: '',
    prepTime: parseDuration(ld.prepTime),
    cookTime: parseDuration(ld.cookTime),
    totalTime: parseDuration(ld.totalTime),
    servings: '',
    cuisine: '',
    mealType: '',
    difficulty: '',
    dietary: [],
    ingredients: [],
    instructions: [],
    tags: []
  };

  // Image
  if (ld.image) {
    if (typeof ld.image === 'string') recipe.image = ld.image;
    else if (Array.isArray(ld.image)) recipe.image = typeof ld.image[0] === 'string' ? ld.image[0] : (ld.image[0] && ld.image[0].url) || '';
    else if (ld.image.url) recipe.image = ld.image.url;
  }

  // Servings
  if (ld.recipeYield) {
    recipe.servings = Array.isArray(ld.recipeYield) ? ld.recipeYield[0] : String(ld.recipeYield);
  }

  // Cuisine
  if (ld.recipeCuisine) {
    recipe.cuisine = Array.isArray(ld.recipeCuisine) ? ld.recipeCuisine[0] : ld.recipeCuisine;
  }

  // Meal type / category
  if (ld.recipeCategory) {
    const cat = Array.isArray(ld.recipeCategory) ? ld.recipeCategory[0] : ld.recipeCategory;
    recipe.mealType = mapMealType(cat);
  }

  // Ingredients
  if (ld.recipeIngredient && Array.isArray(ld.recipeIngredient)) {
    recipe.ingredients = ld.recipeIngredient;
  }

  // Instructions
  if (ld.recipeInstructions) {
    if (typeof ld.recipeInstructions === 'string') {
      recipe.instructions = ld.recipeInstructions.split(/\n+/).filter(Boolean);
    } else if (Array.isArray(ld.recipeInstructions)) {
      recipe.instructions = ld.recipeInstructions.map(function(step) {
        if (typeof step === 'string') return step;
        if (step.text) return step.text;
        if (step['@type'] === 'HowToSection' && step.itemListElement) {
          return step.itemListElement.map(function(s) { return s.text || ''; }).join(' ');
        }
        return '';
      }).filter(Boolean);
    }
  }

  // Keywords/tags
  if (ld.keywords) {
    if (typeof ld.keywords === 'string') {
      recipe.tags = ld.keywords.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    } else if (Array.isArray(ld.keywords)) {
      recipe.tags = ld.keywords;
    }
  }

  // Dietary from suitableForDiet
  if (ld.suitableForDiet) {
    const diets = Array.isArray(ld.suitableForDiet) ? ld.suitableForDiet : [ld.suitableForDiet];
    diets.forEach(function(d) {
      const mapped = mapDietary(d);
      if (mapped) recipe.dietary.push(mapped);
    });
  }

  // Calculate total time if not set
  if (!recipe.totalTime && (recipe.prepTime || recipe.cookTime)) {
    recipe.totalTime = (recipe.prepTime || 0) + (recipe.cookTime || 0);
  }

  return recipe;
}

// --- Parse ISO 8601 duration to minutes ---
function parseDuration(str) {
  if (!str) return 0;
  const match = String(str).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return parseInt(str) || 0;
  return (parseInt(match[1] || 0) * 60) + parseInt(match[2] || 0) + Math.ceil(parseInt(match[3] || 0) / 60);
}

function mapMealType(category) {
  if (!category) return '';
  const lower = category.toLowerCase();
  const map = {
    'breakfast': 'breakfast', 'brunch': 'brunch', 'lunch': 'lunch',
    'dinner': 'dinner', 'supper': 'dinner', 'main course': 'dinner',
    'main dish': 'dinner', 'entree': 'dinner', 'snack': 'snack',
    'dessert': 'dessert', 'appetizer': 'appetizer', 'starter': 'appetizer',
    'side dish': 'side', 'side': 'side', 'drink': 'drink', 'beverage': 'drink',
    'cocktail': 'drink', 'smoothie': 'drink'
  };
  for (const key in map) {
    if (lower.includes(key)) return map[key];
  }
  return '';
}

function mapDietary(diet) {
  if (!diet) return null;
  const lower = String(diet).toLowerCase();
  if (lower.includes('vegetarian')) return 'vegetarian';
  if (lower.includes('vegan')) return 'vegan';
  if (lower.includes('gluten')) return 'gluten-free';
  if (lower.includes('dairy')) return 'dairy-free';
  if (lower.includes('keto')) return 'keto';
  if (lower.includes('paleo')) return 'paleo';
  return null;
}

// --- AI Extraction Fallback ---
async function extractWithAI(apiKey, html, url) {
  // Trim HTML to reduce token usage
  const trimmed = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 8000);

  const prompt = `Extract recipe data from this webpage content. Return ONLY valid JSON with these fields:
{
  "title": "recipe name",
  "description": "brief description",
  "image": "image URL if found",
  "prepTime": minutes as number,
  "cookTime": minutes as number,
  "totalTime": minutes as number,
  "servings": "serving size",
  "cuisine": "cuisine type",
  "mealType": "one of: breakfast, brunch, lunch, dinner, snack, dessert, appetizer, side, drink",
  "difficulty": "one of: easy, intermediate, advanced",
  "dietary": ["array of: vegetarian, vegan, gluten-free, dairy-free, keto, paleo, nut-free, low-carb"],
  "ingredients": ["array of ingredient strings"],
  "instructions": ["array of instruction steps"],
  "tags": ["array of tags"]
}

Webpage content from ${url}:
${trimmed}`;

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
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
    return JSON.parse(jsonMatch[0]);
  }

  return { error: 'Could not extract recipe data' };
}

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
