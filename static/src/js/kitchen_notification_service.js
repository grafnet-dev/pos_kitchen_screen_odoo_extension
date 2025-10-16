/** @odoo-module **/

import { registry } from "@web/core/registry";
import { browser } from "@web/core/browser/browser";

export const kitchenNotificationService = {
    dependencies: ["bus_service", "notification"],
    
    start(env, { bus_service, notification }) {
        let isEnabled = true;
        let configId = null;
        let audioContext = null;
        let notificationHistory = [];
        let isInitialized = false;
        let busSubscribed = false;
        let soundConfig = null;
        
        // Récupérer l'ID de configuration
        function getConfigId() {
            if (!configId) {
                const urlParams = new URLSearchParams(window.location.search);
                configId = urlParams.get('shop_id') || urlParams.get('config_id') || window.kitchen_config_id || 1;
            }
            return configId;
        }
        
        // Appel RPC vers Odoo
        async function rpcCall(model, method, args = [], kwargs = {}) {
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
                            model: model,
                            method: method,
                            args: args,
                            kwargs: kwargs
                        },
                        id: Date.now()
                    })
                });
                
                const data = await response.json();
                
                if (data.error) {
                    throw new Error(data.error.data?.message || data.error.message || 'RPC Error');
                }
                
                return data.result;
            } catch (error) {
                console.error(`RPC call failed (${model}.${method}):`, error);
                throw error;
            }
        }
        
        // Charger la configuration des sons depuis le serveur
        async function loadSoundConfig() {
            try {
                const currentConfigId = getConfigId();
                console.log(`Loading sound config for POS config ${currentConfigId}...`);
                
                const config = await rpcCall(
                    'pos.config',
                    'get_pos_sound_settings',
                    [parseInt(currentConfigId)]
                );
                
                if (config) {
                    soundConfig = config;
                    isEnabled = config.enabled || false;
                    console.log('Sound config loaded:', soundConfig);
                    return true;
                }
                
                console.warn('No sound config returned from server');
                return false;
            } catch (error) {
                console.error('Error loading sound config:', error);
                soundConfig = {
                    enabled: false,
                    file: 'pos_notification',
                    volume: 0.5,
                    custom_sound: null
                };
                return false;
            }
        }
        
        // Sauvegarder les préférences de son sur le serveur
        async function saveSoundPreference(enabled) {
            try {
                const currentConfigId = getConfigId();
                
                await rpcCall(
                    'pos.config',
                    'write',
                    [[parseInt(currentConfigId)], {
                        'kitchen_sound_enabled': enabled
                    }]
                );
                
                console.log(`Sound preference saved: ${enabled}`);
                return true;
            } catch (error) {
                console.warn('Could not save sound preference to server:', error);
                // Fallback: sauvegarder localement
                try {
                    browser.localStorage.setItem('kitchen_sound_enabled', String(enabled));
                } catch (e) {
                    console.warn('Could not save to localStorage:', e);
                }
                return false;
            }
        }
        
        // Charger les préférences utilisateur (local + serveur)
        async function loadSettings() {
            // D'abord charger depuis le serveur
            await loadSoundConfig();
            
            // Vérifier les préférences locales (priorité)
            try {
                const savedSetting = browser.localStorage.getItem('kitchen_sound_enabled');
                if (savedSetting !== null) {
                    isEnabled = savedSetting === 'true';
                    console.log('Local sound settings loaded:', isEnabled ? 'enabled' : 'disabled');
                }
            } catch (error) {
                console.warn('Could not load local sound settings:', error);
            }
        }
        
        // Initialiser l'AudioContext
        function initAudioContext() {
            if (!audioContext) {
                try {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                } catch (error) {
                    console.warn('Could not create AudioContext:', error);
                }
            }
            return audioContext;
        }
        
        // Reprendre le contexte audio si suspendu
        async function resumeAudioContext() {
            if (audioContext && audioContext.state === 'suspended') {
                try {
                    await audioContext.resume();
                } catch (error) {
                    console.warn('Could not resume AudioContext:', error);
                }
            }
        }
        
        // Jouer un son de notification avec la config du serveur
        async function playNotificationSound(type = 'default') {
            if (!isEnabled) {
                console.log('Sound is disabled, skipping notification');
                return;
            }
            
            try {
                await resumeAudioContext();
                
                let soundUrl;
                const volume = soundConfig?.volume || 0.5;
                
                // Déterminer le fichier son à utiliser
                if (soundConfig?.file === 'custom' && soundConfig?.custom_sound) {
                    soundUrl = soundConfig.custom_sound;
                } else {
                    const filename = soundConfig?.file || 'pos_notification';
                    soundUrl = `/pos_kitchen_screen_odoo_extension/static/src/sounds/${filename}.mp3`;
                }
                
                console.log(`Playing sound: ${soundUrl} (volume: ${volume})`);
                
                // Créer et jouer l'audio
                const audio = new Audio(soundUrl);
                audio.volume = Math.max(0, Math.min(1, volume));
                audio.preload = 'auto';
                
                const playPromise = new Promise((resolve, reject) => {
                    audio.oncanplaythrough = () => {
                        audio.play().then(resolve).catch(reject);
                    };
                    
                    audio.onerror = (error) => {
                        console.warn('Audio loading error:', error);
                        reject(error);
                    };
                    
                    // Timeout de sécurité
                    setTimeout(() => {
                        if (audio.readyState >= 2) {
                            audio.play().then(resolve).catch(reject);
                        } else {
                            reject(new Error('Audio timeout'));
                        }
                    }, 1000);
                });
                
                await playPromise;
                console.log('Notification sound played successfully');
                
            } catch (error) {
                console.error('Error playing notification sound:', error);
                // Fallback
                await playFallbackSound(type);
            }
        }
        
        // Son de fallback avec Web Audio API
        async function playFallbackSound(type) {
            try {
                console.log('Using fallback sound...');
                const context = initAudioContext();
                if (!context) {
                    throw new Error('AudioContext not available');
                }
                
                if (context.state === 'suspended') {
                    await context.resume();
                }
                
                const oscillator = context.createOscillator();
                const gainNode = context.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(context.destination);
                
                const frequencies = {
                    'new_order': [800, 600],
                    'order_accepted': [600, 800],
                    'order_completed': [500, 700, 500],
                    'order_cancelled': [400, 300],
                    'default': [800, 600]
                };
                
                const freqs = frequencies[type] || frequencies.default;
                
                oscillator.frequency.setValueAtTime(freqs[0], context.currentTime);
                if (freqs.length > 1) {
                    oscillator.frequency.setValueAtTime(freqs[1], context.currentTime + 0.1);
                }
                if (freqs.length > 2) {
                    oscillator.frequency.setValueAtTime(freqs[2], context.currentTime + 0.2);
                }
                
                gainNode.gain.setValueAtTime(0, context.currentTime);
                gainNode.gain.linearRampToValueAtTime(0.3, context.currentTime + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.5);
                
                oscillator.start(context.currentTime);
                oscillator.stop(context.currentTime + 0.5);
                
                console.log('Fallback sound played via Web Audio API');
                
            } catch (error) {
                console.error('Fallback sound failed:', error);
                // Dernier recours: vibration
                if (window.navigator?.vibrate) {
                    window.navigator.vibrate(200);
                }
            }
        }
        
        // Notification du navigateur
        function showBrowserNotification(title, body) {
            if ('Notification' in window && Notification.permission === 'granted') {
                try {
                    new Notification(title, {
                        body: body,
                        icon: '/pos_kitchen_screen_odoo/static/src/assets/icons/Vector-white.svg',
                        badge: '/pos_kitchen_screen_odoo/static/src/assets/icons/Vector-white.svg',
                        tag: 'kitchen-order',
                        requireInteraction: false
                    });
                } catch (error) {
                    console.warn('Could not show browser notification:', error);
                }
            }
        }
        
        // Enregistrer une notification dans l'historique
        async function addToHistory(notificationData) {
            const historyItem = {
                ...notificationData,
                timestamp: new Date().toISOString(),
                id: Date.now() + Math.random()
            };
            
            notificationHistory.unshift(historyItem);
            
            // Limiter l'historique à 50 éléments
            if (notificationHistory.length > 50) {
                notificationHistory = notificationHistory.slice(0, 50);
            }
            
            // Sauvegarder localement
            try {
                browser.localStorage.setItem('kitchen_notification_history', 
                    JSON.stringify(notificationHistory.slice(0, 20)));
            } catch (error) {
                console.warn('Could not save notification history:', error);
            }
            
            // Optionnel: envoyer au serveur pour synchronisation
            try {
                await rpcCall(
                    'pos.kitchen.order',
                    'log_notification',
                    [],
                    {
                        notification_type: notificationData.notification_type,
                        order_ref: notificationData.order_ref,
                        config_id: getConfigId()
                    }
                );
            } catch (error) {
                // Erreur silencieuse, ce n'est pas critique
                console.debug('Could not log notification to server:', error);
            }
        }
        
        // Charger l'historique
        function loadHistory() {
            try {
                const saved = browser.localStorage.getItem('kitchen_notification_history');
                if (saved) {
                    notificationHistory = JSON.parse(saved);
                    console.log(`Loaded ${notificationHistory.length} notification(s) from history`);
                }
            } catch (error) {
                console.warn('Could not load notification history:', error);
                notificationHistory = [];
            }
        }
        
        // Gérer les notifications reçues via le bus
        function handleBusNotification(notifications) {
            for (const notification of notifications) {
                if (notification.type === "notification" && notification.payload) {
                    const message = notification.payload;
                    
                    if (message.message === 'kitchen_sound_notification') {
                        handleKitchenNotification(message);
                    }
                }
            }
        }
        
        // Traiter une notification kitchen
        async function handleKitchenNotification(message) {
            console.log('Kitchen notification received:', message);
            
            // Ajouter à l'historique
            await addToHistory(message);
            
            // Jouer le son
            await playNotificationSound(message.notification_type);
            
            // Afficher notification toast
            showToastNotification(message);
            
            // Déclencher les effets visuels
            triggerVisualEffects(message);
            
            // Notification navigateur si la page n'est pas visible
            if (document.hidden) {
                const title = getNotificationTitle(message.notification_type);
                showBrowserNotification(title, `Commande: ${message.order_ref}`);
            }
        }
        
        // Afficher notification toast
        function showToastNotification(message) {
            const toast = document.createElement('div');
            toast.className = `kitchen-notification-toast ${message.notification_type}`;
            
            const title = getNotificationTitle(message.notification_type);
            const icon = getNotificationIcon(message.notification_type);
            
            toast.innerHTML = `
                <div class="notification-content">
                    <div class="notification-icon">
                        <i class="${icon}"></i>
                    </div>
                    <div class="notification-body">
                        <strong>${title}</strong>
                        <span>Commande: ${message.order_ref || 'N/A'}</span>
                        <small>${new Date().toLocaleTimeString()}</small>
                    </div>
                    <div class="notification-close">
                        <i class="fa fa-times"></i>
                    </div>
                </div>
            `;
            
            const closeBtn = toast.querySelector('.notification-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    toast.classList.remove('show');
                    setTimeout(() => toast.remove(), 300);
                });
            }
            
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 100);
            
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.remove();
                    }
                }, 300);
            }, 5000);
        }
        
        // Déclencher des effets visuels
        function triggerVisualEffects(message) {
            const counters = document.querySelectorAll('.kitchen_order_count');
            counters.forEach(counter => {
                counter.classList.add('pulse-animation');
                setTimeout(() => counter.classList.remove('pulse-animation'), 1000);
            });
            
            const stageClass = getStageClass(message.notification_type);
            if (stageClass) {
                const element = document.querySelector(`.${stageClass}`);
                if (element) {
                    element.classList.add('highlight-animation');
                    setTimeout(() => element.classList.remove('highlight-animation'), 2000);
                }
            }
            
            flashPageTitle(message);
        }
        
        // Flash du titre de la page
        function flashPageTitle(message) {
            const originalTitle = document.title;
            const newTitle = `🔔 ${getNotificationTitle(message.notification_type)}`;
            
            let flashCount = 0;
            const interval = setInterval(() => {
                document.title = flashCount % 2 === 0 ? newTitle : originalTitle;
                flashCount++;
                
                if (flashCount >= 6) {
                    clearInterval(interval);
                    document.title = originalTitle;
                }
            }, 500);
        }
        
        // Utilitaires
        function getNotificationTitle(type) {
            const titles = {
                'new_order': 'Nouvelle Commande',
                'order_accepted': 'Commande Acceptée', 
                'order_completed': 'Commande Terminée',
                'order_cancelled': 'Commande Annulée'
            };
            return titles[type] || 'Notification';
        }
        
        function getNotificationIcon(type) {
            const icons = {
                'new_order': 'fa fa-bell-o',
                'order_accepted': 'fa fa-check-circle-o',
                'order_completed': 'fa fa-check-circle',
                'order_cancelled': 'fa fa-times-circle-o'
            };
            return icons[type] || 'fa fa-bell';
        }
        
        function getStageClass(type) {
            const classes = {
                'new_order': 'draft_stage',
                'order_accepted': 'waiting_stage', 
                'order_completed': 'ready_stage'
            };
            return classes[type];
        }
        
        // Demander permission pour les notifications navigateur
        function requestNotificationPermission() {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                    console.log('Notification permission:', permission);
                });
            }
        }
        
        // S'abonner au bus
        function subscribeToBus() {
            if (busSubscribed) {
                console.log('Already subscribed to bus');
                return;
            }
            
            try {
                const currentConfigId = getConfigId();
                const channel = `kitchen_sound_notification_${currentConfigId}`;
                
                bus_service.addEventListener("notification", handleBusNotification);
                bus_service.addChannel(channel);
                
                busSubscribed = true;
                console.log(`Subscribed to channel: ${channel}`);
            } catch (error) {
                console.error('Error subscribing to bus:', error);
            }
        }
        
        // Se désabonner du bus
        function unsubscribeFromBus() {
            if (!busSubscribed) {
                return;
            }
            
            try {
                const currentConfigId = getConfigId();
                const channel = `kitchen_sound_notification_${currentConfigId}`;
                
                bus_service.removeEventListener("notification", handleBusNotification);
                bus_service.deleteChannel(channel);
                
                busSubscribed = false;
                console.log(`Unsubscribed from channel: ${channel}`);
            } catch (error) {
                console.error('Error unsubscribing from bus:', error);
            }
        }
        
        // Initialisation
        async function initialize() {
            if (isInitialized) {
                console.log('Kitchen notification service already initialized');
                return;
            }
            
            console.log('Initializing kitchen notification service...');
            
            await loadSettings();
            loadHistory();
            requestNotificationPermission();
            subscribeToBus();
            
            isInitialized = true;
            
            console.log(`Kitchen notification service initialized for config ${getConfigId()}`);
            console.log(`Sound is ${isEnabled ? 'enabled' : 'disabled'}`);
        }
        
        // Interface publique du service
        const service = {
            initialize,
            playSound: playNotificationSound,
            toggleSound: async (enabled) => {
                if (enabled !== undefined) {
                    isEnabled = enabled;
                } else {
                    isEnabled = !isEnabled;
                }
                await saveSoundPreference(isEnabled);
                return isEnabled;
            },
            isEnabled: () => isEnabled,
            getHistory: () => [...notificationHistory],
            clearHistory: () => {
                notificationHistory = [];
                try {
                    browser.localStorage.removeItem('kitchen_notification_history');
                } catch (error) {
                    console.warn('Could not clear history:', error);
                }
            },
            testNotification: () => {
                handleKitchenNotification({
                    notification_type: 'new_order',
                    order_ref: 'TEST-001',
                    order_status: 'draft',
                    config_id: getConfigId()
                });
            },
            reloadConfig: loadSoundConfig,
            getSoundConfig: () => soundConfig,
            destroy: unsubscribeFromBus,
            isInitialized: () => isInitialized
        };
        
        // Auto-initialisation après un délai
        setTimeout(() => {
            if (!isInitialized) {
                initialize();
            }
        }, 1000);
        
        // Exposer globalement pour le debugging
        window.kitchenNotificationService = service;
        
        return service;
    },
};

registry.category("services").add("kitchen_notification", kitchenNotificationService);