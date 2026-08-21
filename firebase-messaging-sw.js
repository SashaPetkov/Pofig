importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

const firebaseConfig = {
  apiKey: "AIzaSyBxTAoazwGTahOMpRpssdZqxn2wJ7cLC2s",
  authDomain: "pofig-b630a.firebaseapp.com",
  databaseURL: "https://pofig-b630a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "pofig-b630a",
  storageBucket: "pofig-b630a.firebasestorage.app",
  messagingSenderId: "63431918362",
  appId: "1:63431918362:web:d44ecb8633ef0165da62a3"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification?.title || 'Входящий звонок';
  const notificationOptions = {
    body: payload.notification?.body || 'Вам звонят в видеочате!',
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 300],
    data: {
      url: payload.data?.url || '/'
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data?.url || '/');
      }
    })
  );
});
