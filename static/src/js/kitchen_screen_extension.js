/** @odoo-module */
import { patch } from "@web/core/utils/patch";
import { registry } from "@web/core/registry";

// Récupération de l'action de base
let KitchenScreenDashboard;
try {
    KitchenScreenDashboard = registry
        .category("actions")
        .get("kitchen_custom_dashboard_tags");
    console.log('[KITCHEN EXT] ✅ Base action found:', KitchenScreenDashboard);
} catch (e) {
    console.error('[KITCHEN EXT] ❌ Base action NOT found! Error:', e);
    throw new Error('Kitchen base action not found. Make sure the base module is loaded first.');
}

// Stockage en mémoire global
const screenMemoryStore = {
    currentScreenId: null,
    screenHistory: []
};

// ✅ Gestionnaire de son AMÉLIORÉ
class NotificationSoundManager {
    constructor() {
        this.audioContext = null;
        this.soundUrl = '/pos_kitchen_screen_odoo_extension/static/src/sounds/notification.mp3';
        this.audioElement = null;
        this.isPlaying = false;
        this.isEnabled = true; // Option pour désactiver si nécessaire
    }

    async init() {
        try {
            // Créer un élément audio
            this.audioElement = new Audio(this.soundUrl);
            this.audioElement.preload = 'auto';
            this.audioElement.volume = 0.8; // ✅ Volume à 80%
            
            // Précharger le son
            await this.audioElement.load();
            
            console.log('[SOUND MANAGER] ✅ Audio element initialized and preloaded');
            
            // ✅ Test de disponibilité du son
            this.audioElement.addEventListener('error', (e) => {
                console.error('[SOUND MANAGER] ❌ Audio loading error:', e);
                this.isEnabled = false;
            });
            
            this.audioElement.addEventListener('canplaythrough', () => {
                console.log('[SOUND MANAGER] ✅ Audio ready to play');
            });
            
        } catch (error) {
            console.error('[SOUND MANAGER] ❌ Error initializing audio:', error);
            this.isEnabled = false;
        }
    }

    async play() {
        if (!this.isEnabled) {
            console.warn('[SOUND MANAGER] ⚠️ Sound is disabled');
            return;
        }

        if (this.isPlaying) {
            console.log('[SOUND MANAGER] ⏸️ Sound already playing, skipping');
            return;
        }

        try {
            this.isPlaying = true;
            
            if (this.audioElement) {
                // ✅ Réinitialiser et jouer
                this.audioElement.currentTime = 0;
                
                // ✅ Utiliser une promesse pour gérer les erreurs
                const playPromise = this.audioElement.play();
                
                if (playPromise !== undefined) {
                    await playPromise;
                    console.log('[SOUND MANAGER] 🔔 Notification sound played successfully');
                }
                
                // Réinitialiser l'état après la fin
                this.audioElement.onended = () => {
                    this.isPlaying = false;
                    console.log('[SOUND MANAGER] ✅ Sound playback ended');
                };
            } else {
                console.warn('[SOUND MANAGER] ⚠️ Audio element not available');
                this.isPlaying = false;
            }
        } catch (error) {
            console.error('[SOUND MANAGER] ❌ Error playing sound:', error);
            
            // ✅ Si l'utilisateur n'a pas interagi, afficher un message
            if (error.name === 'NotAllowedError') {
                console.warn('[SOUND MANAGER] ⚠️ Sound blocked - user interaction required');
            }
            
            this.isPlaying = false;
        }
    }

    stop() {
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
        }
        this.isPlaying = false;
    }

    enable() {
        this.isEnabled = true;
        console.log('[SOUND MANAGER] ✅ Sound enabled');
    }

    disable() {
        this.isEnabled = false;
        this.stop();
        console.log('[SOUND MANAGER] 🔇 Sound disabled');
    }
}

