/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component } from "@odoo/owl";

// Service simple pour jouer des sons
class PosKitchenSoundService {
    constructor() {
        this.config = null;
        this.enabled = false;
    }

    async loadConfig(posConfigId) {
        try {
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

    playSound(soundConfig) {
        try {
            let soundUrl;
            
            if (soundConfig.file === 'custom' && soundConfig.custom_sound) {
                soundUrl = soundConfig.custom_sound;
            } else {
                const filename = soundConfig.file || 'pos_ready';
                soundUrl = `/pos_kitchen_screen_odoo_extension/static/src/sounds/${filename}.mp3`;
            }
            
            const audio = new Audio(soundUrl);
            audio.volume = Math.max(0, Math.min(1, soundConfig.volume || 0.5));
            
            return audio.play().catch(error => {
                console.warn('Erreur lecture son:', error);
                return this.playFallback();
            });
        } catch (error) {
            console.error('Erreur son POS:', error);
            return this.playFallback();
        }
    }

    playFallback() {
        try {
            const audio = new Audio('/web/static/src/audio/bell.ogg');
            audio.volume = 0.3;
            return audio.play().catch(() => {
                console.warn('Fallback impossible');
            });
        } catch (error) {
            console.warn('Erreur fallback:', error);
            return Promise.resolve();
        }
    }

    // Méthodes spécifiques
    playOrderReady() {
        return this.playSound({ file: 'pos_ready', volume: 0.5 });
    }

    playNewOrder() {
        return this.playSound({ file: 'pos_ding', volume: 0.5 });
    }

    playNotification() {
        return this.playSound({ file: 'pos_notification', volume: 0.5 });
    }
}

// Instance globale du service
const soundService = new PosKitchenSoundService();

// Action client pour tester un son
function posSoundTestAction(env, action) {
    const params = action.params || {};
    const soundConfig = params.sound_config;
    
    if (!soundConfig) {
        env.services.notification.add(
            "Erreur: Configuration son manquante",
            { type: "danger" }
        );
        return;
    }

    // Joue le son
    soundService.playSound(soundConfig).then(() => {
        env.services.notification.add(
            params.message || "Son joué avec succès!",
            { type: "success" }
        );
    }).catch(error => {
        console.error("Erreur lors de la lecture:", error);
        env.services.notification.add(
            "Erreur lors de la lecture du son",
            { type: "warning" }
        );
    });
}

// Action client pour tester tous les sons
function posSoundTestAllAction(env, action) {
    const params = action.params || {};
    const testConfig = params.test_config;
    
    if (!testConfig || !testConfig.sounds) {
        env.services.notification.add(
            "Erreur: Configuration de test manquante",
            { type: "danger" }
        );
        return;
    }

    let currentIndex = 0;
    const sounds = testConfig.sounds;
    const delay = testConfig.delay || 2000;
    
    env.services.notification.add(
        `Test de ${sounds.length} sons commencé...`,
        { type: "info" }
    );

    // Fonction récursive pour jouer les sons un par un
    function playNextSound() {
        if (currentIndex >= sounds.length) {
            env.services.notification.add(
                "Test de tous les sons terminé!",
                { type: "success" }
            );
            return;
        }

        const [soundFile, soundDesc] = sounds[currentIndex];
        const soundConfig = {
            file: soundFile,
            volume: testConfig.volume,
            custom_sound: soundFile === 'custom' ? testConfig.custom_sound : null
        };

        env.services.notification.add(
            `Test: ${soundDesc}`,
            { type: "info" }
        );

        soundService.playSound(soundConfig).then(() => {
            currentIndex++;
            setTimeout(playNextSound, delay);
        }).catch(error => {
            console.error(`Erreur son ${soundDesc}:`, error);
            currentIndex++;
            setTimeout(playNextSound, delay);
        });
    }

    playNextSound();
}

// Enregistrement des actions client
registry.category("actions").add("pos_sound_test", posSoundTestAction);
registry.category("actions").add("pos_sound_test_all", posSoundTestAllAction);

// Export du service pour utilisation globale
window.posKitchenSound = soundService;

export { PosKitchenSoundService, soundService };