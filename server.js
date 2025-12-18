const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurazioni
const PORT = process.env.PORT || 3000;
const SUPER_ADMINS = JSON.parse(process.env.SUPER_ADMINS || '[]');

// Sistema di logging migliorato
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`)
};

// Memorizzazione dati in memoria (per produzione usare Redis)
const rooms = new Map();        // roomCode -> roomData
const adminCodes = new Map();   // code -> {createdBy, createdAt, used}
const userSessions = new Map(); // socketId -> userData
const playerCards = new Map();  // socketId -> cardNumbers

// API Routes
// Verifica super admin
app.post('/api/auth/super-admin', (req, res) => {
  const { username, password } = req.body;
  const admin = SUPER_ADMINS.find(a => a.username === username && a.password === password);
  
  if (admin) {
    const token = crypto.randomBytes(32).toString('hex');
    res.json({ 
      success: true, 
      token,
      username: admin.username 
    });
  } else {
    res.status(401).json({ success: false, message: 'Credenziali non valide' });
  }
});

// Crea nuovo codice admin
app.post('/api/admin/create', (req, res) => {
  const { token, code, maxRooms = 5 } = req.body;
  
  // Verifica token (semplice)
  if (!token || token.length !== 64) {
    return res.status(403).json({ success: false, message: 'Token non valido' });
  }
  
  if (adminCodes.has(code)) {
    return res.status(400).json({ success: false, message: 'Codice già esistente' });
  }
  
  adminCodes.set(code, {
    createdBy: 'super-admin',
    createdAt: new Date(),
    maxRooms: parseInt(maxRooms),
    used: 0,
    activeRooms: []
  });
  
  logger.info(`Nuovo codice admin creato: ${code}`);
  res.json({ success: true, message: `Codice admin "${code}" creato con successo` });
});

// Verifica codice admin
app.post('/api/admin/verify', (req, res) => {
  const { code } = req.body;
  const adminData = adminCodes.get(code);
  
  if (!adminData) {
    return res.json({ valid: false, message: 'Codice non valido' });
  }
  
  if (adminData.used >= adminData.maxRooms) {
    return res.json({ valid: false, message: 'Limite stanze raggiunto' });
  }
  
  res.json({ 
    valid: true, 
    maxRooms: adminData.maxRooms,
    used: adminData.used 
  });
});

// Ottieni statistiche stanze
app.get('/api/rooms/stats', (req, res) => {
  const stats = {
    totalRooms: rooms.size,
    activeRooms: Array.from(rooms.values()).filter(r => r.players.length > 0).length,
    totalPlayers: Array.from(rooms.values()).reduce((sum, room) => sum + room.players.length, 0),
    recentRooms: Array.from(rooms.entries()).slice(-10).map(([code, room]) => ({
      code,
      players: room.players.length,
      gameActive: room.gameActive
    }))
  };
  res.json(stats);
});

// WebSocket Events
io.on('connection', (socket) => {
  logger.info(`Nuova connessione: ${socket.id}`);
  
  // Admin crea/entra in stanza
  socket.on('admin:create-room', async ({ adminCode, roomCode, roomName }) => {
    try {
      // Verifica codice admin
      const adminData = adminCodes.get(adminCode);
      if (!adminData || adminData.used >= adminData.maxRooms) {
        socket.emit('admin:error', { message: 'Codice admin non valido o limite raggiunto' });
        return;
      }
      
      const normalizedCode = roomCode.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
      
      if (!rooms.has(normalizedCode)) {
        rooms.set(normalizedCode, {
          code: normalizedCode,
          name: roomName || `Stanza ${normalizedCode}`,
          adminId: socket.id,
          adminCode: adminCode,
          players: [],
          spectators: [],
          extractedNumbers: [],
          gameActive: false,
          autoExtract: false,
          settings: {
            autoExtractInterval: 6000,
            allowSpectators: true,
            maxPlayers: 50,
            gameMode: 'tombola' // 'tombola', 'tombolino', 'ambo', 'terno', etc.
          },
          createdAt: new Date(),
          lastActivity: new Date()
        });
        
        adminData.used++;
        adminData.activeRooms.push(normalizedCode);
        logger.info(`Stanza creata: ${normalizedCode} da admin ${adminCode}`);
      }
      
      const room = rooms.get(normalizedCode);
      room.adminId = socket.id;
      room.lastActivity = new Date();
      
      socket.join(normalizedCode);
      socket.roomCode = normalizedCode;
      socket.userType = 'admin';
      
      userSessions.set(socket.id, {
        type: 'admin',
        roomCode: normalizedCode,
        adminCode: adminCode,
        joinedAt: new Date()
      });
      
      // Invia dati stanza all'admin
      socket.emit('admin:room-created', {
        roomCode: normalizedCode,
        roomName: room.name,
        players: room.players,
        extractedNumbers: room.extractedNumbers,
        gameActive: room.gameActive,
        settings: room.settings
      });
      
      // Notifica cambio admin (se c'era già un admin)
      socket.to(normalizedCode).emit('admin:changed', { newAdmin: socket.id });
      
    } catch (error) {
      logger.error(`Errore creazione stanza: ${error.message}`);
      socket.emit('admin:error', { message: 'Errore interno del server' });
    }
  });
  
  // Giocatore entra in stanza
  socket.on('player:join', ({ roomCode, playerName, playerId }) => {
    const normalizedCode = roomCode.toUpperCase();
    const room = rooms.get(normalizedCode);
    
    if (!room) {
      socket.emit('player:error', { message: 'Stanza non trovata' });
      return;
    }
    
    if (room.players.length >= room.settings.maxPlayers) {
      socket.emit('player:error', { message: 'Stanza piena' });
      return;
    }
    
    // Genera ID univoco se non fornito (per riconnessione)
    const actualPlayerId = playerId || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Genera carta tombola per il giocatore
    const cardNumbers = generateTombolaCard();
    
    const player = {
      id: actualPlayerId,
      socketId: socket.id,
      name: playerName.trim().substring(0, 20),
      card: cardNumbers,
      score: 0,
      matches: [],
      joinedAt: new Date(),
      lastSeen: new Date(),
      isOnline: true
    };
    
    room.players.push(player);
    playerCards.set(socket.id, cardNumbers);
    
    socket.join(normalizedCode);
    socket.roomCode = normalizedCode;
    socket.playerId = actualPlayerId;
    socket.userType = 'player';
    
    userSessions.set(socket.id, {
      type: 'player',
      roomCode: normalizedCode,
      playerId: actualPlayerId,
      playerName: player.name,
      joinedAt: new Date()
    });
    
    // Invia dati al giocatore
    socket.emit('player:joined', {
      playerId: actualPlayerId,
      roomCode: normalizedCode,
      roomName: room.name,
      card: cardNumbers,
      players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
      extractedNumbers: room.extractedNumbers,
      gameActive: room.gameActive
    });
    
    // Notifica a tutti i giocatori
    io.to(normalizedCode).emit('room:players-updated', {
      players: room.players.map(p => ({ 
        id: p.id, 
        name: p.name, 
        score: p.score,
        isOnline: p.isOnline
      })),
      totalPlayers: room.players.length
    });
    
    // Notifica specifica all'admin
    socket.to(room.adminId).emit('admin:player-joined', {
      playerId: actualPlayerId,
      playerName: player.name,
      totalPlayers: room.players.length
    });
    
    logger.info(`Giocatore ${player.name} entrato in ${normalizedCode}`);
  });
  
  // Admin estrae numero
  socket.on('admin:extract-number', () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    
    if (!room || socket.id !== room.adminId) {
      socket.emit('admin:error', { message: 'Non autorizzato' });
      return;
    }
    
    if (room.extractedNumbers.length >= 90) {
      socket.emit('game:finished', { message: 'Tutti i numeri estratti!' });
      return;
    }
    
    const number = extractUniqueNumber(room.extractedNumbers);
    room.extractedNumbers.push(number);
    room.lastActivity = new Date();
    
    // Controlla vincite
    checkWins(roomCode, number);
    
    // Invia a tutti
    io.to(roomCode).emit('game:number-extracted', {
      number,
      extractedCount: room.extractedNumbers.length,
      totalNumbers: 90,
      timestamp: new Date()
    });
    
    // Aggiorna admin
    socket.emit('admin:number-extracted', {
      number,
      extractedNumbers: room.extractedNumbers,
      winners: room.players.filter(p => p.score >= 15)
    });
    
    logger.info(`Numero ${number} estratto in ${roomCode}`);
  });
  
  // Admin avvia/ferma estrazione automatica
  socket.on('admin:toggle-auto-extract', ({ enabled, interval }) => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    
    if (!room || socket.id !== room.adminId) return;
    
    room.autoExtract = enabled;
    room.settings.autoExtractInterval = interval || 6000;
    
    io.to(roomCode).emit('game:auto-extract-changed', { 
      enabled, 
      interval: room.settings.autoExtractInterval 
    });
    
    // Gestione intervallo automatico
    if (enabled && !room.autoExtractInterval) {
      room.autoExtractInterval = setInterval(() => {
        if (room.autoExtract && room.gameActive) {
          socket.emit('admin:extract-number');
        }
      }, room.settings.autoExtractInterval);
    } else if (!enabled && room.autoExtractInterval) {
      clearInterval(room.autoExtractInterval);
      room.autoExtractInterval = null;
    }
  });
  
  // Admin rimuove giocatore
  socket.on('admin:remove-player', ({ playerId }) => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    
    if (!room || socket.id !== room.adminId) return;
    
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;
    
    const player = room.players[playerIndex];
    room.players.splice(playerIndex, 1);
    
    // Disconnetti il giocatore
    const playerSocket = io.sockets.sockets.get(player.socketId);
    if (playerSocket) {
      playerSocket.emit('player:kicked', { reason: 'Rimosso dall\'admin' });
      playerSocket.disconnect();
    }
    
    io.to(roomCode).emit('room:players-updated', {
      players: room.players.map(p => ({ 
        id: p.id, 
        name: p.name, 
        score: p.score 
      })),
      totalPlayers: room.players.length
    });
    
    logger.info(`Giocatore ${player.name} rimosso da ${roomCode}`);
  });
  
  // Admin inizia/ferma partita
  socket.on('admin:toggle-game', ({ enabled }) => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    
    if (!room || socket.id !== room.adminId) return;
    
    room.gameActive = enabled;
    io.to(roomCode).emit('game:status-changed', { 
      gameActive: enabled,
      timestamp: new Date()
    });
    
    if (enabled) {
      logger.info(`Partita iniziata in ${roomCode}`);
    } else {
      logger.info(`Partita fermata in ${roomCode}`);
    }
  });
  
  // Admin cambia impostazioni
  socket.on('admin:update-settings', (settings) => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    
    if (!room || socket.id !== room.adminId) return;
    
    Object.assign(room.settings, settings);
    room.lastActivity = new Date();
    
    io.to(roomCode).emit('room:settings-updated', room.settings);
    socket.emit('admin:settings-updated', { success: true });
  });
  
  // Chat
  socket.on('chat:message', ({ message, type = 'player' }) => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const userData = userSessions.get(socket.id);
    const userName = userData?.playerName || 'Admin';
    
    const chatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sender: userName,
      senderId: socket.id,
      senderType: userData?.type || 'unknown',
      message: message.substring(0, 500),
      type,
      timestamp: new Date()
    };
    
    io.to(roomCode).emit('chat:new-message', chatMessage);
  });
  
  // Ping per mantenere connessione
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });
  
  // Disconnessione
  socket.on('disconnect', () => {
    const userData = userSessions.get(socket.id);
    if (!userData) return;
    
    const { type, roomCode, playerId } = userData;
    const room = rooms.get(roomCode);
    
    if (room) {
      room.lastActivity = new Date();
      
      if (type === 'admin' && socket.id === room.adminId) {
        // Admin disconnesso - cerca nuovo admin o chiudi stanza
        room.adminId = null;
        io.to(roomCode).emit('admin:disconnected', { 
          message: 'L\'admin si è disconnesso',
          timestamp: new Date()
        });
        
        // Chiudi stanza dopo 5 minuti senza admin
        setTimeout(() => {
          if (!room.adminId) {
            io.to(roomCode).emit('room:closed', { message: 'Stanza chiusa per inattività' });
            rooms.delete(roomCode);
            logger.info(`Stanza ${roomCode} chiusa per inattività admin`);
          }
        }, 5 * 60 * 1000);
        
      } else if (type === 'player') {
        // Segna giocatore come offline
        const player = room.players.find(p => p.id === playerId);
        if (player) {
          player.isOnline = false;
          player.lastSeen = new Date();
          
          io.to(roomCode).emit('room:players-updated', {
            players: room.players.map(p => ({ 
              id: p.id, 
              name: p.name, 
              score: p.score,
              isOnline: p.isOnline
            }))
          });
        }
      }
    }
    
    userSessions.delete(socket.id);
    playerCards.delete(socket.id);
    logger.info(`Disconnesso: ${socket.id} (${type})`);
  });
});

// Funzioni helper
function generateTombolaCard() {
  const numbers = new Set();
  while (numbers.size < 15) {
    numbers.add(Math.floor(Math.random() * 90) + 1);
  }
  return Array.from(numbers).sort((a, b) => a - b);
}

function extractUniqueNumber(extracted) {
  if (extracted.length >= 90) return null;
  
  let number;
  const maxAttempts = 100;
  let attempts = 0;
  
  do {
    number = Math.floor(Math.random() * 90) + 1;
    attempts++;
    if (attempts > maxAttempts) {
      // Fallback: prendi il primo numero non estratto
      for (let i = 1; i <= 90; i++) {
        if (!extracted.includes(i)) return i;
      }
      return null;
    }
  } while (extracted.includes(number));
  
  return number;
}

function checkWins(roomCode, extractedNumber) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  room.players.forEach(player => {
    if (player.card.includes(extractedNumber)) {
      player.matches.push(extractedNumber);
      player.score = player.matches.length;
      
      // Controlla vincite
      if (player.score === 15) {
        io.to(roomCode).emit('game:winner', {
          playerId: player.id,
          playerName: player.name,
          score: player.score,
          matches: player.matches,
          prize: 'Tombola!',
          timestamp: new Date()
        });
      } else if (player.score === 2 && room.settings.gameMode === 'ambo') {
        io.to(roomCode).emit('game:winner', {
          playerId: player.id,
          playerName: player.name,
          score: player.score,
          matches: player.matches,
          prize: 'Ambo!',
          timestamp: new Date()
        });
      }
    }
  });
}

// Pulizia stanze inattive ogni ora
setInterval(() => {
  const now = new Date();
  const inactiveTimeout = 2 * 60 * 60 * 1000; // 2 ore
  
  for (const [roomCode, room] of rooms.entries()) {
    if (now - room.lastActivity > inactiveTimeout && room.players.length === 0) {
      rooms.delete(roomCode);
      logger.info(`Stanza ${roomCode} rimossa per inattività`);
    }
  }
}, 60 * 60 * 1000); // Ogni ora

// Avvio server
server.listen(PORT, () => {
  logger.info(`🚀 Server Tombola Online in ascolto sulla porta ${PORT}`);
  logger.info(`👑 Super Admin configurati: ${SUPER_ADMINS.length}`);
  logger.info(`📊 Stanze attive: ${rooms.size}`);
});