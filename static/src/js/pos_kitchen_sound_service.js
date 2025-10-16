/** @odoo-module **/

// Service amélioré pour jouer des sons dans le POS
class PosKitchenSoundService {
    constructor() {
        this.config = null;
        this.enabled = false;
        this.audioContext = null;
        this.initializeAudioContext();
    }

    initializeAudioContext() {
        // Initialise le contexte audio pour une meilleure compatibilité
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('AudioContext non disponible:', e);
        }
    }

    async loadConfig(posConfigId) {
        try {
            // Récupère la config depuis le serveur
            const response = await fetch('/web/dataset/call_kw', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: {
                        service: 'object',
                        method: 'execute',
                        args: ['pos.config', 'get_pos_sound_settings', posConfigId]
                    }
                })
            });

            const data = await response.json();
            this.config = data.result || {};
            this.enabled = this.config.enabled || false;
            
            console.log('Config sons chargée:', this.config);
        } catch (error) {
            console.error('Erreur chargement config sons:', error);
            this.enabled = false;
        }
    }

    async resumeAudioContext() {
        // Reprend le contexte audio si nécessaire (requis par certains navigateurs)
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (e) {
                console.warn('Impossible de reprendre AudioContext:', e);
            }
        }
    }

    async playSound(soundConfig) {
        if (!soundConfig) {
            console.warn('Configuration son manquante');
            return;
        }

        try {
            await this.resumeAudioContext();
            
            let soundUrl;
            
            if (soundConfig.file === 'custom' && soundConfig.custom_sound) {
                soundUrl = soundConfig.custom_sound;
            } else {
                const filename = soundConfig.file || 'pos_ready';
                soundUrl = `/pos_kitchen_screen_odoo_extension/static/src/sounds/${filename}.mp3`;
            }
            
            console.log(`Lecture son: ${soundUrl} (volume: ${soundConfig.volume})`);
            
            const audio = new Audio(soundUrl);
            audio.volume = Math.max(0, Math.min(1, soundConfig.volume || 0.5));
            
            // Précharge l'audio
            audio.preload = 'auto';
            
            return new Promise((resolve, reject) => {
                audio.oncanplaythrough = () => {
                    audio.play().then(resolve).catch(reject);
                };
                
                audio.onerror = (error) => {
                    console.warn('Erreur chargement audio:', error);
                    this.playFallback().then(resolve).catch(reject);
                };
                
                // Timeout de sécurité
                setTimeout(() => {
                    if (audio.readyState >= 2) { // HAVE_CURRENT_DATA
                        audio.play().then(resolve).catch(reject);
                    } else {
                        this.playFallback().then(resolve).catch(reject);
                    }
                }, 1000);
            });
            
        } catch (error) {
            console.error('Erreur son POS:', error);
            return this.playFallback();
        }
    }

    async playFallback() {
        try {
            const audio = new Audio('/web/static/src/audio/bell.ogg');
            audio.volume = 0.3;
            return audio.play().catch(() => {
                console.warn('Fallback impossible - tentative bip système');
                // Dernier recours - bip système
                if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
                    window.navigator.vibrate(200);
                }
            });
        } catch (error) {
            console.warn('Erreur fallback:', error);
        }
    }

    // Méthodes spécifiques pour différents événements
    playOrderReady() {
        if (!this.enabled || !this.config) return;
        return this.playSound({
            file: this.config.file || 'pos_ready',
            volume: this.config.volume || 0.5,
            custom_sound: this.config.custom_sound
        });
    }

    playNewOrder() {
        if (!this.enabled || !this.config) return;
        return this.playSound({
            file: 'pos_ding',
            volume: this.config.volume || 0.5
        });
    }

    playNotification() {
        if (!this.enabled || !this.config) return;
        return this.playSound({
            file: 'pos_notification',
            volume: this.config.volume || 0.5
        });
    }

    // Méthode pour tester un son spécifique
    testSound(soundFile, volume = null) {
        const testConfig = {
            file: soundFile,
            volume: volume !== null ? volume : (this.config?.volume || 0.5),
            custom_sound: soundFile === 'custom' ? this.config?.custom_sound : null
        };
        
        return this.playSound(testConfig);
    }
}

// Instance globale
const soundService = new PosKitchenSoundService();
window.posKitchenSound = soundService;

// Auto-initialisation quand le DOM est prêt
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('POS Kitchen Sound Service initialisé');
    });
} else {
    console.log('POS Kitchen Sound Service initialisé');
}

// Export pour utilisation en module
export { PosKitchenSoundService, soundService as default };