// === 1. КОНФИГУРАЦИЯ FIREBASE И VERCEL ===
const firebaseConfig = {
  apiKey: "AIzaSyBxTAoazwGTahOMpRpssdZqxn2wJ7cLC2s",
  authDomain: "pofig-b630a.firebaseapp.com",
  databaseURL: "https://pofig-b630a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "pofig-b630a",
  storageBucket: "pofig-b630a.firebasestorage.app",
  messagingSenderId: "63431918362",
  appId: "1:63431918362:web:d44ecb8633ef0165da62a3",
  measurementId: "G-9CRL2X1NCE"
};

const VAPID_KEY = "BBwb8bwPePgZVSKL27jdsJICW-zgAnIUYF65wfhLVHWHe3E0G_YA4Lmt-Vozprs_1vWW54SKBGC3tRxRG9SGErM";
const PUSH_SERVER_URL = "https://petcall.vercel.app/api/send-push";

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
let messaging = null;

if ('serviceWorker' in navigator && 'PushManager' in window) {
  try {
    messaging = firebase.messaging();
  } catch (e) {
    console.warn("Firebase Messaging не поддерживается:", e);
  }
}

const peerConfig = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

// === 2. ЭЛЕМЕНТЫ DOM ===
const statusElem = document.getElementById('status');
const authBox = document.getElementById('auth-box');
const contactsBox = document.getElementById('contacts-box');
const currentUserLabel = document.getElementById('current-user-label');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const authBtn = document.getElementById('auth-btn');
const logoutBtn = document.getElementById('logout-btn');
const enableNotifBtn = document.getElementById('enable-notifications-btn');
const searchInput = document.getElementById('search-input');
const usersList = document.getElementById('users-list');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const remoteLabel = document.getElementById('remote-label');
const callControls = document.getElementById('call-controls');
const hangupBtn = document.getElementById('hangup-btn');
const incomingModal = document.getElementById('incoming-modal');
const callerNameElem = document.getElementById('caller-name');
const acceptCallBtn = document.getElementById('accept-call-btn');
const rejectCallBtn = document.getElementById('reject-call-btn');

// === 3. СОСТОЯНИЕ ===
let currentUser = null;
let localStream = null;
let peer = null;
let peerReady = false;
let currentCall = null;
let allUsers = {};
let pendingIncomingCall = null;
let ringtoneInterval = null;
let callingTargetId = null;

// === 4. ЗВУК ЗВОНКА (Web Audio API) ===
let audioCtx = null;

function playRingtone() {
  stopRingtone();
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    function beep() {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.setValueAtTime(480, audioCtx.currentTime + 0.05);
      
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start();
      osc.stop(audioCtx.currentTime + 1.2);
    }

    beep();
    ringtoneInterval = setInterval(beep, 3000);
  } catch (e) {
    console.warn("Воспроизведение звука заблокировано до взаимодействия с пользователем:", e);
  }
}

function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
}

// === 5. ИНИЦИАЛИЗАЦИЯ МЕДИА ===
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    statusElem.textContent = 'Камера и микрофон готовы';
    checkCachedAuth();
  } catch (err) {
    statusElem.textContent = 'Ошибка доступа к медиа: ' + err.message;
  }
}

// === 6. НАСТРОЙКА PUSH-УВЕДОМЛЕНИЙ ===
async function getAndSaveFcmToken(userId) {
  if (!messaging || !('serviceWorker' in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' });
    
    // Удаляем старый кэшированный токен, чтобы исключить ошибку "Device unregistered"
    try {
      await messaging.deleteToken();
    } catch (e) {
      // Игнорируем ошибку, если токена не существовало
    }

    // Запрашиваем новый валидный токен от Firebase
    const freshToken = await messaging.getToken({
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (freshToken && userId) {
      await db.ref(`users/${userId}`).update({ fcmToken: freshToken });
      console.log('Новый валидный FCM токен сохранен в базе:', freshToken);
      if (enableNotifBtn) enableNotifBtn.style.display = 'none';
      return freshToken;
    }
  } catch (err) {
    console.error('Ошибка получения FCM токена:', err);
  }
  return null;
}

if (enableNotifBtn) {
  enableNotifBtn.addEventListener('click', () => {
    if (!messaging || !('serviceWorker' in navigator)) {
      alert('Push-уведомления не поддерживаются в этом браузере.');
      return;
    }

    Notification.requestPermission().then(async (permission) => {
      if (permission === 'granted') {
        const token = await getAndSaveFcmToken(currentUser?.id);
        if (token) {
          alert('Уведомления успешно активированы!');
        } else {
          alert('Не удалось получить токен. Проверьте консоль браузера (F12).');
        }
      } else {
        alert('Разрешение на отправку уведомлений отклонено.');
      }
    });
  });
}

// Отправка Push-уведомления через Vercel Serverless
async function sendPushNotification(targetToken, callerName) {
  if (!targetToken) return;

  try {
    const response = await fetch(PUSH_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: targetToken,
        callerName: callerName,
        url: window.location.href
      })
    });

    const result = await response.json();
    console.log('Ответ Vercel Push Server:', result);
  } catch (err) {
    console.error('Ошибка отправки через Vercel:', err);
  }
}

