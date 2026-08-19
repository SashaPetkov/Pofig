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

// Настройка подключения к локальному/развернутому Peer-серверу
const peerConfig = {
  host: window.location.hostname || 'localhost',
  port: 9000,
  path: '/peerjs/chat',
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

// Запрос доступных комнат с бэкенда (только с 1 участником)
async function fetchRooms() {
  try {
    const res = await fetch('/api/rooms');
    const rooms = await res.json();
    
    // Фильтруем: показываем только комнаты, ожидающие второго участника
    const availableRooms = rooms.filter(r => r.count === 1);

    roomsList.innerHTML = '';
    if (availableRooms.length === 0) {
      roomsList.innerHTML = '<span style="color: #666; font-size: 13px;">Нет активных комнат с 1 участником</span>';
      return;
    }

    availableRooms.forEach(room => {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.innerHTML = `🟢 <strong>${room.name}</strong> (1/2)`;
      tag.onclick = () => {
        if (!currentRoom) {
          roomInput.value = room.name;
          joinRoom(room.name);
        }
      };
      roomsList.appendChild(tag);
    });
  } catch (err) {
    roomsList.innerHTML = '<span style="color: #ef4444; font-size: 13px;">Ошибка загрузки списка комнат</span>';
  }
}

// Периодическое обновление списка
setInterval(fetchRooms, 3000);

// Инициализация камеры
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    statusElem.textContent = 'Камера готова. Введите название комнаты или выберите готовую.';
    
    fetchRooms();

    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      roomInput.value = roomParam;
      joinRoom(roomParam);
    }
  } catch (err) {
    statusElem.textContent = 'Ошибка доступа к устройствам: ' + err.message;
  }
}

// Вход в комнату
function joinRoom(rawRoomName) {
  const room = rawRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!room) {
    alert('Используйте латинские буквы, цифры, дефис или подчеркивание.');
    return;
  }

  // Очищаем предыдущую сессию при повторном входе
  leaveRoom(false);
  currentRoom = room;

  window.history.pushState({}, '', `?room=${room}`);
  setUIState(true);
  statusElem.textContent = `Подключение к «${room}»...`;

  const hostId = `room-${room}-host`;
  peer = new Peer(hostId, peerConfig);

  peer.on('open', () => {
    statusElem.textContent = `Вы создали комнату «${room}» (1/2). Ожидание собеседника...`;
    fetchRooms();
  });

  // Входящий звонок от гостя
  peer.on('call', (call) => {
    currentCall = call;
    call.answer(localStream);
    handleStream(call);
    fetchRooms();
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // Хост уже есть -> пробуем войти как гость
      connectAsGuest(room, hostId);
    } else {
      statusElem.textContent = 'Ошибка подключения: ' + err.message;
      leaveRoom(false);
    }
  });

  peer.on('disconnected', () => {
    statusElem.textContent = 'Отключено от сервера.';
  });
}

// Подключение в роли гостя
function connectAsGuest(room, hostId) {
  const guestId = `room-${room}-${Math.random().toString(36).substring(2, 7)}`;
  peer = new Peer(guestId, peerConfig);

  peer.on('open', () => {
    statusElem.textContent = `Подключение к владельцу комнаты «${room}»...`;
    const call = peer.call(hostId, localStream);
    currentCall = call;
    handleStream(call);
    fetchRooms();
  });

  peer.on('error', () => {
    statusElem.textContent = 'Не удалось подключиться: комната уже заполнена (2/2).';
    leaveRoom(false);
  });
}

// Обработка видеопотока собеседника
function handleStream(call) {
  call.on('stream', (stream) => {
    remoteVideo.srcObject = stream;
    statusElem.textContent = 'Связь установлена (2/2)!';
  });

  call.on('close', () => {
    remoteVideo.srcObject = null;
    statusElem.textContent = 'Собеседник вышел. Ожидание подключения...';
    fetchRooms();
  });
}

// Корректный выход из комнаты
function leaveRoom(updateStatus = true) {
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }

  if (peer) {
    peer.destroy();
    peer = null;
  }

  remoteVideo.srcObject = null;
  currentRoom = null;

  window.history.pushState({}, '', window.location.pathname);
  setUIState(false);

  if (updateStatus) {
    statusElem.textContent = 'Вы вышли из комнаты.';
  }

  fetchRooms();
}

// Переключение состояния кнопок и инпута
function setUIState(isInRoom) {
  if (isInRoom) {
    joinBtn.style.display = 'none';
    leaveBtn.style.display = 'inline-block';
    roomInput.disabled = true;
  } else {
    joinBtn.style.display = 'inline-block';
    leaveBtn.style.display = 'none';
    roomInput.disabled = false;
  }
}

joinBtn.addEventListener('click', () => joinRoom(roomInput.value));
leaveBtn.addEventListener('click', () => leaveRoom(true));

roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom(roomInput.value);
});

initCamera();
