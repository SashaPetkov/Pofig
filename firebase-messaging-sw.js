// firebase-messaging-sw.js
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
  const title = payload.notification?.title || payload.data?.title || 'Входящий звонок';
  const options = {
    body: payload.notification?.body || payload.data?.body || 'Вам звонят в видеочате!',
    icon: 'https://cdn-icons-png.flaticon.com/512/724/724664.png',
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 500],
    data: {
      url: payload.data?.url || payload.fcmOptions?.link || '/'
    }
  };

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
