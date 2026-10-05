// Service Worker for Push Notifications

// Activate new SW immediately without waiting for old tabs to close
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  let data = { title: 'Arke', body: 'Você tem uma nova notificação!' };
  
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || '',
    icon: '/pwa-icon-192.png',
    badge: '/pwa-icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
    },
    actions: [],
  };
  // Mesma etiqueta (a mesma conversa, o mesmo comunicado): o aviso novo
  // substitui o anterior na bandeja, e o celular avisa de novo.
  if (typeof data.tag === 'string' && data.tag.length <= 64) {
    options.tag = data.tag;
    options.renotify = true;
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Arke', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  // O aviso só abre o próprio app: endereço de fora vira a página inicial.
  let absoluteUrl = new URL('/', self.location.origin).href;
  try {
    const destino = new URL(targetUrl, self.location.origin);
    if (destino.origin === self.location.origin) absoluteUrl = destino.href;
  } catch (e) {
    // endereço inválido: fica a página inicial
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Prefer standalone PWA window if one exists
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) {
            return client.navigate(absoluteUrl).then(function(c) { return c.focus(); });
          }
          return client.focus();
        }
      }
      // No existing window — openWindow will open in PWA if installed
      return clients.openWindow(absoluteUrl);
    })
  );
});