// Системный баннер, если вкладка открыта
function showDesktopNotification(callerName) {
  if (Notification.permission === 'granted') {
    const notif = new Notification('Входящий видеозвонок', {
      body: `${callerName} звонит вам!`,
      icon: 'https://cdn-icons-png.flaticon.com/512/724/724664.png',
      requireInteraction: true,
      tag: 'incoming-call'
    });

    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  }
}

// === 7. АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ ===
async function simpleHash(str) {
  const msgUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleAuth() {
  const username = usernameInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const password = passwordInput.value.trim();

  if (!username || !password) {
    alert('Введите логин и пароль');
    return;
  }

  const passwordHash = await simpleHash(password);
  const userRef = db.ref(`users/${username}`);
  const snapshot = await userRef.once('value');
  const userData = snapshot.val();

  if (userData) {
    if (userData.passwordHash === passwordHash) {
      loginSuccess(username, userData.name);
    } else {
      alert('Неверный пароль!');
    }
  } else {
    await userRef.set({
      name: username,
      passwordHash: passwordHash,
      online: true,
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    });
    loginSuccess(username, username);
  }
}

async function loginSuccess(userId, displayName) {
  currentUser = { id: userId, username: displayName };
  localStorage.setItem('auth_user', JSON.stringify({ id: userId, username: displayName }));

  authBox.classList.add('hidden');
  contactsBox.classList.remove('hidden');
  currentUserLabel.textContent = `Вы: ${displayName}`;

  // Обновляем токен при каждом логине, если разрешение уже есть
  if (Notification.permission === 'granted') {
    if (enableNotifBtn) enableNotifBtn.style.display = 'none';
    getAndSaveFcmToken(userId);
  }

  initPeer();
  listenToIncomingCalls();
  listenToUsers();
}

function checkCachedAuth() {
  const cached = localStorage.getItem('auth_user');
  if (cached) {
    try {
      const user = JSON.parse(cached);
      loginSuccess(user.id, user.username);
    } catch (e) {
      localStorage.removeItem('auth_user');
    }
  }
}

function logout() {
  if (currentUser) {
    db.ref(`users/${currentUser.id}`).update({ online: false, peerId: null });
    db.ref(`calls/${currentUser.id}`).remove();
  }
  localStorage.removeItem('auth_user');
  if (peer) peer.destroy();
  location.reload();
}

// === 8. СЕТЬ PEERJS ===
function initPeer() {
  const customPeerId = `user-${currentUser.id}-${Date.now().toString(36)}`;
  peer = new Peer(customPeerId, peerConfig);

  peer.on('open', (id) => {
    peerReady = true;
    statusElem.textContent = 'В сети. Готов к звонкам.';
    
    const myRef = db.ref(`users/${currentUser.id}`);
    myRef.update({
      online: true,
      peerId: id,
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    });
    
    myRef.onDisconnect().update({
      online: false,
      peerId: null,
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    });
  });

  peer.on('call', (call) => {
    call.answer(localStream);
    handleStream(call);
  });

  peer.on('error', (err) => {
    console.error('PeerJS error:', err);
    statusElem.textContent = 'Ошибка соединения: ' + err.type;
  });
}

// === 9. КОНТАКТЫ ===
function listenToUsers() {
  db.ref('users').on('value', (snapshot) => {
    allUsers = snapshot.val() || {};
    renderUserList();
  });
}

function renderUserList() {
  usersList.innerHTML = '';
  const search = searchInput.value.toLowerCase().trim();

  Object.keys(allUsers).forEach((uid) => {
    if (currentUser && uid === currentUser.id) return;

    const u = allUsers[uid];
    if (search && !u.name.toLowerCase().includes(search)) return;

    const li = document.createElement('li');
    li.className = 'user-item';

    const info = document.createElement('div');
    info.className = 'user-info';
    info.innerHTML = `
      <span class="status-dot ${u.online ? 'online' : ''}"></span>
      <span>${u.name} ${u.online ? '' : '<small style="color:#666">(офлайн)</small>'}</span>
    `;

    const callBtn = document.createElement('button');
    callBtn.textContent = 'Позвонить';
    callBtn.disabled = !u.online && !u.fcmToken;
    callBtn.onclick = () => startCall(uid, u.name, u.fcmToken);

    li.appendChild(info);
    li.appendChild(callBtn);
    usersList.appendChild(li);
  });
}

searchInput.addEventListener('input', renderUserList);

// === 10. ЗВОНКИ И РУКОПОЖАТИЕ ===
function startCall(targetUid, targetName, targetFcmToken) {
  callingTargetId = targetUid;
  statusElem.textContent = `Вызов ${targetName}... Ждём ответа`;
  callControls.classList.remove('hidden');
  remoteLabel.textContent = targetName;

  // 1. Создаем звонок в Realtime Database со статусом ringing
  const callRef = db.ref(`calls/${targetUid}`);
  callRef.set({
    callerId: currentUser.id,
    callerName: currentUser.username,
    callerPeerId: peer ? peer.id : null,
    status: 'ringing',
    timestamp: Date.now()
  });

  // 2. Отправляем Push-уведомление через Vercel
  if (targetFcmToken) {
    sendPushNotification(targetFcmToken, currentUser.username);
  }

  // 3. Звонящий слушает ответ адресата:
  callRef.on('value', (snap) => {
    const data = snap.val();
    
    // Когда адресат нажал "Принять" и прислал актуальный calleePeerId
    if (data && data.status === 'accepted' && data.calleePeerId) {
      statusElem.textContent = 'Соединение установлено!';
      if (!currentCall && peer) {
        const call = peer.call(data.calleePeerId, localStream);
        handleStream(call);
      }
    } else if (!data && callingTargetId) {
      endCallUI();
      statusElem.textContent = 'Вызов отклонен или завершен.';
      callRef.off();
    }
  });
}

// Слушатель входящих звонков
function listenToIncomingCalls() {
  const callRef = db.ref(`calls/${currentUser.id}`);
  
  callRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data && data.status === 'ringing') {
      pendingIncomingCall = data;
      callerNameElem.textContent = `${data.callerName} звонит вам...`;
      incomingModal.classList.remove('hidden');
      
      playRingtone();
      showDesktopNotification(data.callerName);
    } else if (!data || data.status !== 'ringing') {
      incomingModal.classList.add('hidden');
      stopRingtone();
      if (!data) pendingIncomingCall = null;
    }
  });
}

