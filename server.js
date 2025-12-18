const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const dotenv = require('dotenv');
const adminConfig = require('./public/admin-config');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Dati della partita
let rooms = {};
let roomCodes = new Set();

// Genera codice stanza
function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (roomCodes.has(code));
    roomCodes.add(code);
    return code;
}

// Crea stanza
function createRoom(adminSocket, adminName) {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
        code: roomCode,
        admin: adminSocket.id,
        adminName: adminName,
        players: [],
        numbers: [],
        isStarted: false,
        extractedNumbers: [],
        autoExtraction: false,
        extractionInterval: null
    };
    adminSocket.join(roomCode);
    return roomCode;
}

// Aggiungi giocatore
function addPlayer(roomCode, playerName, socket) {
    if (!rooms[roomCode]) return false;
    
    const room = rooms[roomCode];
    if (room.isStarted) return false;
    
    const player = {
        id: socket.id,
        name: playerName,
        socket: socket,
        card: generateBingoCard()
    };
    
    room.players.push(player);
    socket.join(roomCode);
    return true;
}

// Genera tabella tombola
function generateBingoCard() {
    const card = Array(3).fill().map(() => Array(9).fill(null));
    const numbers = [];
    
    for (let col = 0; col < 9; col++) {
        const start = col * 10 + 1;
        const end = start + 9;
        const colNumbers = Array.from({length: 10}, (_, i) => start + i);
        numbers.push(colNumbers);
    }
    
    // Riempimento tabella
    for (let row = 0; row < 3; row++) {
        const availableCols = [0, 1, 2, 3, 4, 5, 6, 7, 8];
        for (let i = 0; i < 5; i++) {
            const randomIndex = Math.floor(Math.random() * availableCols.length);
            const col = availableCols[randomIndex];
            availableCols.splice(randomIndex, 1);
            
            const colNumbers = numbers[col];
            const randomNumIndex = Math.floor(Math.random() * colNumbers.length);
            card[row][col] = colNumbers[randomNumIndex];
            colNumbers.splice(randomNumIndex, 1);
        }
    }
    
    return card;
}

// Estrazione numero
function extractNumber(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.isStarted === false) return;
    
    let number;
    do {
        number = Math.floor(Math.random() * 90) + 1;
    } while (room.extractedNumbers.includes(number));
    
    room.extractedNumbers.push(number);
    
    // Notifica tutti i giocatori
    io.to(roomCode).emit('numberExtracted', number);
    
    // Controlla vincite
    checkWinners(roomCode, number);
}

// Controlla vincite
function checkWinners(roomCode, lastNumber) {
    const room = rooms[roomCode];
    if (!room) return;
    
    room.players.forEach(player => {
        const hasLine = checkLine(player.card, room.extractedNumbers);
        const hasBingo = checkBingo(player.card, room.extractedNumbers);
        
        if (hasLine) {
            player.socket.emit('line', lastNumber);
        }
        if (hasBingo) {
            player.socket.emit('bingo', lastNumber);
            io.to(roomCode).emit('gameWon', {
                winner: player.name,
                number: lastNumber
            });
            stopGame(roomCode);
        }
    });
}

// Controlla linea
function checkLine(card, extractedNumbers) {
    for (let row = 0; row < 3; row++) {
        let lineComplete = true;
        for (let col = 0; col < 9; col++) {
            if (card[row][col] !== null && !extractedNumbers.includes(card[row][col])) {
                lineComplete = false;
                break;
            }
        }
        if (lineComplete) return true;
    }
    return false;
}

// Controlla tombola
function checkBingo(card, extractedNumbers) {
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 9; col++) {
            if (card[row][col] !== null && !extractedNumbers.includes(card[row][col])) {
                return false;
            }
        }
    }
    return true;
}

// Stop gioco
function stopGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    room.isStarted = false;
    if (room.extractionInterval) {
        clearInterval(room.extractionInterval);
        room.extractionInterval = null;
    }
    room.autoExtraction = false;
}

// Socket.io connection
io.on('connection', (socket) => {
    console.log('Utente connesso:', socket.id);
    
    // Creazione stanza (admin)
    socket.on('createRoom', (adminName, password, callback) => {
        if (password === SUPER_ADMIN_PASSWORD) {
            const roomCode = createRoom(socket, adminName);
            callback({ success: true, roomCode, isAdmin: true });
        } else if (password === ADMIN_PASSWORD) {
            const roomCode = createRoom(socket, adminName);
            callback({ success: true, roomCode, isAdmin: false });
        } else {
            callback({ success: false, message: 'Password errata' });
        }
    });
    
    // Unione stanza
    socket.on('joinRoom', (roomCode, playerName, callback) => {
        if (rooms[roomCode]) {
            const success = addPlayer(roomCode, playerName, socket);
            if (success) {
                const room = rooms[roomCode];
                callback({ success: true, roomCode });
                
                // Invia info stanza a tutti
                io.to(roomCode).emit('roomUpdate', {
                    players: room.players.map(p => ({ name: p.name, id: p.id })),
                    extractedNumbers: room.extractedNumbers,
                    isStarted: room.isStarted
                });
            } else {
                callback({ success: false, message: 'Partita già iniziata' });
            }
        } else {
            callback({ success: false, message: 'Stanza non trovata' });
        }
    });
    
    // Rimozione giocatore (solo admin)
    socket.on('removePlayer', (roomCode, playerId) => {
        const room = rooms[roomCode];
        if (room && room.admin === socket.id) {
            room.players = room.players.filter(p => p.id !== playerId);
            io.to(roomCode).emit('roomUpdate', {
                players: room.players.map(p => ({ name: p.name, id: p.id })),
                extractedNumbers: room.extractedNumbers,
                isStarted: room.isStarted
            });
        }
    });
    
    // Inizio estrazione (admin)
    socket.on('startExtraction', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.admin === socket.id) {
            room.isStarted = true;
            io.to(roomCode).emit('gameStarted');
        }
    });
    
    // Estrazione manuale (admin)
    socket.on('extractManual', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.admin === socket.id && room.isStarted) {
            extractNumber(roomCode);
        }
    });
    
    // Estrazione automatica (admin)
    socket.on('toggleAutoExtraction', (roomCode, enabled) => {
        const room = rooms[roomCode];
        if (room && room.admin === socket.id && room.isStarted) {
            room.autoExtraction = enabled;
            
            if (enabled) {
                room.extractionInterval = setInterval(() => {
                    extractNumber(roomCode);
                }, 6000);
            } else {
                clearInterval(room.extractionInterval);
                room.extractionInterval = null;
            }
        }
    });
    
    // Disconnessione
    socket.on('disconnect', () => {
        console.log('Utente disconnesso:', socket.id);
        
        // Trova e rimuovi giocatore da stanze
        Object.keys(rooms).forEach(roomCode => {
            const room = rooms[roomCode];
            room.players = room.players.filter(p => p.id !== socket.id);
            
            if (room.admin === socket.id) {
                // Admin disconnesso, chiudi stanza
                stopGame(roomCode);
                delete rooms[roomCode];
                roomCodes.delete(roomCode);
            } else {
                io.to(roomCode).emit('roomUpdate', {
                    players: room.players.map(p => ({ name: p.name, id: p.id })),
                    extractedNumbers: room.extractedNumbers,
                    isStarted: room.isStarted
                });
            }
        });
    });
});

// Servi file statici
app.use(express.static('public'));

server.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
});
