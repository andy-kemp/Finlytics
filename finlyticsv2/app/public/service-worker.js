// Self-destructing service worker — v2 (2026-03-17)
// This replaces the old caching SW. On activation it nukes every
// cache and unregisters itself so the browser fetches everything
// fresh from the network.

self.addEventListener('install', () => {
  // Take over immediately, don't wait for old tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
      .then(() => {
        // Tell every open tab to hard-reload so they pick up fresh assets
        self.clients.matchAll({ type: 'window' }).then((clients) => {
          clients.forEach((client) => client.navigate(client.url));
        });
      })
  );
});

// No fetch handler — everything goes straight to the network
