const socket = io();
let isAdmin = false;
let roomCode = '';
let playerName = '';
let selectedPlayerId = null;

// Elementi UI
const loginScreen = document.getElementById('login-screen');
const adminScreen = document.getElementById('admin-screen');
const playerScreen = document.getElementById('player-screen');
const numberPopup = document.getElementById('number-popup');

const nameInput = document.getElementById('name-input');
const roomCodeInput = document.getElementById('room-code-input');
const passwordInput = document.getElementById('password-input');
const joinBtn = document.getElementById('join-btn');
const adminLoginBtn = document.getElementById('admin-login-btn');

const adminRoomCode = document.getElementById('admin-room-code');
const startGameBtn = document.getElementById('start-game-btn');
const extractBtn = document.getElementById('extract-btn');
const autoExtractBtn = document.getElementById('auto-extract-btn');
const stopAutoBtn = document.getElementById('stop-auto-btn');
const playersList = document.getElementById('players-list');
const removePlayerBtn = document.getElementById('remove-player-btn');

const playerNameEl = document.getElementById('player-name');
const playerRoomCode = document.getElementById('player-room-code');
const bingoCard = document.getElementById('bingo-card');
const extractedNumbers = document.getElementById('extracted-numbers');
const popupNumbers = document.getElementById('popup-numbers');

// Event listeners
joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const code = roomCodeInput.value.trim();
    
    if (name && code) {
        playerName = name;
        roomCode = code;
        socket.emit('joinRoom', roomCode, playerName, (response) => {
            if (response.success) {
                showPlayerScreen();
            } else {
                alert(response.message);
            }
        });
    }
});

adminLoginBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const code = roomCodeInput.value.trim();
    const password = passwordInput.value.trim();
    
    if (name && code && password) {
        playerName = name;
        roomCode = code;
        socket.emit('createRoom', playerName, password, (response) => {
            if (response.success) {
                isAdmin = response.isAdmin;
                showAdminScreen();
            } else {
                alert(response.message);
            }
        });
    }
});

startGameBtn.addEventListener('click', () => {
    socket.emit('startExtraction', roomCode);
});

extractBtn.addEventListener('click', () => {
    socket.emit('extractManual', roomCode);
});

autoExtractBtn.addEventListener('click', () => {
    socket.emit('toggleAutoExtraction', roomCode, true);
    autoExtractBtn.classList.add('hidden');
    stopAutoBtn.classList.remove('hidden');
});

stopAutoBtn.addEventListener('click', () => {
    socket.emit('toggleAutoExtraction', roomCode, false);
    stopAutoBtn.classList.add('hidden');
    autoExtractBtn.classList.remove('hidden');
});

removePlayerBtn.addEventListener('click', () => {
    if (selectedPlayerId) {
        socket.emit('removePlayer', roomCode, selectedPlayerId);
        selectedPlayerId = null;
        removePlayerBtn.classList.add('hidden');
    }
});

// Funzioni UI
function showAdminScreen() {
    loginScreen.classList.add('hidden');
    adminScreen.classList.remove('hidden');
    playerScreen.classList.add('hidden');
    
    adminRoomCode.textContent = roomCode;
}

function showPlayerScreen() {
    loginScreen.classList.add('hidden');
    playerScreen.classList.remove('hidden');
    adminScreen.classList.add('hidden');
    
    playerRoomCode.textContent = roomCode;
    playerNameEl.textContent = `Giocatore: ${playerName}`;
    generateBingoCard();
}

function generateBingoCard() {
    const card = document.createElement('div');
    card.className = 'bingo-card';
    
    for (let row = 0; row < 3; row++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'bingo-row';
        
        for (let col = 0; col < 9; col++) {
            const cell = document.createElement('div');
            cell.className = 'bingo-cell';
            cell.textContent = Math.floor(Math.random() * 90) + 1;
            rowEl.appendChild(cell);
        }
        
        card.appendChild(rowEl);
    }
    
    bingoCard.innerHTML = '';
    bingoCard.appendChild(card);
}

// Socket event handlers
socket.on('roomUpdate', (data) => {
    if (isAdmin) {
        updatePlayersList(data.players);
    }
});

socket.on('gameStarted', () => {
    if (isAdmin) {
        startGameBtn.disabled = true;
    }
});

socket.on('numberExtracted', (number) => {
    showNumberPopup(number);
    updateExtractedNumbers(number);
});

socket.on('line', (number) => {
    alert(`LINEA! Il numero ${number} completa una linea!`);
});

socket.on('bingo', (number) => {
    alert(`TOMBOLA! Il numero ${number} completa la tombola!`);
});

socket.on('gameWon', (data) => {
    alert(`VINCITORE: ${data.winner} con il numero ${data.number}!`);
});

// UI updates
function updatePlayersList(players) {
    playersList.innerHTML = '';
    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.name;
        li.addEventListener('click', () => {
            selectedPlayerId = player.id;
            removePlayerBtn.classList.remove('hidden');
        });
        playersList.appendChild(li);
    });
}

function showNumberPopup(number) {
    popupNumbers.innerHTML = '';
    const numbers = Array.from({length: 10}, (_, i) => number + i - 5);
    numbers.forEach(num => {
        if (num >= 1 && num <= 90) {
            const span = document.createElement('span');
            span.textContent = num;
            popupNumbers.appendChild(span);
        }
    });
    
    numberPopup.classList.remove('hidden');
    setTimeout(() => {
        numberPopup.classList.add('hidden');
    }, 2000);
}

function updateExtractedNumbers(number) {
    const span = document.createElement('span');
    span.textContent = number;
    extractedNumbers.appendChild(span);
}
