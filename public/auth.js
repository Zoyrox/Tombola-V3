/**
 * Sistema di autenticazione per Tombola Online
 */

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.token = null;
        this.isSuperAdmin = false;
        this.init();
    }
    
    init() {
        this.loadSession();
        this.bindEvents();
    }
    
    loadSession() {
        try {
            const session = localStorage.getItem('tombola_session');
            if (session) {
                const data = JSON.parse(session);
                if (data.expires > Date.now()) {
                    this.currentUser = data.user;
                    this.token = data.token;
                    this.isSuperAdmin = data.isSuperAdmin || false;
                    return true;
                } else {
                    this.clearSession();
                }
            }
        } catch (e) {
            console.error('Errore caricamento sessione:', e);
            this.clearSession();
        }
        return false;
    }
    
    saveSession(user, token, isSuperAdmin = false, expiresInHours = 24) {
        const session = {
            user,
            token,
            isSuperAdmin,
            expires: Date.now() + (expiresInHours * 60 * 60 * 1000)
        };
        
        localStorage.setItem('tombola_session', JSON.stringify(session));
        this.currentUser = user;
        this.token = token;
        this.isSuperAdmin = isSuperAdmin;
    }
    
    clearSession() {
        localStorage.removeItem('tombola_session');
        localStorage.removeItem('tombola_admin_session');
        sessionStorage.clear();
        this.currentUser = null;
        this.token = null;
        this.isSuperAdmin = false;
    }
    
    bindEvents() {
        // Logout button
        document.addEventListener('click', (e) => {
            if (e.target.matches('[data-action="logout"]') || 
                e.target.closest('[data-action="logout"]')) {
                this.logout();
            }
        });
    }
    
    async loginSuperAdmin(username, password) {
        try {
            const response = await fetch('/api/auth/super-admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.saveSession(
                    { username, role: 'super-admin' },
                    data.token,
                    true,
                    12 // 12 ore per super admin
                );
                return { success: true, data };
            } else {
                return { 
                    success: false, 
                    error: data.message || 'Credenziali non valide' 
                };
            }
        } catch (error) {
            console.error('Login super admin error:', error);
            return { 
                success: false, 
                error: 'Errore di connessione al server' 
            };
        }
    }
    
    async createAdminCode(token, adminCode, maxRooms = 5) {
        try {
            const response = await fetch('/api/admin/create', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ token, adminCode, maxRooms })
            });
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Create admin code error:', error);
            return { 
                success: false, 
                message: 'Errore di connessione' 
            };
        }
    }
    
    async verifyAdminCode(adminCode) {
        try {
            const response = await fetch('/api/admin/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: adminCode })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Verify admin code error:', error);
            return { 
                valid: false, 
                message: 'Errore di connessione al server' 
            };
        }
    }
    
    async getRoomStats() {
        try {
            const response = await fetch('/api/rooms/stats');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('Get room stats error:', error);
            return null;
        }
    }
    
    async joinAsPlayer(roomCode, playerName, playerId = null) {
        // Validazione
        if (!roomCode || !playerName) {
            return { 
                success: false, 
                error: 'Codice stanza e nome richiesti' 
            };
        }
        
        if (playerName.length < 2 || playerName.length > 20) {
            return { 
                success: false, 
                error: 'Nome deve essere tra 2 e 20 caratteri' 
            };
        }
        
        // Salva dati giocatore localmente
        const playerData = {
            id: playerId || this.generatePlayerId(),
            name: playerName.trim(),
            roomCode: roomCode.toUpperCase(),
            joinedAt: new Date().toISOString()
        };
        
        localStorage.setItem('tombola_player', JSON.stringify(playerData));
        
        return { 
            success: true, 
            playerData 
        };
    }
    
    generatePlayerId() {
        return `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    getPlayerData() {
        try {
            const data = localStorage.getItem('tombola_player');
            return data ? JSON.parse(data) : null;
        } catch (e) {
            return null;
        }
    }
    
    clearPlayerData() {
        localStorage.removeItem('tombola_player');
    }
    
    logout() {
        this.clearSession();
        this.clearPlayerData();
        
        // Redirect alla home
        window.location.href = '/';
    }
    
    isLoggedIn() {
        return !!this.currentUser;
    }
    
    isAdmin() {
        return this.currentUser?.role === 'admin' || this.isSuperAdmin;
    }
    
    getUser() {
        return this.currentUser;
    }
    
    getToken() {
        return this.token;
    }
    
    // Utility per validazioni
    validateRoomCode(code) {
        if (!code) return false;
        const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
        return cleanCode.length >= 3 && cleanCode.length <= 10;
    }
    
    validateAdminCode(code) {
        if (!code) return false;
        return code.length >= 6 && code.length <= 20;
    }
    
    validatePlayerName(name) {
        if (!name) return false;
        const cleanName = name.trim();
        return cleanName.length >= 2 && 
               cleanName.length <= 20 && 
               /^[a-zA-Z0-9\sàèéìòùÀÈÉÌÒÙ]+$/.test(cleanName);
    }
    
    // Gestione errori
    showAuthError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'auth-error';
        errorDiv.innerHTML = `
            <div class="error-icon">
                <i class="fas fa-exclamation-circle"></i>
            </div>
            <div class="error-message">${message}</div>
        `;
        
        // Rimuovi errori precedenti
        document.querySelectorAll('.auth-error').forEach(el => el.remove());
        
        // Aggiungi nuovo errore
        const form = document.querySelector('.login-form') || 
                     document.querySelector('form');
        if (form) {
            form.prepend(errorDiv);
            
            // Auto-remove dopo 5 secondi
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.remove();
                }
            }, 5000);
        }
        
        // Scroll all'errore
        errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    showAuthSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'auth-success';
        successDiv.innerHTML = `
            <div class="success-icon">
                <i class="fas fa-check-circle"></i>
            </div>
            <div class="success-message">${message}</div>
        `;
        
        document.querySelectorAll('.auth-success').forEach(el => el.remove());
        
        const form = document.querySelector('.login-form') || 
                     document.querySelector('form');
        if (form) {
            form.prepend(successDiv);
            
            setTimeout(() => {
                if (successDiv.parentNode) {
                    successDiv.remove();
                }
            }, 3000);
        }
    }
}

// Stili per auth (da includere in style.css o qui dinamicamente)
const authStyles = `
.auth-error {
    background: linear-gradient(135deg, #f8d7da, #f5c6cb);
    border: 2px solid #f5c6cb;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    animation: slideDown 0.3s ease;
}

.auth-success {
    background: linear-gradient(135deg, #d4edda, #c3e6cb);
    border: 2px solid #c3e6cb;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    animation: slideDown 0.3s ease;
}

.auth-error .error-icon {
    color: #721c24;
    font-size: 1.25rem;
}

.auth-success .success-icon {
    color: #155724;
    font-size: 1.25rem;
}

.auth-error .error-message,
.auth-success .success-message {
    color: #000;
    font-weight: 500;
}

@keyframes slideDown {
    from {
        opacity: 0;
        transform: translateY(-10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
`;

// Aggiungi stili al documento
if (!document.querySelector('#auth-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'auth-styles';
    styleEl.textContent = authStyles;
    document.head.appendChild(styleEl);
}

// Esporta istanza globale
window.authManager = new AuthManager();