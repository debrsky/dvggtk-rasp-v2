const CACHE_NAME = 'v1';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([
        './',
        './index.html',
        './status.html',
        './style.css',
        './app.js',
        './updater.js',
        './db.js',
        './render.js',
        './icon.png',
        './icon-512.png'
      ]);
    })
  );
});

self.addEventListener('fetch', event => {
  // Skip chrome-extension:// requests
  if (event.request.url.startsWith('chrome-extension://')) {
    return;
  }

  // Ignore rasp.json requests
  if (/rasp.json$/.test(event.request.url)) return;

  // Stale While Revalidate
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // If the response is valid, update the cache
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          // Clone the response BEFORE checking status
          const responseToCache = networkResponse.clone();

          caches.open(CACHE_NAME).then(cache => {
            // Additional check before putting in cache
            if (responseToCache.type === 'basic') {
              cache.put(event.request, responseToCache).catch(err => {
                console.error('Cache put error:', err);
              });
            }
          });
        }
        return networkResponse; // Return original network response to the client
      }).catch(err => {
        console.error('Fetch error:', err);
        return cachedResponse; // Fall back to cached response if fetch fails
      });

      // Return cached response if available, otherwise return the fetch promise.
      return cachedResponse || fetchPromise;
    })
  );
});