// Кнопка: Принять
acceptCallBtn.onclick = async () => {
  stopRingtone();
  incomingModal.classList.add('hidden');
  
  if (pendingIncomingCall) {
    remoteLabel.textContent = pendingIncomingCall.callerName;
    statusElem.textContent = 'Соединение...';
    
    // Если вкладка только открылась, ждём готовности PeerJS
    if (!peerReady) {
      await new Promise(r => setTimeout(r, 600));
    }

    // Отправляем звонящему актуальный peer.id этой открывшейся вкладки
    db.ref(`calls/${currentUser.id}`).update({
      status: 'accepted',
      calleePeerId: peer.id
    });
  }
};

// Кнопка: Отклонить
rejectCallBtn.onclick = () => {
  stopRingtone();
  incomingModal.classList.add('hidden');
  db.ref(`calls/${currentUser.id}`).remove();
  pendingIncomingCall = null;
  statusElem.textContent = 'Вызов отклонен.';
};

// Обработка видеопотока
function handleStream(call) {
  currentCall = call;
  callControls.classList.remove('hidden');

  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    statusElem.textContent = 'Идет разговор';
  });

  call.on('close', endCallUI);
  call.on('error', endCallUI);
}

function endCallUI() {
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  remoteVideo.srcObject = null;
  remoteLabel.textContent = 'Собеседник';
  callControls.classList.add('hidden');
  callingTargetId = null;
  stopRingtone();
}

hangupBtn.onclick = () => {
  if (callingTargetId) {
    db.ref(`calls/${callingTargetId}`).remove();
  }
  if (currentUser) {
    db.ref(`calls/${currentUser.id}`).remove();
  }
  endCallUI();
  statusElem.textContent = 'Звонок завершен.';
};

authBtn.addEventListener('click', handleAuth);
logoutBtn.addEventListener('click', logout);

initMedia();
