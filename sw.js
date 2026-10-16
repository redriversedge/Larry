// Larry v3.0 Service Worker
var CACHE_VERSION = 'larry-v3.25.1';
var CACHE_FILES = [
  '/',
  '/index.html',
  '/css/larry.css',
  '/js/themes.js',
  '/js/core.js',
  '/js/engines.js',
  '/js/tabs.js',
  '/js/draft.js',
  '/js/espn.js',
  '/js/chat.js',
  '/js/larry-move.js',
  '/dist/larry-engine.js',
  '/dist/larry-cookies.js',
  // Historical ESPN ADP. Without it the Draft Room's profile cards lose
  // their reach line, so it is precached rather than fetched on demand.
  '/data/espn-adp-history.json',
  '/manifest.json',
  '/assets/larry-logo.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-192.png',
  '/assets/icon-maskable-512.png',
  '/assets/favicon-32.png',
  '/apple-touch-icon.png',
  '/connect',
  '/link',
  '/public/bookmarklet.js',
  '/public/ios-shortcut.txt'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(CACHE_FILES);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_VERSION; })
          .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Is this the HTML shell? The shell is what names every script, so serving
// a stale one pins the whole app to an old build. Everything else is
// content-addressed enough that cache-first is fine.
function isAppShell(request) {
  if (request.mode === 'navigate') return true;
  var url = new URL(request.url);
  return url.pathname === '/' || url.pathname === '/index.html';
}

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/') || e.request.url.includes('/.netlify/')) return;
  if (e.request.url.includes('anthropic.com')) return;

  // Network-first for the shell. Cache-first meant a deploy was not picked
  // up until the service worker happened to update, which on an installed
  // PWA could be days.
  if (isAppShell(e.request)) {
    e.respondWith(
      fetch(e.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Offline: fall back to whatever shell we have.
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('/index.html');
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var fetched = fetch(e.request).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return cached;
      });
      return cached || fetched;
    })
  );
});
