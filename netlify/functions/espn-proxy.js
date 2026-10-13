// netlify/functions/espn-proxy.js
// Proxies requests to ESPN Fantasy API with auth cookies
const https = require('https');

// The only season-scoped views this proxy will fetch. Season endpoints need
// no cookies, so anything reachable here is reachable by anyone who finds
// the function URL; keep the list to exactly what the app uses.
const SEASON_VIEW_ALLOWLIST = ['proTeamSchedules_wl'];

function requestedViews(event) {
  const out = [];
  const mv = event.multiValueQueryStringParameters;
  if (mv && mv.view) {
    mv.view.forEach((v) => out.push(String(v)));
  } else if (event.queryStringParameters && event.queryStringParameters.view) {
    out.push(String(event.queryStringParameters.view));
  }
  return out;
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-espn-league-id, x-espn-s2, x-espn-swid, x-espn-season, x-espn-scope, x-fantasy-filter',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const leagueId = event.headers['x-espn-league-id'];
    const espnS2 = event.headers['x-espn-s2'];
    const swid = event.headers['x-espn-swid'];
    const rawSeason = event.headers['x-espn-season'];
    // Digits only, so a header cannot inject path segments.
    const season = /^\d{4}$/.test(String(rawSeason || '')) ? String(rawSeason) : '';
    if (!season) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or invalid x-espn-season' }) };
    }

    // Season-level mode: no league id, no cookies, for endpoints that are
    // public. Used for the NBA schedule (proTeamSchedules_wl), which the
    // league-scoped scoreboard view does not return.
    //
    // The view is checked against an allowlist. Without that this proxy
    // would be an open relay to any ESPN season endpoint, callable by
    // anyone who found the URL.
    const scope = event.headers['x-espn-scope'] || 'league';
    if (scope === 'season') {
      const views = requestedViews(event);
      if (!views.length || !views.every((v) => SEASON_VIEW_ALLOWLIST.indexOf(v) >= 0)) {
        return {
          statusCode: 400, headers,
          body: JSON.stringify({ error: 'view not permitted in season scope' }),
        };
      }
      const seasonUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}` +
        '?' + views.map((v) => 'view=' + encodeURIComponent(v)).join('&');
      const seasonData = await makeRequest(seasonUrl, {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      });
      return { statusCode: 200, headers, body: seasonData };
    }

    if (!leagueId || !espnS2 || !swid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing ESPN credentials' }) };
    }

    const baseUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}/segments/0/leagues/${leagueId}`;

    let queryString = '';
    if (event.rawQuery) {
      queryString = '?' + event.rawQuery;
    } else if (event.multiValueQueryStringParameters) {
      const parts = [];
      Object.entries(event.multiValueQueryStringParameters).forEach(([key, values]) => {
        values.forEach(val => parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(val)));
      });
      if (parts.length) queryString = '?' + parts.join('&');
    } else if (event.queryStringParameters) {
      queryString = '?' + new URLSearchParams(event.queryStringParameters).toString();
    }

    const fullUrl = baseUrl + queryString;
    const espnHeaders = {
      'Cookie': `espn_s2=${espnS2}; SWID=${swid}`,
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    };

    if (event.headers['x-fantasy-filter']) {
      espnHeaders['x-fantasy-filter'] = event.headers['x-fantasy-filter'];
    }

    const data = await makeRequest(fullUrl, espnHeaders);
    return { statusCode: 200, headers, body: data };

  } catch (error) {
    console.error('ESPN proxy error:', error.message);
    return { statusCode: error.statusCode || 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

function makeRequest(url, reqHeaders) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname, port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET', headers: reqHeaders
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const err = new Error('ESPN returned ' + res.statusCode);
          err.statusCode = res.statusCode;
          reject(err);
        } else { resolve(body); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('ESPN request timed out')); });
    req.end();
  });
}