// Patch de l'action
patch(KitchenScreenDashboard.prototype, {
        setup() {
        super.setup();
        
        console.log('[KITCHEN EXT] 🔍 Setup called with props:', this.props);
        
        this.screenId = this.getScreenId();
        
        if (!this.screenId || this.screenId === 0) {
            console.error('[KITCHEN EXT] ⚠️ CRITICAL: Invalid screen_id!');
            if (this.env.services.notification) {
                this.env.services.notification.add(
                    'No kitchen screen selected. Please open from Kitchen Screen menu.',
                    { type: 'danger', sticky: true }
                );
            }
        }
        
        this.screenChannel = `kitchen.screen.${this.screenId}`;
        this.channel = this.screenChannel;
        this.state.screen_id = this.screenId;
        
        // ✅ INITIALISATION DU GESTIONNAIRE DE SON
        this.soundManager = new NotificationSoundManager();
        this.soundManager.init();
        
        // ✅ COMPTEURS DE DEBUG
        this._notificationCount = 0;
        this._lastNotificationTime = null;
        
        // ✅ ÉCOUTE CANAL 1: Frontend bus spécifique
        console.log('[KITCHEN EXT] 📡 Setting up frontend bus listener: pos-kitchen-new-order');
        this.env.bus.addEventListener('pos-kitchen-new-order', this.handleNewOrderNotification.bind(this));
        
        // ✅ ÉCOUTE CANAL 2: Frontend bus global
        console.log('[KITCHEN EXT] 📡 Setting up global bus listener: kitchen-screen-notification');
        this.env.bus.addEventListener('kitchen-screen-notification', this.handleNewOrderNotification.bind(this));
        
        // ✅ ÉCOUTE CANAL 3: Événement DOM global
        console.log('[KITCHEN EXT] 📡 Setting up DOM event listener: kitchen-new-order-global');
        this._globalEventHandler = this.handleGlobalEvent.bind(this);
        window.addEventListener('kitchen-new-order-global', this._globalEventHandler);
        
        // ✅ ÉCOUTE CANAL 4: Backend bus
        this._setupBackendBusListener();
        
        // ✅ INTERACTION UTILISATEUR pour débloquer l'audio
        this._setupUserInteractionListener();
        
        // ✅ POLLING DE SECOURS (toutes les 15 secondes)
        console.log('[KITCHEN EXT] ⏰ Setting up backup polling (15s)');
        this._lastOrderCount = 0;
        this._pollingInterval = setInterval(() => {
            this.checkForNewOrders();
        }, 15000);
        
        console.log(`[KITCHEN EXT] ✅ Screen initialized with ID: ${this.screenId}`);
        console.log(`[KITCHEN EXT] ✅ Channel: ${this.screenChannel}`);
        console.log(`[KITCHEN EXT] 🔊 Sound manager initialized`);
        console.log(`[KITCHEN EXT] 📡 Listening on 4 notification channels`);
    },


    /**
 * ✅ NOUVEAU: Configuration de l'écouteur backend bus
 */
_setupBackendBusListener() {
    try {
        console.log('[KITCHEN EXT] 📡 Setting up backend bus listener');
        
        // Récupérer le service bus s'il existe
        this._busService = this.env.services.bus_service || this.env.services.bus;
        
        if (this._busService) {
            console.log('[KITCHEN EXT] ✅ Bus service found, setting up notification listener');
            
            // S'abonner aux notifications
            this._busService.addEventListener('notification', this._handleBackendNotificationEvent.bind(this));
        } else {
            console.warn('[KITCHEN EXT] ⚠️ Bus service not available');
        }
    } catch (error) {
        console.error('[KITCHEN EXT] ❌ Error setting up backend bus listener:', error);
    }
},

    /**
 * ✅ NOUVEAU: Gestionnaire d'événement DOM global
 */
    handleGlobalEvent(event) {
        console.log('[KITCHEN EXT] 📢 Global DOM event received:', event.detail);
        
        const data = event.detail;
        
        if (data && data.screen_id === this.screenId) {
            console.log('[KITCHEN EXT] ✅ Global event is for this screen');
            this.handleNewOrderNotification({ detail: data });
        } else {
            console.log(`[KITCHEN EXT] 📭 Global event for different screen: ${data?.screen_id}`);
        }
    },

    /**
     * ✅ NOUVEAU: Vérification polling pour détecter les nouvelles commandes
     */
    async checkForNewOrders() {
        try {
            console.log('[KITCHEN EXT] ⏰ Polling check for new orders...');
            
            // Compter les commandes actuelles
            const currentOrderCount = this.state.order_details?.length || 0;
            
            // Si le nombre a augmenté, il y a une nouvelle commande
            if (currentOrderCount > this._lastOrderCount) {
                console.log(`[KITCHEN EXT] 🆕 New order detected via polling! (${this._lastOrderCount} → ${currentOrderCount})`);
                
                // Déclencher l'alerte
                await this.triggerNewOrderAlert({
                    type: 'new_order',
                    screen_id: this.screenId,
                    order_reference: 'Nouvelle commande!',
                    source: 'polling'
                });
            }
            
            this._lastOrderCount = currentOrderCount;
            
            // Recharger les commandes
            await this.loadOrders();
            
        } catch (error) {
            console.error('[KITCHEN EXT] ❌ Error in polling check:', error);
        }
    },


    /**
     * ✅ NOUVEAU: Gestionnaire d'événements backend
     */

    _handleBackendNotificationEvent(event) {
    try {
        console.log('[KITCHEN EXT] 📨 Backend notification event received:', event);

        let notifications = event.detail || event.data || [];
        if (!Array.isArray(notifications)) {
            // Cas Odoo 17+ : event.detail = { type: 'notification', payload: [...] }
            if (notifications.payload && Array.isArray(notifications.payload)) {
                notifications = notifications.payload;
            } else {
                console.warn('[KITCHEN EXT] ⚠️ Invalid notification structure:', notifications);
                return;
            }
        }

        for (const notif of notifications) {
            let channel, messageType, message;

            if (Array.isArray(notif)) {
                // Ancien format
                [channel, messageType, message] = notif;
            } else if (notif.channel && notif.message) {
                // Nouveau format Odoo 17+
                channel = notif.channel;
                messageType = notif.message.type;
                message = notif.message;
            } else {
                console.warn('[KITCHEN EXT] ⚠️ Unexpected notification format:', notif);
                continue;
            }

            console.log('[KITCHEN EXT] 📬 Processing notification:', { channel, messageType, message });

            if (channel === this.screenChannel) {
                if (messageType === 'new_order' || message?.type === 'new_order') {
                    this.handleNewOrderNotification({ detail: message });
                } else if (messageType === 'order_status_change') {
                    this.handleOrderStatusChange({ detail: message });
                } else {
                    this.onPosOrderCreation?.(message);
                }
            } else {
                console.log(`[KITCHEN EXT] 📭 Notification for different channel: ${channel}`);
            }
        }
    } catch (error) {
        console.error('[KITCHEN EXT] ❌ Error handling backend notification:', error);
    }
},


    /**
     * ✅ NOUVEAU: Écouter le premier clic utilisateur pour débloquer l'audio
     */
    _setupUserInteractionListener() {
        const enableAudio = () => {
            console.log('[KITCHEN EXT] 👆 User interaction detected - enabling audio');
            this.soundManager.enable();
            // Retirer l'écouteur après la première interaction
            document.removeEventListener('click', enableAudio);
            document.removeEventListener('touchstart', enableAudio);
        };
        
        document.addEventListener('click', enableAudio, { once: true });
        document.addEventListener('touchstart', enableAudio, { once: true });
    },

    /**
     * ✅ GESTIONNAIRE DE NOTIFICATION DE NOUVELLE COMMANDE - VERSION AMÉLIORÉE
     */
    /**
 * ✅ CORRIGÉE: Vérifier screen_id EN PREMIER
 */
    handleNewOrderNotification(event) {
        const message = event.detail;
        
        console.log('[KITCHEN EXT] 📨 ========================================');
        console.log('[KITCHEN EXT] 📨 NEW ORDER NOTIFICATION RECEIVED');
        console.log('[KITCHEN EXT] 📨 ========================================');
        
        if (!message || typeof message !== 'object') {
            console.warn('[KITCHEN EXT] ❌ Invalid new order message:', message);
            return;
        }

        // ✅ Incrémenter le compteur
        this._notificationCount++;
        this._lastNotificationTime = new Date().toISOString();

        console.log(`[KITCHEN EXT] 📊 Notification #${this._notificationCount}`);
        console.log(`[KITCHEN EXT] 📋 Message details:`, {
            type: message.type,
            screen_id: message.screen_id,
            order_reference: message.order_reference,
            order_name: message.order_name,
            config_id: message.config_id,
            timestamp: message.timestamp,
            lines_count: message.lines_count
        });

        // ✅ CHANGEMENT CRITIQUE: Vérifier screen_id EN PREMIER
        const isForThisScreen = message.screen_id === this.screenId;
        
        console.log('[KITCHEN EXT] 🔍 Screen check:', {
            isForThisScreen,
            currentScreenId: this.screenId,
            messageScreenId: message.screen_id
        });
        
        if (!isForThisScreen) {
            console.log(`[KITCHEN EXT] 📭 SKIPPED: Different screen (${message.screen_id} vs ${this.screenId})`);
            return;
        }

        console.log(`[KITCHEN EXT] ✅ SCREEN MATCHES - Checking config...`);

        // ✅ Vérifier config APRÈS screen (optionnel, moins strict)
        const isForThisConfig = !message.config_id || message.config_id === this.currentShopId;
        
        console.log('[KITCHEN EXT] 🔍 Config check:', {
            isForThisConfig,
            currentShopId: this.currentShopId,
            messageConfigId: message.config_id
        });
        
        if (!isForThisConfig) {
            console.log(`[KITCHEN EXT] 📭 SKIPPED: Different config (${message.config_id} vs ${this.currentShopId})`);
            return;
        }

        console.log(`[KITCHEN EXT] ✅ NOTIFICATION IS FOR THIS SCREEN - Processing...`);

        // ✅ DÉCLENCHER L'ALERTE
        this.triggerNewOrderAlert(message);
        
        console.log('[KITCHEN EXT] ========================================');
    },

    /**
     * ✅ NOUVEAU: Gestionnaire pour changement de statut
     */
    handleOrderStatusChange(event) {
        const message = event.detail;
        console.log('[KITCHEN EXT] 🔄 Order status change:', message);
        
        // Recharger les commandes après un court délai
        setTimeout(() => {
            this.loadOrders();
        }, 500);
    },

    /**
     * ✅ DÉCLENCHEUR D'ALERTE - VERSION AMÉLIORÉE
     */
 

    /**
 * ✅ CORRIGÉE: Recharger IMMÉDIATEMENT sans attendre
 */
    async triggerNewOrderAlert(message) {
        try {
            console.log(`[KITCHEN EXT] 🚨 ========================================`);
            console.log(`[KITCHEN EXT] 🚨 TRIGGERING INSTANT NEW ORDER ALERT`);
            console.log(`[KITCHEN EXT] 🚨 ========================================`);
            
            // ✅ CHANGEMENT CRITIQUE: Recharger IMMÉDIATEMENT
            console.log('[KITCHEN EXT] 🔄 Reloading orders IMMEDIATELY...');
            this.loadOrders(); // ✅ PAS de await - lancer immédiatement
            
            // ✅ ENSUITE: Alertes visuelles/sonores en parallèle (ne bloquent rien)
            console.log('[KITCHEN EXT] 🔔 Playing sound...');
            this.playNotificationSound().catch(err => {
                console.warn('[KITCHEN EXT] ⚠️ Sound failed:', err);
            });
            
            console.log('[KITCHEN EXT] 👁️ Showing visual notification...');
            this.showVisualNotification(message);
            
            console.log('[KITCHEN EXT] ✨ Triggering visual alert...');
            this.triggerVisualAlert();
            
            console.log('[KITCHEN EXT] ✅ Alert sequence launched');
            console.log('[KITCHEN EXT] ========================================');
            
        } catch (error) {
            console.error('[KITCHEN EXT] ❌ Error in new order alert:', error);
        }
    },
    /**
     * ✅ JOUER LE SON - VERSION AMÉLIORÉE
     */
    async playNotificationSound() {
        try {
            console.log(`[KITCHEN EXT] 🔔 Attempting to play notification sound...`);
            console.log(`[KITCHEN EXT] 🔊 Sound manager state:`, {
                isEnabled: this.soundManager.isEnabled,
                isPlaying: this.soundManager.isPlaying,
                audioElement: !!this.soundManager.audioElement
            });
            
            await this.soundManager.play();
            
            console.log(`[KITCHEN EXT] ✅ Sound play command executed`);
        } catch (error) {
            console.error('[KITCHEN EXT] ❌ Error playing notification sound:', error);
            
            // ✅ Notification de fallback si le son échoue
            if (this.env.services.notification) {
                this.env.services.notification.add(
                    '🔔 Nouvelle commande reçue!',
                    { type: 'warning', sticky: false }
                );
            }
        }
    },

    /**
     * ✅ AFFICHER LA NOTIFICATION VISUELLE - VERSION AMÉLIORÉE
     */
    showVisualNotification(message) {
        try {
            const orderRef = message.order_reference || message.order_name || 'Nouvelle commande';
            const linesCount = message.lines_count || message.lines?.length || '';
            
            console.log(`[KITCHEN EXT] 👁️ Showing visual notification for: ${orderRef}`);
            
            // ✅ Notification Odoo
            if (this.env.services.notification) {
                this.env.services.notification.add(
                    `🆕 ${orderRef} (${linesCount})`,
                    { 
                        type: 'success',
                        sticky: true,
                        className: 'o_kitchen_new_order_notification'
                    }
                );
                console.log('[KITCHEN EXT] ✅ Odoo notification displayed');
            }
            
            // ✅ Animation personnalisée
            this.triggerVisualAlert();
            
        } catch (error) {
            console.error('[KITCHEN EXT] ❌ Error showing visual notification:', error);
        }
    },

    /**
     * ✅ ALERTE VISUELLE PERSONNALISÉE - VERSION AMÉLIORÉE
     */
    triggerVisualAlert() {
        try {
            console.log('[KITCHEN EXT] ✨ Creating visual alert overlay');
            
            // ✅ Créer l'overlay avec animation
            const alertOverlay = document.createElement('div');
            alertOverlay.className = 'o_kitchen_alert_overlay';
            alertOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 180, 255, 0.4);
                z-index: 9999;
                pointer-events: none;
                animation: flashAlert 1.5s ease-in-out;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            
            // ✅ Ajouter un badge "NOUVELLE COMMANDE"
            const badge = document.createElement('div');
            badge.style.cssText = `
                background: #00b4d8;
                color: white;
                padding: 30px 60px;
                border-radius: 15px;
                font-size: 32px;
                font-weight: bold;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                animation: scaleIn 0.5s ease-out;
            `;
            badge.textContent = '🆕 NOUVELLE COMMANDE';
            alertOverlay.appendChild(badge);
            
            // ✅ Ajouter les animations CSS
            const style = document.createElement('style');
            style.textContent = `
                @keyframes flashAlert {
                    0% { opacity: 0; }
                    20% { opacity: 1; }
                    80% { opacity: 1; }
                    100% { opacity: 0; }
                }
                
                @keyframes scaleIn {
                    0% { transform: scale(0.5); opacity: 0; }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); opacity: 1; }
                }
                
                .o_kitchen_new_order_notification {
                    background: #00b4d8 !important;
                    color: white !important;
                    font-size: 18px !important;
                    font-weight: bold !important;
                    border-left: 5px solid #0096c7 !important;
                }
            `;
            
            document.head.appendChild(style);
            document.body.appendChild(alertOverlay);
            
            console.log('[KITCHEN EXT] ✅ Visual alert overlay created');
            
            // ✅ Supprimer après l'animation
            setTimeout(() => {
                if (alertOverlay.parentNode) {
                    alertOverlay.parentNode.removeChild(alertOverlay);
                }
                if (style.parentNode) {
                    style.parentNode.removeChild(style);
                }
                console.log('[KITCHEN EXT] ✅ Visual alert overlay removed');
            }, 2000);
            
        } catch (error) {
            console.error('[KITCHEN EXT] ❌ Error in visual alert:', error);
        }
    },
    getScreenId() {
        let screenId;
        const debugInfo = {
            source: null,
            value: null,
            props: this.props,
            action: this.props?.action,
            actionParams: this.props?.action?.params,
            actionContext: this.props?.action?.context,
            url: window.location.href,
            hash: window.location.hash,
            search: window.location.search
        };
        
        console.log('[KITCHEN EXT] 🔍 Starting screen_id detection...');
        
        // Priorités de détection
        if (this.props?.action?.params?.screen_id) {
            screenId = this.props.action.params.screen_id;
            debugInfo.source = 'action.params';
        }
        else if (this.props?.action?.context?.screen_id) {
            screenId = this.props.action.context.screen_id;
            debugInfo.source = 'action.context.screen_id';
        }
        else if (this.props?.action?.context?.default_screen_id) {
            screenId = this.props.action.context.default_screen_id;
            debugInfo.source = 'action.context.default_screen_id';
        }
        else if (this.props?.action?.context?.active_id) {
            screenId = this.props.action.context.active_id;
            debugInfo.source = 'action.context.active_id';
        }
        else if (this.props?.screen_id) {
            screenId = this.props.screen_id;
            debugInfo.source = 'props.screen_id';
        }
        else if (window.location.hash.includes('screen_id')) {
            try {
                const hashPart = window.location.hash.split('?')[1];
                if (hashPart) {
                    const hashParams = new URLSearchParams(hashPart);
                    screenId = hashParams.get('screen_id');
                    debugInfo.source = 'URL hash params';
                }
            } catch (e) {
                console.warn('[KITCHEN EXT] Error parsing hash:', e);
            }
        }
        else if (window.location.search.includes('screen_id')) {
            const urlParams = new URLSearchParams(window.location.search);
            screenId = urlParams.get('screen_id');
            debugInfo.source = 'URL search params';
        }
        else if (screenMemoryStore.currentScreenId) {
            screenId = screenMemoryStore.currentScreenId;
            debugInfo.source = 'memory store';
        }
        
        // Stocker en mémoire
        if (screenId) {
            const parsedId = parseInt(screenId, 10);
            if (!isNaN(parsedId) && parsedId > 0) {
                screenMemoryStore.currentScreenId = parsedId;
                screenMemoryStore.screenHistory.push({
                    id: parsedId,
                    timestamp: Date.now(),
                    source: debugInfo.source
                });
            }
        }
        
        const parsedId = parseInt(screenId, 10) || 0;
        
        if (parsedId === 0) {
            console.error('[KITCHEN EXT] ❌ NO VALID SCREEN_ID FOUND!');
            console.error('[KITCHEN EXT] Debug info:', debugInfo);
        } else {
            console.log(`[KITCHEN EXT] ✅ Final screen_id: ${parsedId} (source: ${debugInfo.source})`);
        }
        
        return parsedId;
    },

    /**
     * ✅ CORRECTION MAJEURE: Chargement des commandes avec filtrage Many2many
     */
   
    async loadOrders() {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`[KITCHEN EXT] 🚀 LOAD_ORDERS STARTED`);
        console.log(`[KITCHEN EXT] 📍 screenId: ${this.screenId}, shopId: ${this.currentShopId}`);
        console.log(`${'='.repeat(80)}`);

        if (!this.screenId || this.screenId === 0) {
            console.error('[KITCHEN EXT] ❌ CRITICAL: Cannot load orders - invalid screen_id');
            this.state.order_details = [];
            this.state.lines = [];
            return;
        }

        if (this.state.isLoading) {
            console.log('[KITCHEN EXT] ⏳ Load already in progress, skipping...');
            return;
        }

        try {
            this.state.isLoading = true;
            
            console.log(`[KITCHEN EXT] 📥 Calling RPC: get_details(${this.currentShopId}, ${this.screenId})`);
            
            // ✅ APPEL RPC
            const result = await this.orm.call(
                "pos.order", 
                "get_details", 
                [this.currentShopId, this.screenId]
            );

            console.log('[KITCHEN EXT] 📦 RPC Response received:', {
                resultType: typeof result,
                ordersCount: result?.orders?.length || 0,
                linesCount: result?.order_lines?.length || 0,
                screenInfo: {
                    id: result?.screen_id,
                    name: result?.screen_name,
                    categories: result?.screen_categories
                }
            });

            // ✅ VALIDATION
            if (!result || typeof result !== 'object') {
                console.error('[KITCHEN EXT] ❌ Invalid RPC response');
                this.state.order_details = [];
                this.state.lines = [];
                return;
            }

            if (result.error) {
                console.error('[KITCHEN EXT] ❌ Backend error:', result.error);
                this.state.order_details = [];
                this.state.lines = [];
                return;
            }

            // ✅ EXTRACTION DIRECTE (le backend a déjà tout filtré !)
            const orders = result.orders || [];
            const lines = result.order_lines || [];
            
            console.log(`[KITCHEN EXT] 📊 Backend returned ${orders.length} orders, ${lines.length} lines`);

            // ✅ PAS DE FILTRAGE SUPPLÉMENTAIRE !
            // Le backend a déjà fait tout le travail
            this.state.order_details = orders;
            this.state.lines = lines;

            // ✅ Logs détaillés des commandes reçues
            if (orders.length > 0) {
                console.log(`[KITCHEN EXT] 📋 Orders for this screen:`);
                orders.forEach(order => {
                    console.log(
                        `  - ${order.name}: status=${order.order_status}, ` +
                        `screens=${JSON.stringify(order.screen_ids)}`
                    );
                });
            } else {
                console.warn(`[KITCHEN EXT] ⚠ NO orders for this screen`);
            }

            // ✅ Récupération des temps de préparation
            console.log(`[KITCHEN EXT] ⏱️ Fetching preparation times...`);
            
            const productIds = [...new Set(lines.map(line => {
                if (Array.isArray(line.product_id)) {
                    return line.product_id[0];
                } else if (typeof line.product_id === 'object' && line.product_id !== null) {
                    return line.product_id.id;
                } else {
                    return line.product_id;
                }
            }).filter(id => id))];

            console.log(`[KITCHEN EXT]   - Unique product IDs: [${productIds.join(', ')}]`);

            if (productIds.length > 0) {
                try {
                    const overTimes = await this.orm.call(
                        "product.product",
                        "search_read",
                        [[["id", "in", productIds]], ["id", "prepair_time_minutes"]]
                    );

                    this.state.prepare_times = overTimes.map(item => {
                        const prepareTime = !item.prepair_time_minutes ? "00:00:00" :
                            typeof item.prepair_time_minutes === 'number' ?
                            parseFloat(item.prepair_time_minutes.toFixed(2)) :
                            item.prepair_time_minutes;
                        
                        return {
                            ...item,
                            prepare_time: prepareTime
                        };
                    });
                    
                    console.log(`[KITCHEN EXT] ✅ Received ${overTimes.length} preparation times`);
                } catch (timeError) {
                    console.error('[KITCHEN EXT] ❌ Error fetching preparation times:', timeError);
                    this.state.prepare_times = [];
                }
            } else {
                this.state.prepare_times = [];
            }

            // ✅ Calcul des compteurs (basés sur les commandes reçues)
            this.state.draft_count = orders.filter(o => o.order_status === 'draft').length;
            this.state.waiting_count = orders.filter(o => o.order_status === 'waiting').length;
            this.state.ready_count = orders.filter(o => o.order_status === 'ready').length;

            console.log(`[KITCHEN EXT] 📊 Order counts:`);
            console.log(`  - Draft: ${this.state.draft_count}`);
            console.log(`  - Waiting: ${this.state.waiting_count}`);
            console.log(`  - Ready: ${this.state.ready_count}`);
            console.log(`  - Total visible: ${orders.length}`);

            // ✅ Gestion des countdowns
            console.log(`[KITCHEN EXT] ⏰ Managing countdowns...`);
            
            orders.forEach(order => {
                if (order.order_status === 'waiting' && order.avg_prepare_time) {
                    if (!this.countdownIntervals[order.id]) {
                        console.log(`[KITCHEN EXT]   → Starting countdown for order ${order.id}`);
                        this.startCountdown(order.id, order.avg_prepare_time, order.config_id);
                    }
                } else if (order.order_status === 'ready') {
                    this.updateCountdownState(order.id, 0, true);
                    if (this.countdownIntervals[order.id]) {
                        clearInterval(this.countdownIntervals[order.id]);
                        delete this.countdownIntervals[order.id];
                    }
                }
            });

            console.log(`\n${'='.repeat(80)}`);
            console.log(`[KITCHEN EXT] ✅ LOAD_ORDERS COMPLETED SUCCESSFULLY`);
            console.log(`[KITCHEN EXT] 📊 FINAL: ${orders.length} orders visible on this screen`);
            console.log(`${'='.repeat(80)}\n`);

        } catch (error) {
            console.error(`\n${'='.repeat(80)}`);
            console.error("[KITCHEN EXT] ❌ CRITICAL ERROR in loadOrders:", error);
            console.error(`${'='.repeat(80)}\n`);
            
            this.state.order_details = [];
            this.state.lines = [];
            this.state.prepare_times = [];
            this.state.draft_count = 0;
            this.state.waiting_count = 0;
            this.state.ready_count = 0;
        } finally {
            this.state.isLoading = false;
        }
    },


    /**
     * ✅ Validation des messages bus (existant)
     */
    onPosOrderCreation(message) {
        if (!message || typeof message !== 'object') {
            console.warn('[KITCHEN EXT] Invalid message:', message);
            return;
        }

        console.log(`[KITCHEN EXT] 📨 Received message:`, message);

        // Vérifier que le message concerne CE screen_id
        const configMatch = message.config_id === this.currentShopId;
        const screenMatch = !message.screen_id || message.screen_id === this.screenId;
        
        if (!configMatch) {
            console.log(`[KITCHEN EXT] Message filtered (config: ${configMatch})`);
            return;
        }
        
        // Si le message a un screen_id spécifique, vérifier la correspondance
        if (message.screen_id && message.screen_id !== this.screenId) {
            console.log(`[KITCHEN EXT] Message for different screen: ${message.screen_id} (current: ${this.screenId})`);
            return;
        }

        const relevantMessages = [
            'new_order', 'order_status_change', 'order_accepted', 
            'order_completed', 'order_cancelled', 'order_line_updated'
        ];

        if (relevantMessages.includes(message.type)) {
            console.log(`[KITCHEN EXT] ✅ Processing: ${message.type}`);
            
            // ✅ AJOUTER UN DÉLAI pour laisser le temps à la BD de se mettre à jour
            setTimeout(() => {
                console.log(`[KITCHEN EXT] 🔄 Reloading orders after notification`);
                this.loadOrders();
            }, 1000); // 1 seconde de délai
        }
    },

    /**
     * ✅ NETTOYAGE: Arrêter le son quand le composant est détruit
     */
    
    /**
     * ✅ NETTOYAGE AMÉLIORÉ
     */
   /**
 * ✅ NETTOYAGE AMÉLIORÉ
 */
    willDestroy() {
        console.log('[KITCHEN EXT] 🧹 Cleaning up...');
        
        // Arrêter le son
        if (this.soundManager) {
            this.soundManager.stop();
        }
        
        // Arrêter le polling
        if (this._pollingInterval) {
            clearInterval(this._pollingInterval);
            console.log('[KITCHEN EXT] ⏰ Polling stopped');
        }
        
        // Retirer les écouteurs
        try {
            this.env.bus.removeEventListener('pos-kitchen-new-order', this.handleNewOrderNotification.bind(this));
            this.env.bus.removeEventListener('kitchen-screen-notification', this.handleNewOrderNotification.bind(this));
            window.removeEventListener('kitchen-new-order-global', this._globalEventHandler);
            
            if (this._busService) {
                this._busService.removeEventListener('notification', this._handleBackendNotificationEvent.bind(this));
            }
        } catch (error) {
            console.warn('[KITCHEN EXT] ⚠️ Error removing listeners:', error);
        }
        
        console.log('[KITCHEN EXT] ✅ Cleanup completed');
        
        super.willDestroy();
    },

});

console.log('[KITCHEN EXT] ✅ Kitchen Screen Extension loaded (Multi-Screen Many2many Support + Notifications)');