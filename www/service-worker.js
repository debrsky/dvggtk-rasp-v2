importScripts('./db.js', './updater.js');

console.log('[service worker] starting');

const CACHE_NAME = 'v6';

const sendUpdateMessage = async (err, status) => {
  if (err) console.error(err);

  (await self.clients.matchAll()).forEach((client) => client.postMessage({
    type: 'UPDATER',
    payload: { status }
  }));
};

if (self.DB_UPDATER) {
  self.DB_UPDATER.addUpdateListener(sendUpdateMessage);
} else {
  let counter = 0;
  let timerId = setInterval(() => {
    counter++;
    if (self.DB_UPDATER) {
      self.DB_UPDATER.addUpdateListener(sendUpdateMessage);
      clearInterval(timerId);
      console.log('[services worker] updater initialized');
    } else {
      console.log(`[service worker] try #${counter}: updater still not loaded`);
    }
  }, 10);
};

self.addEventListener('install', event => {
  console.log('[service worker] installing');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([
        './',
        './index.html',
        './style.css',
        './worker.js',
        './app.js',
        './updater.js',
        './db.js',
        './render.js',
        './icon.png',
        './icon-512.png'
      ]);
    })
  );

  // Принудительно активировать новый сервис-воркер
  // self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[service worker] activating');
  const cleanCache = caches.keys().then(cacheNames => {
    return Promise.all(
      cacheNames.map(cacheName => {
        if (cacheName !== CACHE_NAME) {
          return caches.delete(cacheName);
        };
      })
    );
  });

  event.waitUntil(cleanCache);
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

self.addEventListener('periodicsync', event => {
  if (event.tag === 'sync-with-server') {
    console.log('[service worker] sync-with-server triggered');
    event.waitUntil(self.DB_UPDATER.syncWithServer());
  }
});
