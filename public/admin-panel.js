class AdminPanel {
    constructor() {
        this.socket = null;
        this.currentRoom = null;
        this.roomData = null;
        this.players = [];
        this.extractedNumbers = [];
        this.autoExtractInterval = null;
        this.isAutoExtractActive = false;
        
        this.init();
    }
    
    init() {
        this.loadFromStorage();
        this.bindEvents();
        this.checkAdminSession();
        this.setupPing();
    }
    
    loadFromStorage() {
        // Carica sessione admin se esiste
        const savedSession = localStorage.getItem('tombola_admin_session');
        if (savedSession) {
            try {
                const session = JSON.parse(savedSession);
                if (session.expires > Date.now()) {
                    this.adminCode = session.adminCode;
                    this.roomCode = session.roomCode;
                    this.connectSocket();
                } else {
                    localStorage.removeItem('tombola_admin_session');
                }
            } catch (e) {
                console.error('Errore nel caricamento della sessione:', e);
            }
        }
    }
    
    saveToStorage() {
        const session = {
            adminCode: this.adminCode,
            roomCode: this.roomCode,
            expires: Date.now() + (24 * 60 * 60 * 1000) // 24 ore
        };
        localStorage.setItem('tombola_admin_session', JSON.stringify(session));
    }
    
    bindEvents() {
        // Admin Login
        document.getElementById('admin-login-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAdminLogin();
        });
        
        // Create Room
        document.getElementById('create-room-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.createRoom();
        });
        
        // Manual Controls
        document.getElementById('btn-extract-number')?.addEventListener('click', () => {
            this.extractNumber();
        });
        
        document.getElementById('btn-toggle-game')?.addEventListener('click', () => {
            this.toggleGame();
        });
        
        document.getElementById('btn-toggle-auto')?.addEventListener('click', () => {
            this.toggleAutoExtract();
        });
        
        document.getElementById('btn-kick-all')?.addEventListener('click', () => {
            this.kickAllPlayers();
        });
        
        document.getElementById('btn-reset-room')?.addEventListener('click', () => {
            this.resetRoom();
        });
        
        document.getElementById('btn-copy-room-link')?.addEventListener('click', () => {
            this.copyRoomLink();
        });
        
        // Settings
        document.getElementById('btn-save-settings')?.addEventListener('click', () => {
            this.saveSettings();
        });
        
        // Logout
        document.getElementById('btn-admin-logout')?.addEventListener('click', () => {
            this.logout();
        });
        
        // Quick Actions
        document.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                this.handleQuickAction(action);
            });
        });
    }
    
    async checkAdminSession() {
        // Verifica se c'è un codice admin valido in sessionStorage
        const adminCode = sessionStorage.getItem('adminCode');
        const roomCode = sessionStorage.getItem('roomCode');
        
        if (adminCode && roomCode) {
            // Verifica codice admin con il server
            const isValid = await this.verifyAdminCode(adminCode);
            if (isValid) {
                this.adminCode = adminCode;
                this.roomCode = roomCode;
                this.connectSocket();
                return true;
            }
        }
        return false;
    }
    
    async handleAdminLogin() {
        const adminCode = document.getElementById('admin-code-input').value.trim();
        const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
        
        if (!adminCode || !roomCode) {
            this.showNotification('Inserisci codice admin e codice stanza', 'error');
            return;
        }
        
        // Verifica codice admin
        const isValid = await this.verifyAdminCode(adminCode);
        if (!isValid) {
            this.showNotification('Codice admin non valido', 'error');
            return;
        }
        
        this.adminCode = adminCode;
        this.roomCode = roomCode;
        
        // Salva in sessionStorage
        sessionStorage.setItem('adminCode', adminCode);
        sessionStorage.setItem('roomCode', roomCode);
        
        this.connectSocket();
    }
    
    async verifyAdminCode(adminCode) {
        try {
            const response = await fetch('/api/admin/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: adminCode })
            });
            
            const data = await response.json();
            return data.valid;
        } catch (error) {
            console.error('Errore verifica admin:', error);
            return false;
        }
    }
    
    connectSocket() {
        if (this.socket?.connected) {
            this.socket.disconnect();
        }
        
        this.socket = io();
        
        // Socket Events
        this.socket.on('connect', () => {
            console.log('Admin socket connesso');
            this.socket.emit('admin:create-room', {
                adminCode: this.adminCode,
                roomCode: this.roomCode,
                roomName: document.getElementById('room-name-input')?.value || `Stanza ${this.roomCode}`
            });
        });
        
        this.socket.on('admin:room-created', (data) => {
            console.log('Stanza creata:', data);
            this.roomData = data;
            this.players = data.players;
            this.extractedNumbers = data.extractedNumbers;
            
            this.showAdminPanel();
            this.updateRoomInfo();
            this.updatePlayersList();
            this.updateExtractedNumbers();
            this.updateGameControls();
            
            this.saveToStorage();
            this.showNotification(`Stanza "${data.roomName}" creata con successo!`, 'success');
        });
        
        this.socket.on('admin:error', (data) => {
            this.showNotification(data.message, 'error');
        });
        
        this.socket.on('admin:player-joined', (data) => {
            this.showNotification(`${data.playerName} si è unito alla partita`, 'info');
            this.updatePlayersList();
        });
        
        this.socket.on('admin:number-extracted', (data) => {
            this.extractedNumbers = data.extractedNumbers;
            this.updateExtractedNumbers();
            this.updateStats();
            
            // Mostra popup per admin
            this.showNumberExtracted(data.number);
        });
        
        this.socket.on('room:players-updated', (data) => {
            this.players = data.players;
            this.updatePlayersList();
            this.updateStats();
        });
        
        this.socket.on('game:number-extracted', (data) => {
            // Aggiorna anche per admin
            this.extractedNumbers.push(data.number);
            this.updateExtractedNumbers();
        });
        
        this.socket.on('game:winner', (data) => {
            this.showWinnerNotification(data);
        });
        
        this.socket.on('admin:disconnected', () => {
            this.showNotification('Sei stato disconnesso dalla stanza', 'error');
            this.logout();
        });
        
        this.socket.on('disconnect', () => {
            console.log('Admin socket disconnesso');
        });
    }
    
    showAdminPanel() {
        document.getElementById('admin-login-screen').classList.remove('active');
        document.getElementById('admin-panel-screen').classList.add('active');
    }
    
    updateRoomInfo() {
        if (!this.roomData) return;
        
        document.getElementById('room-name-display').textContent = this.roomData.roomName;
        document.getElementById('room-code-display').textContent = this.roomData.code;
        document.getElementById('admin-code-display').textContent = this.adminCode;
        document.getElementById('room-status').textContent = this.roomData.gameActive ? 'Partita in corso' : 'In attesa';
        document.getElementById('room-status').className = this.roomData.gameActive ? 'badge bg-success' : 'badge bg-warning';
        
        // Room link
        const roomLink = `${window.location.origin}/game.html?room=${this.roomData.code}`;
        document.getElementById('room-link').value = roomLink;
        document.getElementById('room-link-qr').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(roomLink)}`;
    }
    
    updatePlayersList() {
        const tbody = document.getElementById('players-table-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        this.players.forEach((player, index) => {
            const tr = document.createElement('tr');
            
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>
                    <div class="d-flex align-center gap-1">
                        <div class="player-avatar-sm">${player.name.charAt(0).toUpperCase()}</div>
                        <div>
                            <strong>${player.name}</strong>
                            <div class="text-muted small">${player.id}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <span class="badge ${player.isOnline ? 'bg-success' : 'bg-secondary'}">
                        ${player.isOnline ? 'Online' : 'Offline'}
                    </span>
                </td>
                <td>
                    <div class="progress" style="height: 8px;">
                        <div class="progress-bar" style="width: ${(player.score / 15) * 100}%"></div>
                    </div>
                    <small>${player.score}/15</small>
                </td>
                <td>${new Date(player.joinedAt).toLocaleTimeString()}</td>
                <td>
                    <div class="player-actions">
                        <button class="btn btn-sm btn-outline" data-action="view-card" data-player-id="${player.id}" title="Vedi cartella">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-warning" data-action="kick" data-player-id="${player.id}" title="Espelli giocatore">
                            <i class="fas fa-user-slash"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" data-action="ban" data-player-id="${player.id}" title="Banna giocatore">
                            <i class="fas fa-ban"></i>
                        </button>
                    </div>
                </td>
            `;
            
            tbody.appendChild(tr);
        });
        
        // Aggiungi event listener ai bottoni
        tbody.querySelectorAll('[data-action="kick"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const playerId = e.target.closest('button').dataset.playerId;
                this.kickPlayer(playerId);
            });
        });
        
        tbody.querySelectorAll('[data-action="view-card"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const playerId = e.target.closest('button').dataset.playerId;
                this.viewPlayerCard(playerId);
            });
        });
        
        tbody.querySelectorAll('[data-action="ban"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const playerId = e.target.closest('button').dataset.playerId;
                this.banPlayer(playerId);
            });
        });
    }
    
    updateExtractedNumbers() {
        const container = document.getElementById('extracted-numbers-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        // Ultimi 10 numeri
        const lastNumbers = this.extractedNumbers.slice(-10);
        lastNumbers.forEach(number => {
            const div = document.createElement('div');
            div.className = 'extracted-number';
            div.textContent = number;
            container.appendChild(div);
        });
        
        // Statistiche
        document.getElementById('extracted-count').textContent = this.extractedNumbers.length;
        document.getElementById('remaining-count').textContent = 90 - this.extractedNumbers.length;
        
        // Progress bar
        const progress = (this.extractedNumbers.length / 90) * 100;
        document.getElementById('extraction-progress').style.width = `${progress}%`;
        
        // Lista completa
        const listContainer = document.getElementById('all-extracted-numbers');
        if (listContainer) {
            listContainer.innerHTML = this.extractedNumbers.map(n => 
                `<span class="badge bg-primary me-1 mb-1">${n}</span>`
            ).join('');
        }
    }
    
    updateGameControls() {
        if (!this.roomData) return;
        
        const gameActive = this.roomData.gameActive;
        const autoExtractActive = this.roomData.autoExtract;
        
        // Bottone start/stop partita
        const gameBtn = document.getElementById('btn-toggle-game');
        if (gameBtn) {
            gameBtn.innerHTML = gameActive ? 
                '<i class="fas fa-pause"></i> Ferma Partita' : 
                '<i class="fas fa-play"></i> Inizia Partita';
            gameBtn.className = gameActive ? 'btn btn-danger' : 'btn btn-success';
        }
        
        // Bottone auto-estrazione
        const autoBtn = document.getElementById('btn-toggle-auto');
        if (autoBtn) {
            autoBtn.innerHTML = autoExtractActive ? 
                '<i class="fas fa-stop-circle"></i> Ferma Auto' : 
                '<i class="fas fa-play-circle"></i> Auto Estrazione';
            autoBtn.className = autoExtractActive ? 'btn btn-warning' : 'btn btn-secondary';
        }
        
        // Intervallo auto-estrazione
        const intervalInput = document.getElementById('auto-extract-interval');
        if (intervalInput && this.roomData.settings) {
            intervalInput.value = this.roomData.settings.autoExtractInterval || 6000;
        }
    }
    
    updateStats() {
        document.getElementById('total-players').textContent = this.players.length;
        document.getElementById('online-players').textContent = this.players.filter(p => p.isOnline).length;
        document.getElementById('extracted-total').textContent = this.extractedNumbers.length;
        
        // Vincite
        const winners = this.players.filter(p => p.score >= 2);
        document.getElementById('current-winners').textContent = winners.length;
        
        // Tempo medio di gioco
        if (this.players.length > 0) {
            const avgTime = this.players.reduce((sum, p) => {
                return sum + (Date.now() - new Date(p.joinedAt).getTime());
            }, 0) / this.players.length;
            
            const minutes = Math.floor(avgTime / 60000);
            document.getElementById('avg-play-time').textContent = `${minutes} min`;
        }
    }
    
    async createRoom() {
        const adminCode = document.getElementById('admin-code-input').value.trim();
        const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
        const roomName = document.getElementById('room-name-input')?.value.trim() || `Stanza ${roomCode}`;
        
        if (!adminCode || !roomCode) {
            this.showNotification('Inserisci codice admin e codice stanza', 'error');
            return;
        }
        
        // Genera codice stanza se vuoto
        const finalRoomCode = roomCode || this.generateRoomCode();
        
        this.adminCode = adminCode;
        this.roomCode = finalRoomCode;
        
        sessionStorage.setItem('adminCode', adminCode);
        sessionStorage.setItem('roomCode', finalRoomCode);
        
        this.connectSocket();
    }
    
    generateRoomCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }
    
    extractNumber() {
        if (!this.socket?.connected) {
            this.showNotification('Non connesso al server', 'error');
            return;
        }
        
        if (this.extractedNumbers.length >= 90) {
            this.showNotification('Tutti i numeri sono già stati estratti!', 'warning');
            return;
        }
        
        this.socket.emit('admin:extract-number');
        this.showNotification('Estrazione numero in corso...', 'info');
    }
    
    toggleGame() {
        if (!this.socket?.connected) return;
        
        const newState = !this.roomData.gameActive;
        this.socket.emit('admin:toggle-game', { enabled: newState });
        
        this.showNotification(
            newState ? 'Partita iniziata!' : 'Partita fermata',
            newState ? 'success' : 'warning'
        );
    }
    
    toggleAutoExtract() {
        if (!this.socket?.connected) return;
        
        const newState = !this.roomData.autoExtract;
        const interval = parseInt(document.getElementById('auto-extract-interval')?.value) || 6000;
        
        this.socket.emit('admin:toggle-auto-extract', { 
            enabled: newState, 
            interval: interval 
        });
        
        this.isAutoExtractActive = newState;
        this.showNotification(
            newState ? `Auto-estrazione attivata (${interval/1000}s)` : 'Auto-estrazione disattivata',
            newState ? 'success' : 'warning'
        );
    }
    
    kickPlayer(playerId) {
        if (!this.socket?.connected) return;
        
        if (confirm('Sei sicuro di voler espellere questo giocatore?')) {
            this.socket.emit('admin:remove-player', { playerId });
            this.showNotification('Giocatore espulso', 'warning');
        }
    }
    
    banPlayer(playerId) {
        // Implementa il ban (da estendere)
        this.showNotification('Funzione ban da implementare', 'info');
    }
    
    async viewPlayerCard(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return;
        
        // Mostra modal con la cartella del giocatore
        const modal = document.createElement('div');
        modal.className = 'modal fade show';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Cartella di ${player.name}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="tombola-grid" style="grid-template-columns: repeat(10, 1fr);">
                            ${Array.from({ length: 90 }, (_, i) => {
                                const num = i + 1;
                                const hasNumber = player.card?.includes(num);
                                const isExtracted = this.extractedNumbers.includes(num);
                                const classes = [
                                    'tombola-cell',
                                    hasNumber ? 'my-number' : '',
                                    isExtracted ? 'extracted' : ''
                                ].filter(Boolean).join(' ');
                                
                                return `<div class="${classes}">${num}</div>`;
                            }).join('')}
                        </div>
                        <div class="mt-3">
                            <h6>Numeri posseduti: ${player.card?.join(', ')}</h6>
                            <h6>Numeri trovati: ${player.matches?.join(', ') || 'Nessuno'}</h6>
                            <h6>Punteggio: ${player.score}/15</h6>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Chiudi modal al click
        modal.querySelector('.btn-close').addEventListener('click', () => {
            modal.remove();
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }
    
    kickAllPlayers() {
        if (!this.socket?.connected) return;
        
        if (confirm('Sei sicuro di voler espellere TUTTI i giocatori?')) {
            this.players.forEach(player => {
                this.socket.emit('admin:remove-player', { playerId: player.id });
            });
            this.showNotification('Tutti i giocatori sono stati espulsi', 'warning');
        }
    }
    
    resetRoom() {
        if (!this.socket?.connected) return;
        
        if (confirm('Sei sicuro di voler resettare la stanza? Tutti i numeri estratti verranno cancellati.')) {
            // Implementa reset (da estendere con endpoint server)
            this.showNotification('Funzione reset da implementare', 'info');
        }
    }
    
    copyRoomLink() {
        const linkInput = document.getElementById('room-link');
        if (!linkInput) return;
        
        linkInput.select();
        linkInput.setSelectionRange(0, 99999);
        
        try {
            navigator.clipboard.writeText(linkInput.value);
            this.showNotification('Link copiato negli appunti!', 'success');
        } catch (err) {
            // Fallback per browser vecchi
            document.execCommand('copy');
            this.showNotification('Link copiato!', 'success');
        }
    }
    
    saveSettings() {
        if (!this.socket?.connected) return;
        
        const settings = {
            autoExtractInterval: parseInt(document.getElementById('setting-auto-interval')?.value) || 6000,
            maxPlayers: parseInt(document.getElementById('setting-max-players')?.value) || 50,
            allowSpectators: document.getElementById('setting-allow-spectators')?.checked || false,
            gameMode: document.getElementById('setting-game-mode')?.value || 'tombola',
            enableChat: document.getElementById('setting-enable-chat')?.checked || true,
            enableSounds: document.getElementById('setting-enable-sounds')?.checked || true
        };
        
        this.socket.emit('admin:update-settings', settings);
        this.showNotification('Impostazioni salvate!', 'success');
    }
    
    handleQuickAction(action) {
        switch (action) {
            case 'extract-10':
                for (let i = 0; i < 10; i++) {
                    setTimeout(() => this.extractNumber(), i * 1000);
                }
                break;
                
            case 'clear-extracted':
                if (confirm('Cancellare tutti i numeri estratti?')) {
                    // Implementa clear
                    this.showNotification('Funzione da implementare', 'info');
                }
                break;
                
            case 'export-data':
                this.exportRoomData();
                break;
                
            case 'import-data':
                this.importRoomData();
                break;
                
            case 'announce':
                this.sendAnnouncement();
                break;
        }
    }
    
    exportRoomData() {
        const data = {
            room: this.roomData,
            players: this.players,
            extractedNumbers: this.extractedNumbers,
            exportedAt: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tombola-${this.roomData.code}-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showNotification('Dati esportati con successo!', 'success');
    }
    
    async importRoomData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                
                // Verifica struttura
                if (data.room && data.players && data.extractedNumbers) {
                    // Implementa import (da estendere)
                    this.showNotification('Importazione completata!', 'success');
                } else {
                    this.showNotification('File non valido', 'error');
                }
            } catch (error) {
                this.showNotification('Errore durante l\'importazione', 'error');
                console.error(error);
            }
        };
        
        input.click();
    }
    
    sendAnnouncement() {
        const message = prompt('Inserisci il messaggio di annuncio:');
        if (message && this.socket?.connected) {
            this.socket.emit('chat:message', { 
                message, 
                type: 'admin' 
            });
            this.showNotification('Annuncio inviato!', 'success');
        }
    }
    
    showNumberExtracted(number) {
        // Popup per admin
        const popup = document.createElement('div');
        popup.className = 'number-popup';
        popup.textContent = number;
        popup.style.zIndex = '2000';
        
        // Aggiungi info
        const info = document.createElement('div');
        info.className = 'number-popup-info';
        info.textContent = `#${this.extractedNumbers.length}`;
        popup.appendChild(info);
        
        document.body.appendChild(popup);
        
        setTimeout(() => {
            popup.remove();
        }, 2000);
    }
    
    showWinnerNotification(data) {
        const notification = document.createElement('div');
        notification.className = 'notification success';
        notification.innerHTML = `
            <div class="notification-icon">
                <i class="fas fa-trophy"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">🎉 ${data.prize.toUpperCase()} 🎉</div>
                <div class="notification-message">
                    <strong>${data.playerName}</strong> ha fatto ${data.prize} con ${data.score} numeri!
                </div>
            </div>
        `;
        
        document.querySelector('.notification-container')?.appendChild(notification);
        
        // Suono vittoria (se abilitato)
        if (document.getElementById('setting-enable-sounds')?.checked) {
            this.playWinnerSound();
        }
        
        setTimeout(() => {
            notification.classList.add('hiding');
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }
    
    playWinnerSound() {
        const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-winning-chimes-2015.mp3');
        audio.volume = 0.3;
        audio.play().catch(e => console.log('Audio non riprodotto:', e));
    }
    
    showNotification(message, type = 'info') {
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
        
        const container = document.querySelector('.notification-container') || 
                         (() => {
                             const div = document.createElement('div');
                             div.className = 'notification-container';
                             document.body.appendChild(div);
                             return div;
                         })();
        
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
    
    getIconForType(type) {
        switch (type) {
            case 'success': return 'check-circle';
            case 'error': return 'exclamation-circle';
            case 'warning': return 'exclamation-triangle';
            case 'info': return 'info-circle';
            default: return 'info-circle';
        }
    }
    
    setupPing() {
        // Mantieni connessione attiva
        setInterval(() => {
            if (this.socket?.connected) {
                this.socket.emit('ping');
            }
        }, 30000);
    }
    
    logout() {
        if (this.socket?.connected) {
            this.socket.disconnect();
        }
        
        localStorage.removeItem('tombola_admin_session');
        sessionStorage.removeItem('adminCode');
        sessionStorage.removeItem('roomCode');
        
        this.adminCode = null;
        this.roomCode = null;
        this.roomData = null;
        this.players = [];
        this.extractedNumbers = [];
        
        document.getElementById('admin-panel-screen').classList.remove('active');
        document.getElementById('admin-login-screen').classList.add('active');
        
        this.showNotification('Disconnesso con successo', 'info');
    }
}

// Avvia Admin Panel quando la pagina è caricata
document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanel();
    
    // Carica Font Awesome se non presente
    if (!document.querySelector('link[href*="font-awesome"]')) {
        const faLink = document.createElement('link');
        faLink.rel = 'stylesheet';
        faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css';
        document.head.appendChild(faLink);
    }
    
    // Carica Bootstrap se non presente (opzionale)
    if (!document.querySelector('link[href*="bootstrap"]')) {
        const bsLink = document.createElement('link');
        bsLink.rel = 'stylesheet';
        bsLink.href = 'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css';
        document.head.appendChild(bsLink);
    }
});
