// netlify/functions/espn-proxy.js
// Proxies requests to ESPN Fantasy API with auth cookies
// Handles CORS so the browser can access ESPN data

const https = require('https');

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-espn-league-id, x-espn-s2, x-espn-swid, x-espn-season, x-fantasy-filter',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const leagueId = event.headers['x-espn-league-id'];
    const espnS2 = event.headers['x-espn-s2'];
    const swid = event.headers['x-espn-swid'];
    const season = event.headers['x-espn-season'] || '2026';

    if (!leagueId || !espnS2 || !swid) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing ESPN credentials' })
      };
    }

    // Build ESPN API URL
    const baseUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}/segments/0/leagues/${leagueId}`;

    // CRITICAL: Use rawQuery to preserve multi-value params like view=mTeam&view=mRoster
    // event.queryStringParameters is a simple object that collapses duplicate keys
    let queryString = '';
    if (event.rawQuery) {
      queryString = '?' + event.rawQuery;
    } else if (event.multiValueQueryStringParameters) {
      // Fallback: reconstruct from multi-value params
      const parts = [];
      Object.entries(event.multiValueQueryStringParameters).forEach(([key, values]) => {
        values.forEach(val => parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(val)));
      });
      if (parts.length) queryString = '?' + parts.join('&');
    } else if (event.queryStringParameters) {
      queryString = '?' + new URLSearchParams(event.queryStringParameters).toString();
    }

    const fullUrl = baseUrl + queryString;

    // Forward any x-fantasy-filter header
    const espnHeaders = {
      'Cookie': `espn_s2=${espnS2}; SWID=${swid}`,
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    };

    if (event.headers['x-fantasy-filter']) {
      espnHeaders['x-fantasy-filter'] = event.headers['x-fantasy-filter'];
    }

    // Make the request
    const data = await makeRequest(fullUrl, espnHeaders);

    return {
      statusCode: 200,
      headers,
      body: data
    };

  } catch (error) {
    console.error('ESPN proxy error:', error.message);
    return {
      statusCode: error.statusCode || 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function makeRequest(url, reqHeaders) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: reqHeaders
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const err = new Error(`ESPN returned ${res.statusCode}`);
          err.statusCode = res.statusCode;
          reject(err);
        } else {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('ESPN request timed out'));
    });
    req.end();
  });
}
