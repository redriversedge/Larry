var CACHE_VERSION = 'larry-v2.0.0';
var CACHE_FILES = [
  '/',
  '/index.html',
  '/css/larry.css',
  '/js/core.js',
  '/js/espn.js',
  '/js/engines.js',
  '/js/tabs.js',
  '/js/chat.js',
  '/assets/larry-logo.svg',
  '/manifest.json'
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

self.addEventListener('fetch', function(e) {
  // Skip non-GET and API calls
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.pathname.startsWith('/.netlify/functions/')) return;
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    // Stale-while-revalidate
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        var fetchPromise = fetch(e.request).then(function(response) {
          if (response.ok) {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(function() {
          return cached;
        });
        return cached || fetchPromise;
      });
    })
  );
});
