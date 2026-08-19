// Точный URL вашей базы данных Firebase в европейском регионе
const firebaseConfig = {
  databaseURL: "https://pofig-b630a-default-rtdb.europe-west1.firebasedatabase.app"
};

try {
  firebase.initializeApp(firebaseConfig);
} catch (e) {
  console.log("Firebase уже инициализирован");
}

const db = firebase.database();

const statusElem = document.getElementById('status');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const roomsList = document.getElementById('rooms-list');

let localStream = null;
let peer = null;
let currentCall = null;
let currentRoom = null;
let roomRef = null;

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

// 1. Отображение комнат
db.ref('rooms').on('value', (snapshot) => {
  const rooms = snapshot.val() || {};
  roomsList.innerHTML = '';

  const waitingRooms = Object.entries(rooms).filter(([name, data]) => data && data.count === 1);

  if (waitingRooms.length === 0) {
    roomsList.innerHTML = '<span style="color: #666; font-size: 13px;">Нет активных комнат с 1 участником</span>';
    return;
  }

  waitingRooms.forEach(([name, data]) => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `🟢 <strong>${name}</strong> (1/2)`;
    tag.onclick = () => {
      if (!currentRoom) {
        roomInput.value = name;
        joinRoom(name);
      }
    };
    roomsList.appendChild(tag);
  });
}, (error) => {
  statusElem.textContent = 'Ошибка доступа к Firebase: ' + error.message;
});

// 2. Доступ к камере
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    statusElem.textContent = 'Камера готова. Выберите комнату или введите название.';

    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      roomInput.value = roomParam;
      joinRoom(roomParam);
    }
  } catch (err) {
    statusElem.textContent = 'Ошибка камеры/микрофона: ' + err.message;
  }
}

// 3. Вход в комнату
async function joinRoom(rawRoomName) {
  const room = rawRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!room) {
    alert('Используйте только латинские буквы и цифры');
    return;
  }

  leaveRoom(false);
  currentRoom = room;
  setUIState(true);
  window.history.pushState({}, '', `?room=${room}`);

  statusElem.textContent = `Подключение к сети...`;

  peer = new Peer({
    config: { iceServers },
    debug: 1
  });

  peer.on('open', async (myId) => {
    statusElem.textContent = `Поиск комнаты «${room}»...`;
    roomRef = db.ref(`rooms/${room}`);

    try {
      const snapshot = await roomRef.get();
      const roomData = snapshot.val();

      if (!roomData) {
        // --- МЫ ХОСТ (1/2) ---
        await roomRef.set({
          hostId: myId,
          count: 1
        });
        roomRef.onDisconnect().remove();

        statusElem.textContent = `Вы создали комнату «${room}» (1/2). Ожидание собеседника...`;

        peer.on('call', (call) => {
          currentCall = call;
          call.answer(localStream); // Отправляем наш поток в ответ
          handleStream(call);
          roomRef.update({ count: 2 });
        });

      } else if (roomData.count === 1) {
        // --- МЫ ГОСТЬ (2/2) ---
        statusElem.textContent = `Соединение с собеседником...`;
        
        await roomRef.update({ count: 2 });
        roomRef.onDisconnect().update({ count: 1 });

        // Звоним создателю комнаты
        const call = peer.call(roomData.hostId, localStream);
        currentCall = call;
        handleStream(call);

      } else {
        // --- КОМНАТА ПОЛНАЯ ---
        statusElem.textContent = 'Комната уже заполнена (2/2).';
        leaveRoom(false);
      }
    } catch (err) {
      statusElem.textContent = 'Ошибка базы данных: ' + err.message;
      leaveRoom(false);
    }
  });

  peer.on('error', (err) => {
    statusElem.textContent = 'Ошибка Peer: ' + err.type;
    leaveRoom(false);
  });
}

// 4. Показ входящего видео
function handleStream(call) {
  call.on('stream', (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    statusElem.textContent = 'Связь установлена (2/2)!';
  });

  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник отключился.';
    if (roomRef) {
      roomRef.update({ count: 1 });
    }
  });

  call.on('error', () => {
    statusElem.textContent = 'Ошибка медиапотока.';
  });
}

// 5. Выход
function leaveRoom(updateStatus = true) {
  if (currentCall) {
    try { currentCall.close(); } catch(e) {}
    currentCall = null;
  }
  if (peer) {
    try { peer.destroy(); } catch(e) {}
    peer = null;
  }
  if (roomRef) {
    roomRef.remove();
    roomRef = null;
  }

  remoteVideo.srcObject = null;
  currentRoom = null;

  window.history.pushState({}, '', window.location.pathname);
  setUIState(false);

  if (updateStatus) {
    statusElem.textContent = 'Вы вышли из комнаты.';
  }
}

function setUIState(isInRoom) {
  joinBtn.style.display = isInRoom ? 'none' : 'inline-block';
  leaveBtn.style.display = isInRoom ? 'inline-block' : 'none';
  roomInput.disabled = isInRoom;
}

joinBtn.addEventListener('click', () => joinRoom(roomInput.value));
leaveBtn.addEventListener('click', () => leaveRoom(true));
roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom(roomInput.value);
});

initCamera();
