// === 1. КОНФИГУРАЦИЯ FIREBASE ===
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

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
let messaging = null;

if ('serviceWorker' in navigator && 'PushManager' in window) {
  try {
    messaging = firebase.messaging();
  } catch (e) {
    console.warn("Messaging не поддерживается:", e);
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
let currentCall = null;
let allUsers = {};
let pendingIncomingCall = null;
let ringtoneInterval = null;

// === 4. ЗВУК ЗВОНКА (Web Audio API) ===
let audioCtx = null;

function playRingtone() {
  stopRingtone();
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
    statusElem.textContent = 'Ошибка доступа: ' + err.message;
  }
}

// === 6. РЕГИСТРАЦИЯ PUSH-ТОКЕНА ===
async function setupPushNotifications(userId) {
  if (!messaging || !('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    const permission = await Notification.requestPermission();
    
    if (permission === 'granted') {
      const currentToken = await messaging.getToken({
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration
      });

      if (currentToken) {
        db.ref(`users/${userId}`).update({ fcmToken: currentToken });
      }
    }
  } catch (err) {
    console.warn('Push-уведомления не зарегистрированы:', err);
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

function loginSuccess(userId, displayName) {
  currentUser = { id: userId, username: displayName };
  localStorage.setItem('auth_user', JSON.stringify({ id: userId, username: displayName }));

  authBox.classList.add('hidden');
  contactsBox.classList.remove('hidden');
  currentUserLabel.textContent = `Вы: ${displayName}`;

  initPeer();
  listenToIncomingCalls();
  listenToUsers();
  setupPushNotifications(userId);
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
    callBtn.onclick = () => startCall(uid, u.name, u.peerId);

    li.appendChild(info);
    li.appendChild(callBtn);
    usersList.appendChild(li);
  });
}

searchInput.addEventListener('input', renderUserList);

// === 10. ЗВОНКИ ===
function startCall(targetUid, targetName, targetPeerId) {
  statusElem.textContent = `Вызов ${targetName}...`;
  
  db.ref(`calls/${targetUid}`).set({
    callerId: currentUser.id,
    callerName: currentUser.username,
    callerPeerId: peer ? peer.id : null,
    timestamp: Date.now()
  });

  if (targetPeerId) {
    const call = peer.call(targetPeerId, localStream);
    handleStream(call);
  }
  remoteLabel.textContent = targetName;
}

function listenToIncomingCalls() {
  const callRef = db.ref(`calls/${currentUser.id}`);
  
  callRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data && data.callerPeerId) {
      pendingIncomingCall = data;
      callerNameElem.textContent = `${data.callerName} звонит вам...`;
      incomingModal.classList.remove('hidden');
      playRingtone();
    } else {
      incomingModal.classList.add('hidden');
      stopRingtone();
      pendingIncomingCall = null;
    }
  });
}

acceptCallBtn.onclick = () => {
  stopRingtone();
  incomingModal.classList.add('hidden');
  if (pendingIncomingCall) {
    remoteLabel.textContent = pendingIncomingCall.callerName;
    db.ref(`calls/${currentUser.id}`).remove();
    statusElem.textContent = 'Соединение...';
  }
};

rejectCallBtn.onclick = () => {
  stopRingtone();
  incomingModal.classList.add('hidden');
  db.ref(`calls/${currentUser.id}`).remove();
};

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
  statusElem.textContent = 'Звонок завершен.';
}

hangupBtn.onclick = () => {
  endCallUI();
  if (currentUser) {
    db.ref(`calls/${currentUser.id}`).remove();
  }
};

authBtn.addEventListener('click', handleAuth);
logoutBtn.addEventListener('click', logout);

initMedia();
