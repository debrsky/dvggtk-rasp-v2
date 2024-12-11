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

const checkUpdaterAvailability = async () => {
  let counter = 0;
  let checkInterval = 10;
  while (!self.DB_UPDATER) {
    if (counter > 10) throw Error('[service-worker.js] updater NOT loaded');

    console.log(`[service-worker.js] try #${counter + 1}: updater still not loaded`);
    counter++;
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    checkInterval = 2 * checkInterval;
  }

  console.log(`[service-worker.js] try #${counter + 1}: updater loaded`);
};

(async () => {
  await checkUpdaterAvailability();
  self.DB_UPDATER.addUpdateListener(sendUpdateMessage);
})();

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
    event.waitUntil((async () => {
      await checkUpdaterAvailability();
      await self.DB_UPDATER.syncWithServer();
    })());
  }
});
