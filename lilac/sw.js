// ============================================================
// LILAC - Service Worker v1.0
// Caches core assets for offline support
// ============================================================

var CACHE_NAME = 'lilac-v1.0';
var CORE_ASSETS = [
  '/',
  '/index.html',
  '/css/lilac.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/browse.js',
  '/js/firebase-config.js',
  '/js/recipes.js',
  '/js/recommend.js',
  '/js/theme.js',
  '/js/ui.js',
  '/manifest.json',
  '/assets/icon-192.svg',
  '/assets/icon-512.svg'
];

// Install - cache core assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CORE_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first, cache fallback (skip API/Firebase calls)
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API calls, Firebase, and external resources
  if (url.includes('.netlify/functions') ||
      url.includes('firestore.googleapis.com') ||
      url.includes('firebase') ||
      url.includes('gstatic.com') ||
      url.includes('anthropic.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request).then(function(response) {
      // Cache successful responses
      if (response.ok) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});
