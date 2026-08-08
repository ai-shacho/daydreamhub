// Minimal service worker for the /app PWA shell. Network-first with a cached
// fallback so the shell still opens briefly offline. Scoped to /app — the main
// site and APIs are never intercepted.
const CACHE = 'ddh-app-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // always live
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ---- Web Push -------------------------------------------------------------
// Pushes carry no payload (keeps the server free of encryption); the worker
// asks the API what to show, identified by its own subscription endpoint.
self.addEventListener('push', (e) => {
  e.waitUntil(
    (async () => {
      let info = null;
      try {
        const sub = await self.registration.pushManager.getSubscription();
        if (sub) {
          const res = await fetch('/api/app/push-pending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          if (res.ok) info = await res.json();
        }
      } catch (err) {}
      // userVisibleOnly requires a notification for every push received.
      await self.registration.showNotification(
        (info && info.title) || 'DayDreamHub',
        {
          body: (info && info.body) || 'Tap to open DayDreamHub.',
          icon: '/app-icon-192.png',
          badge: '/app-icon-192.png',
          tag: 'ddh-inquiry',
          renotify: true,
          data: { url: (info && info.url) || '/app' },
        }
      );
    })()
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/app';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes('/app')) return w.focus();
      }
      return clients.openWindow(target);
    })
  );
});
