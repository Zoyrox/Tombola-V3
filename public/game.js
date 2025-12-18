/**
 * Sistema di gioco per il giocatore Tombola
 */

class TombolaGame {
    constructor() {
        this.socket = null;
        this.roomCode = null;
        this.playerId = null;
        this.playerName = null;
        this.playerCard = [];
        this.extractedNumbers = [];
        this.players = [];
        this.gameActive = false;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        
        // Stato gioco
        this.foundNumbers = [];
        this.score = 0;
        this.lastNumber = null;
        
        // Audio
        this.sounds = {
            number: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-game-ball-tap-2073.mp3'),
            win: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-winning-chimes-2015.mp3'),
            join: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3'),
            error: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-wrong-answer-fail-notification-946.mp3')
        };
        
        // Configura audio
        Object.values(this.sounds).forEach(sound => {
            sound.volume = 0.3;
            sound.preload = 'auto';
        });
        
        this.init();
    }
    
    init() {
        this.loadPlayerData();
        this.bindEvents();
        this.connectSocket();
        this.setupAutoReconnect();
        this.setupUI();
    }
    
    loadPlayerData() {
        try {
            const playerData = JSON.parse(localStorage.getItem('tombola_player')) || 
                              JSON.parse(sessionStorage.getItem('tombola_player'));
            
            if (playerData) {
                this.playerId = playerData.id;
                this.playerName = playerData.name;
                this.roomCode = playerData.roomCode;
                
                // Aggiorna UI
                document.getElementById('player-name-display').textContent = this.playerName;
                document.getElementById('player-avatar').textContent = this.playerName.charAt(0).toUpperCase();
                document.getElementById('room-code-value').textContent = this.roomCode;
                
                return true;
            }
        } catch (e) {
            console.error('Errore caricamento dati giocatore:', e);
        }
        
        // Se non ci sono dati, torna alla home
        setTimeout(() => {
            if (!this.playerId) {
                window.location.href = '/';
            }
        }, 2000);
        
        return false;
    }
    
