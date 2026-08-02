// sw.js — service worker for background alerts.
//
// A service worker runs even when the CRM is closed, which is the whole point:
// the in-app Notification API only fires while a tab is open, so an alert about
// a lead texting arrived exactly when you were already looking at the screen.
//
// Scope is the site root so it can control /crm.

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Rosalia CRM', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'New message';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Same tag replaces an earlier notification from the same lead rather than
    // stacking five of them.
    tag: data.tag || 'rosalia-inbound',
    renotify: true,
    data: { url: data.url || '/crm' },
    vibrate: [100, 50, 100],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/crm';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Focus an open CRM tab if there is one, rather than opening a second.
      for (const client of list) {
        if (client.url.includes('/crm') && 'focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
