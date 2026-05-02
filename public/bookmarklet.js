// Larry Link bookmarklet, source of truth.
//
// Run on any *.espn.com page. Reads the espn_s2 and SWID cookies via
// document.cookie (ESPN does not set HttpOnly on either), base64-encodes
// { s2, swid, ts } as JSON, and redirects the same tab to
// https://larrybball.netlify.app/link with the encoded token in the URL
// fragment so it never appears in Netlify access logs or referer headers.
//
// The install page renders this file plain-text so users can audit it
// before adding to their bookmarks.

(function () {
  try {
    if (!/(^|\.)espn\.com$/i.test(location.hostname)) {
      alert('Open ESPN Fantasy first, then tap Larry Link.');
      return;
    }
    var cookies = document.cookie.split(';').reduce(function (acc, pair) {
      var eq = pair.indexOf('=');
      if (eq < 0) return acc;
      var name = pair.slice(0, eq).trim();
      var value = pair.slice(eq + 1).trim();
      try { acc[name] = decodeURIComponent(value); }
      catch (e) { acc[name] = value; }
      return acc;
    }, {});
    if (!cookies.espn_s2 || !cookies.SWID) {
      alert('Sign in to ESPN Fantasy first, then tap Larry Link again.');
      return;
    }
    var token = btoa(JSON.stringify({
      s2: cookies.espn_s2,
      swid: cookies.SWID,
      ts: Date.now()
    }));
    location.href = 'https://larrybball.netlify.app/link#token=' + encodeURIComponent(token);
  } catch (e) {
    alert('Larry Link error: ' + (e && e.message ? e.message : e));
  }
})();