    bindEvents() {
        // Eventi UI
        document.getElementById('btn-new-card').addEventListener('click', () => {
            this.requestNewCard();
        });
        
        document.getElementById('btn-print-card').addEventListener('click', () => {
            this.printCard();
        });
        
        document.getElementById('btn-view-all-numbers').addEventListener('click', () => {
            this.showAllNumbersModal();
        });
        
        document.getElementById('btn-view-leaderboard').addEventListener('click', () => {
            this.showLeaderboardModal();
        });
        
        document.getElementById('btn-send-chat').addEventListener('click', () => {
            this.sendChatMessage();
        });
        
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });
        
        // Fullscreen
        document.addEventListener('fullscreenchange', () => {
            const btn = document.getElementById('btn-fullscreen');
            if (btn) {
                btn.innerHTML = document.fullscreenElement ? 
                    '<i class="fas fa-compress"></i> Esci fullscreen' : 
                    '<i class="fas fa-expand"></i> Schermo intero';
            }
        });
        
        // Click su numeri della cartella
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('tombola-cell')) {
                this.toggleNumberMark(e.target);
            }
        });
        
        // Modal close buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-close') || 
                e.target.classList.contains('modal')) {
                this.closeAllModals();
            }
        });
        
        // Escape per chiudere modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });
    }
    
    setupUI() {
        // Nascondi loading screen dopo 1.5s
        setTimeout(() => {
            document.getElementById('loading-screen').classList.remove('active');
            document.getElementById('player-screen').classList.add('active');
        }, 1500);
        
        // Genera cartella vuota iniziale
        this.generateEmptyBoard();
    }
    
    connectSocket() {
        if (!this.roomCode || !this.playerName) {
            console.error('Dati mancanti per la connessione');
            return;
        }
        
        this.socket = io({
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        });
        
        // Eventi Socket
        this.socket.on('connect', () => {
            console.log('Connesso al server');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.updateConnectionStatus(true);
            
            // Invia join request
            this.socket.emit('player:join', {
                roomCode: this.roomCode,
                playerName: this.playerName,
                playerId: this.playerId
            });
            
            // Play join sound
            this.playSound('join');
        });
        
        this.socket.on('player:joined', (data) => {
            console.log('Giocatore unito:', data);
            
            // Salva ID assegnato dal server
            this.playerId = data.playerId;
            
            // Aggiorna dati locali
            const playerData = {
                id: this.playerId,
                name: this.playerName,
                roomCode: this.roomCode,
                joinedAt: new Date().toISOString()
            };
            
            localStorage.setItem('tombola_player', JSON.stringify(playerData));
            
            // Imposta cartella
            this.playerCard = data.card || [];
            this.renderPlayerCard();
            
            // Aggiorna lista giocatori
            this.players = data.players || [];
            this.updatePlayersList();
            
            // Aggiorna numeri estratti
            this.extractedNumbers = data.extractedNumbers || [];
            this.updateExtractedNumbers();
            
            // Aggiorna stato gioco
            this.gameActive = data.gameActive || false;
            this.updateGameStatus();
            
            this.showNotification(`Benvenuto in "${data.roomName}"!`, 'success');
        });
        
        this.socket.on('game:number-extracted', (data) => {
            console.log('Numero estratto:', data.number);
            
            this.lastNumber = data.number;
            this.extractedNumbers.push(data.number);
            
            // Mostra popup
            this.showNumberPopup(data.number);
            
            // Play sound
            this.playSound('number');
            
            // Aggiorna UI
            this.updateExtractedNumbers();
            this.updateLastNumber();
            this.checkNumberOnCard(data.number);
            
            // Aggiorna progresso
            this.updateScore();
        });
        
        this.socket.on('game:status-changed', (data) => {
            this.gameActive = data.gameActive;
            this.updateGameStatus();
            
            const message = this.gameActive ? 
                'La partita è iniziata! Preparati!' : 
                'La partita è stata fermata';
            
            this.showNotification(message, this.gameActive ? 'success' : 'warning');
        });
        
        this.socket.on('game:auto-extract-changed', (data) => {
            const message = data.enabled ? 
                `Auto-estrazione attivata (${data.interval/1000}s)` : 
                'Auto-estrazione disattivata';
            
            this.showNotification(message, data.enabled ? 'info' : 'warning');
        });
        
        this.socket.on('game:winner', (data) => {
            console.log('Vincitore:', data);
            
            // Mostra notifica speciale per vincitore
            if (data.playerId === this.playerId) {
                this.showWinnerNotification('TU', data.prize);
                this.playSound('win');
            } else {
                this.showWinnerNotification(data.playerName, data.prize);
            }
            
            // Aggiorna classifica
            this.updateLeaderboard();
        });
        
        this.socket.on('room:players-updated', (data) => {
            this.players = data.players;
            this.updatePlayersList();
            this.updateLeaderboard();
        });
        
        this.socket.on('room:settings-updated', (settings) => {
            console.log('Impostazioni aggiornate:', settings);
            // Puoi aggiornare UI in base alle nuove impostazioni
        });
        
        this.socket.on('chat:new-message', (message) => {
            this.addChatMessage(message);
        });
        
        this.socket.on('player:error', (data) => {
            this.showNotification(data.message, 'error');
            this.playSound('error');
        });
        
        this.socket.on('player:kicked', (data) => {
            this.showNotification('Sei stato espulso dalla stanza', 'error');
            setTimeout(() => {
                window.location.href = '/';
            }, 3000);
        });
        
        this.socket.on('room:closed', (data) => {
            this.showNotification('La stanza è stata chiusa', 'error');
            setTimeout(() => {
                window.location.href = '/';
            }, 3000);
        });
        
        this.socket.on('admin:disconnected', (data) => {
            this.showNotification('L\'admin si è disconnesso', 'warning');
        });
        
        this.socket.on('admin:changed', (data) => {
            this.showNotification('Nuovo admin della stanza', 'info');
        });
        
        this.socket.on('disconnect', (reason) => {
            console.log('Disconnesso:', reason);
            this.isConnected = false;
            this.updateConnectionStatus(false);
            
            if (reason === 'io server disconnect') {
                // Server ha forzato la disconnessione
                this.showNotification('Disconnesso dal server', 'error');
            }
        });
        
        this.socket.on('reconnect', (attemptNumber) => {
            console.log('Riconnesso dopo', attemptNumber, 'tentativi');
            this.isConnected = true;
            this.updateConnectionStatus(true);
            this.showNotification('Riconnesso al server', 'success');
        });
        
        this.socket.on('reconnect_error', (error) => {
            console.log('Errore riconnessione:', error);
            this.reconnectAttempts++;
            
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.showNotification('Impossibile riconnettersi al server', 'error');
            }
        });
        
        this.socket.on('reconnect_failed', () => {
            this.showNotification('Connessione persa. Ricarica la pagina.', 'error');
        });
        
        this.socket.on('pong', (data) => {
            // Risposta al ping, connessione attiva
            this.updateLatency(Date.now() - data.timestamp);
        });
    }
    
    setupAutoReconnect() {
        // Ping ogni 30 secondi per mantenere connessione attiva
        setInterval(() => {
            if (this.socket?.connected) {
                this.socket.emit('ping', { timestamp: Date.now() });
            }
        }, 30000);
    }
    
    // ===== GESTIONE CARTELLA =====
    
    generateEmptyBoard() {
        const board = document.getElementById('tombola-board');
        if (!board) return;
        
        board.innerHTML = '';
        
        for (let i = 1; i <= 90; i++) {
            const cell = document.createElement('div');
            cell.className = 'tombola-cell';
            cell.textContent = i;
            cell.dataset.number = i;
            
            // Tooltip
            cell.title = `Numero ${i}`;
            
            board.appendChild(cell);
        }
    }
    
    renderPlayerCard() {
        const board = document.getElementById('tombola-board');
        if (!board || !this.playerCard.length) return;
        
        // Resetta tutte le celle
        const cells = board.querySelectorAll('.tombola-cell');
        cells.forEach(cell => {
            cell.classList.remove('my-number', 'found');
        });
        
        // Evidenzia numeri della cartella
        this.playerCard.forEach(number => {
            const cell = board.querySelector(`[data-number="${number}"]`);
            if (cell) {
                cell.classList.add('my-number');
            }
        });
        
        // Evidenzia numeri già trovati
        this.foundNumbers.forEach(number => {
            const cell = board.querySelector(`[data-number="${number}"]`);
            if (cell) {
                cell.classList.add('found');
            }
        });
        
        // Aggiorna info cartella
        document.getElementById('card-numbers-info').textContent = 
            `${this.playerCard.length} numeri (${this.foundNumbers.length} trovati)`;
    }
    
    checkNumberOnCard(number) {
        if (!this.playerCard.includes(number)) {
            return false;
        }
        
        // Aggiungi ai numeri trovati se non già presente
        if (!this.foundNumbers.includes(number)) {
            this.foundNumbers.push(number);
            
            // Evidenzia cella
            const cell = document.querySelector(`[data-number="${number}"]`);
            if (cell) {
                cell.classList.add('found');
                
                // Animazione
                cell.style.animation = 'pulse 0.5s';
                setTimeout(() => {
                    cell.style.animation = '';
                }, 500);
            }
            
            // Aggiorna punteggio
            this.updateScore();
            
            // Notifica
            if (this.foundNumbers.length === 15) {
                this.notifyTombola();
            } else if (this.foundNumbers.length === 2) {
                this.showNotification('Ambo! 🎯', 'success');
            } else if (this.foundNumbers.length === 3) {
                this.showNotification('Terno! 🎯🎯', 'success');
            }
            
            return true;
        }
        
        return false;
    }
    
    toggleNumberMark(cell) {
        const number = parseInt(cell.dataset.number);
        
        if (!this.playerCard.includes(number)) {
            this.showNotification('Questo numero non è nella tua cartella', 'warning');
            return;
        }
        
        if (this.foundNumbers.includes(number)) {
            // Rimuovi dal trovato
            const index = this.foundNumbers.indexOf(number);
            this.foundNumbers.splice(index, 1);
            cell.classList.remove('found');
        } else {
            // Aggiungi al trovato
            this.foundNumbers.push(number);
            cell.classList.add('found');
        }
        
        this.updateScore();
    }
    
    updateScore() {
        this.score = this.foundNumbers.length;
        
        // Aggiorna UI
        document.getElementById('player-score').textContent = this.score;
        document.getElementById('player-progress-text').textContent = `${this.score}/15`;
        
        // Progress bar
        const progress = (this.score / 15) * 100;
        document.getElementById('player-progress').style.width = `${progress}%`;
        
        // Cambia colore progress bar in base al progresso
        const progressBar = document.getElementById('player-progress');
        progressBar.className = 'progress-bar';
        
        if (progress >= 100) {
            progressBar.classList.add('bg-success');
        } else if (progress >= 66) {
            progressBar.classList.add('bg-warning');
        } else if (progress >= 33) {
            progressBar.classList.add('bg-info');
        } else {
            progressBar.classList.add('bg-primary');
        }
    }
    
    // ===== RICHIESTE AL SERVER =====
    
    requestNewCard() {
        if (!this.socket?.connected) {
            this.showNotification('Non connesso al server', 'error');
            return;
        }
        
        if (this.gameActive) {
            this.showNotification('Non puoi cambiare cartella durante la partita', 'warning');
            return;
        }
        
        if (confirm('Vuoi davvero una nuova cartella? Perderai i progressi attuali.')) {
            // Reset stato locale
            this.playerCard = [];
            this.foundNumbers = [];
            this.score = 0;
            
            // Richiedi nuova cartella al server
            this.socket.emit('player:request-new-card');
            
            this.showNotification('Nuova cartella richiesta...', 'info');
        }
    }
    
    sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (!message) return;
        
        if (!this.socket?.connected) {
            this.showNotification('Non connesso al server', 'error');
            return;
        }
        
        // Invia messaggio
        this.socket.emit('chat:message', {
            message,
            type: 'player'
        });
        
        // Aggiungi al chat locale (ottimisticamente)
        this.addChatMessage({
            sender: this.playerName,
            senderId: this.playerId,
            senderType: 'player',
            message,
            timestamp: new Date()
        });
        
        // Pulisci input
        input.value = '';
        input.focus();
    }
    
    // ===== UI UPDATES =====
    
    updatePlayersList() {
        const container = document.getElementById('players-list-mini');
        const onlineCount = this.players.filter(p => p.isOnline).length;
        
        document.getElementById('players-count').textContent = this.players.length;
        document.getElementById('online-count').textContent = onlineCount;
        
        if (!container) return;
        
        if (this.players.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-user-friends"></i>
                    <p>Nessun altro giocatore online</p>
                </div>
            `;
            return;
        }
        
        // Mostra solo primi 5 giocatori nella mini-lista
        const topPlayers = this.players
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
        
        container.innerHTML = topPlayers.map(player => `
            <div class="player-mini-item ${player.isOnline ? 'online' : 'offline'}">
                <div class="player-mini-avatar">
                    ${player.name.charAt(0).toUpperCase()}
                </div>
                <div class="player-mini-info">
                    <div class="player-mini-name">
                        ${player.name}
                        ${player.id === this.playerId ? ' (TU)' : ''}
                    </div>
                    <div class="player-mini-score">
                        ${player.score}/15 punti
                    </div>
                </div>
                <div class="player-mini-status">
                    <div class="status-dot ${player.isOnline ? 'online' : 'offline'}"></div>
                </div>
            </div>
        `).join('');
    }
    
    updateExtractedNumbers() {
        const container = document.getElementById('extracted-numbers-mini');
        
        document.getElementById('extracted-count').textContent = this.extractedNumbers.length;
        document.getElementById('extracted-total').textContent = this.extractedNumbers.length;
        
        if (!container) return;
        
        if (this.extractedNumbers.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-hourglass-start"></i>
                    <p>Nessun numero estratto ancora</p>
                </div>
            `;
            return;
        }
        
        // Mostra ultimi 6 numeri
        const lastNumbers = this.extractedNumbers.slice(-6).reverse();
        
        container.innerHTML = lastNumbers.map(number => `
            <div class="extracted-number-mini ${this.playerCard.includes(number) ? 'my-number' : ''}">
                ${number}
            </div>
        `).join('');
    }
    
    updateGameStatus() {
        const statusElement = document.getElementById('game-status');
        if (!statusElement) return;
        
        if (this.gameActive) {
            statusElement.innerHTML = '<i class="fas fa-play-circle"></i> Partita in corso';
            statusElement.className = 'game-status-badge active';
        } else {
            statusElement.innerHTML = '<i class="fas fa-clock"></i> In attesa';
            statusElement.className = 'game-status-badge waiting';
        }
    }
    
    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connection-status');
        if (!statusElement) return;
        
        if (connected) {
            statusElement.innerHTML = '<i class="fas fa-wifi"></i> Connesso';
            statusElement.className = 'connected';
        } else {
            statusElement.innerHTML = '<i class="fas fa-wifi-slash"></i> Disconnesso';
            statusElement.className = 'disconnected';
        }
    }
    
    updateLastNumber() {
        if (this.lastNumber) {
            document.getElementById('last-number-value').textContent = this.lastNumber;
        }
    }
    
    updateLatency(latency) {
        // Puoi mostrare la latenza nell'UI se vuoi
        // console.log(`Latency: ${latency}ms`);
    }
    
    // ===== MODAL =====
    
    showAllNumbersModal() {
        const modal = document.getElementById('numbers-modal');
        const grid = document.getElementById('all-numbers-grid');
        
        if (!modal || !grid) return;
        
        // Popola la griglia
        grid.innerHTML = '';
        
        for (let i = 1; i <= 90; i++) {
            const numberDiv = document.createElement('div');
            numberDiv.className = 'all-number-cell';
            numberDiv.textContent = i;
            
            // Evidenzia se estratto
            if (this.extractedNumbers.includes(i)) {
                numberDiv.classList.add('extracted');
                
                // Evidenzia se nella tua cartella
                if (this.playerCard.includes(i)) {
                    numberDiv.classList.add('my-number');
                    
                    // Evidenzia se trovato
                    if (this.foundNumbers.includes(i)) {
                        numberDiv.classList.add('found');
                    }
                }
            }
            
            grid.appendChild(numberDiv);
        }
        
        // Mostra modal
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
    
    showLeaderboardModal() {
        const modal = document.getElementById('leaderboard-modal');
        const tbody = modal.querySelector('tbody');
        
        if (!modal || !tbody) return;
        
        // Ordina giocatori per punteggio
        const sortedPlayers = [...this.players].sort((a, b) => b.score - a.score);
        
        // Popola tabella
        tbody.innerHTML = sortedPlayers.map((player, index) => `
            <tr class="${player.id === this.playerId ? 'current-player' : ''}">
                <td>
                    ${index + 1}
                    ${index < 3 ? ['🥇', '🥈', '🥉'][index] : ''}
                </td>
                <td>
                    <div class="player-leaderboard-info">
                        <div class="player-leaderboard-avatar">
                            ${player.name.charAt(0).toUpperCase()}
                        </div>
                        <div class="player-leaderboard-name">
                            ${player.name}
                            ${player.id === this.playerId ? ' (TU)' : ''}
                            <div class="player-leaderboard-status ${player.isOnline ? 'online' : 'offline'}">
                                ${player.isOnline ? 'Online' : 'Offline'}
                            </div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="leaderboard-score">
                        ${player.score}/15
                        <div class="progress" style="height: 4px; width: 60px; margin-top: 4px;">
                            <div class="progress-bar" style="width: ${(player.score / 15) * 100}%"></div>
                        </div>
                    </div>
                </td>
                <td>
                    ${player.matches ? player.matches.join(', ') : 'Nessuno'}
                </td>
            </tr>
        `).join('');
        
        // Mostra modal
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
    
    updateLeaderboard() {
        // Aggiorna solo se il modal è aperto
        const modal = document.getElementById('leaderboard-modal');
        if (modal.style.display === 'block') {
            this.showLeaderboardModal();
        }
    }
    
    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
        document.body.style.overflow = '';
    }
    
    // ===== NOTIFICHE E POPUP =====
    
    showNumberPopup(number) {
        const container = document.querySelector('.number-popup-container');
        if (!container) return;
        
        const popup = document.createElement('div');
        popup.className = 'number-popup';
        popup.innerHTML = `
            <div class="number-popup-content">
                <div class="number-popup-number">${number}</div>
                <div class="number-popup-label">NUMERO ESTRATTO</div>
                <div class="number-popup-info">
                    ${this.extractedNumbers.length}/90 • 
                    ${this.playerCard.includes(number) ? 'Nella tua cartella! ✅' : 'Non nella tua cartella'}
                </div>
            </div>
        `;
        
        container.appendChild(popup);
        
        // Rimuovi dopo 2.5 secondi
        setTimeout(() => {
            popup.classList.add('fade-out');
            setTimeout(() => {
                if (popup.parentNode) {
                    popup.remove();
                }
            }, 300);
        }, 2500);
    }
    
    showNotification(message, type = 'info') {
        const container = document.querySelector('.notification-container');
        if (!container) return;
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-icon">
                <i class="fas fa-${this.getIconForType(type)}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close">&times;</button>
        `;
        
        container.appendChild(notification);
        
        // Auto-remove
        setTimeout(() => {
            notification.classList.add('hiding');
            setTimeout(() => notification.remove(), 300);
        }, 5000);
        
        // Close button
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.classList.add('hiding');
            setTimeout(() => notification.remove(), 300);
        });
    }
    
    showWinnerNotification(winnerName, prize) {
        const container = document.querySelector('.notification-container');
        if (!container) return;
        
        const notification = document.createElement('div');
        notification.className = 'notification winner';
        notification.innerHTML = `
            <div class="notification-icon">
                <i class="fas fa-trophy"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">🎉 ${prize.toUpperCase()} 🎉</div>
                <div class="notification-message">
                    <strong>${winnerName}</strong> ha fatto ${prize}!
                </div>
            </div>
            <div class="confetti">🎊</div>
        `;
        
        container.appendChild(notification);
        
        // Rimuovi dopo 10 secondi
        setTimeout(() => {
            notification.classList.add('hiding');
            setTimeout(() => notification.remove(), 300);
        }, 10000);
    }
    
    notifyTombola() {
        // Mostra notifica speciale per tombola
        this.showWinnerNotification('TU', 'TOMBOLA');
        
        // Riproduci suono vittoria
        this.playSound('win');
        
        // Animazione speciale
        document.querySelectorAll('.tombola-cell.found').forEach(cell => {
            cell.style.animation = 'celebrate 1s infinite';
            setTimeout(() => {
                cell.style.animation = '';
            }, 3000);
        });
    }
    
    getIconForType(type) {
        switch (type) {
            case 'success': return 'check-circle';
            case 'error': return 'exclamation-circle';
            case 'warning': return 'exclamation-triangle';
            case 'info': return 'info-circle';
            default: return 'info-circle';
        }
    }
    
    // ===== UTILITY =====
    
    playSound(soundName) {
        const sound = this.sounds[soundName];
        if (!sound) return;
        
        // Controlla se i suoni sono abilitati
        const soundBtn = document.getElementById('btn-toggle-sound');
        const soundsEnabled = !soundBtn || !soundBtn.innerHTML.includes('OFF');
        
        if (soundsEnabled && sound) {
            sound.currentTime = 0;
            sound.play().catch(e => {
                console.log('Audio non riprodotto:', e.message);
            });
        }
    }
    
    printCard() {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Cartella Tombola - ${this.playerName}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    .print-card { max-width: 800px; margin: 0 auto; }
                    .print-header { text-align: center; margin-bottom: 20px; }
                    .print-grid { 
                        display: grid; 
                        grid-template-columns: repeat(10, 1fr); 
                        gap: 5px; 
                        margin: 20px 0;
                    }
                    .print-cell { 
                        aspect-ratio: 1; 
                        border: 1px solid #333; 
                        display: flex; 
                        align-items: center; 
                        justify-content: center;
                        font-weight: bold;
                    }
                    .print-cell.my-number { background: #e3f2fd; }
                    .print-info { margin-top: 20px; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <div class="print-card">
                    <div class="print-header">
                        <h1>Cartella Tombola</h1>
                        <p><strong>Giocatore:</strong> ${this.playerName}</p>
                        <p><strong>Stanza:</strong> ${this.roomCode}</p>
                        <p><strong>Data:</strong> ${new Date().toLocaleDateString()}</p>
                    </div>
                    <div class="print-grid">
                        ${Array.from({ length: 90 }, (_, i) => {
                            const num = i + 1;
                            const isMyNumber = this.playerCard.includes(num);
                            const isFound = this.foundNumbers.includes(num);
                            return `
                                <div class="print-cell ${isMyNumber ? 'my-number' : ''}">
                                    ${num}
                                    ${isFound ? '✓' : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="print-info">
                        <p><strong>Numeri della cartella:</strong> ${this.playerCard.join(', ')}</p>
                        <p><strong>Numeri trovati:</strong> ${this.foundNumbers.join(', ') || 'Nessuno'}</p>
                        <p><strong>Punteggio:</strong> ${this.score}/15</p>
                        <p>Stampa generata da Tombola Online</p>
                    </div>
                </div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    }
    
    // ===== GESTIONE ERRORI =====
    
    handleError(error) {
        console.error('Game error:', error);
        
        this.showNotification(
            error.message || 'Si è verificato un errore',
            'error'
        );
        
        this.playSound('error');
    }
}
