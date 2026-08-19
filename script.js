// Конфигурация Firebase с вашей базой данных
const firebaseConfig = {
  databaseURL: "https://pofig-b630a-default-rtdb.firebaseio.com"
};

firebase.initializeApp(firebaseConfig);
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

// STUN-серверы Google для обхода NAT
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

// Отслеживание списка комнат в реальном времени
db.ref('rooms').on('value', (snapshot) => {
  const rooms = snapshot.val() || {};
  roomsList.innerHTML = '';

  const waitingRooms = Object.entries(rooms).filter(([name, data]) => data.count === 1);

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
});

// Инициализация камеры
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

// Вход в комнату
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

  statusElem.textContent = `Подключение к «${room}»...`;

  peer = new Peer({ config: { iceServers } });

  peer.on('open', async (myId) => {
    roomRef = db.ref(`rooms/${room}`);
    const snapshot = await roomRef.get();
    const roomData = snapshot.val();

    if (!roomData) {
      // 1. Создаем новую комнату (Хост)
      await roomRef.set({
        hostId: myId,
        count: 1
      });
      roomRef.onDisconnect().remove();

      statusElem.textContent = `Вы создали комнату «${room}» (1/2). Ожидание собеседника...`;

      peer.on('call', (call) => {
        currentCall = call;
        call.answer(localStream);
        handleStream(call);
        roomRef.update({ count: 2 });
      });

    } else if (roomData.count === 1) {
      // 2. Подключаемся вторым (Гость)
      statusElem.textContent = `Подключение к собеседнику в «${room}»...`;
      
      await roomRef.update({ count: 2 });
      roomRef.onDisconnect().update({ count: 1 });

      const call = peer.call(roomData.hostId, localStream);
      currentCall = call;
      handleStream(call);

    } else {
      // 3. Комната занята (2/2)
      statusElem.textContent = 'Комната уже заполнена (2/2).';
      leaveRoom(false);
    }
  });

  peer.on('error', (err) => {
    statusElem.textContent = 'Ошибка соединения: ' + err.message;
    leaveRoom(false);
  });
}

function handleStream(call) {
  call.on('stream', (stream) => {
    remoteVideo.srcObject = stream;
    statusElem.textContent = 'Связь установлена (2/2)!';
  });

  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник отключился.';
    if (roomRef) {
      roomRef.update({ count: 1 });
    }
  });
}

function leaveRoom(updateStatus = true) {
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (peer) {
    peer.destroy();
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
