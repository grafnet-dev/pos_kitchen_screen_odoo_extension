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

// ✅ Gestionnaire de son
class NotificationSoundManager {
    constructor() {
        this.audioContext = null;
        this.soundUrl = '/pos_kitchen_screen_odoo_extension/static/src/sounds/notification.mp3';
        this.audioElement = null;
        this.isPlaying = false;
    }

    async init() {
        try {
            // Créer un élément audio
            this.audioElement = new Audio(this.soundUrl);
            this.audioElement.preload = 'auto';
            
            // Précharger le son
            this.audioElement.load();
            
            console.log('[SOUND MANAGER] ✅ Audio element initialized');
        } catch (error) {
            console.error('[SOUND MANAGER] ❌ Error initializing audio:', error);
        }
    }

    async play() {
        if (this.isPlaying) {
            console.log('[SOUND MANAGER] ⏸️ Sound already playing, skipping');
            return;
        }

        try {
            this.isPlaying = true;
            
            if (this.audioElement) {
                // Réinitialiser le son s'il était déjà joué
                this.audioElement.currentTime = 0;
                
                // Jouer le son
                await this.audioElement.play();
                console.log('[SOUND MANAGER] 🔔 Notification sound played');
                
                // Réinitialiser l'état après la fin de la lecture
                this.audioElement.onended = () => {
                    this.isPlaying = false;
                };
            } else {
                console.warn('[SOUND MANAGER] ⚠️ Audio element not available');
                this.isPlaying = false;
            }
        } catch (error) {
            console.error('[SOUND MANAGER] ❌ Error playing sound:', error);
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
        // ✅ INITIALISATION DU GESTIONNAIRE DE SON
        this.soundManager = new NotificationSoundManager();
        this.soundManager.init();
        
        // ✅ ÉCOUTE DES NOUVELLES COMMANDES (Frontend bus)
        this.env.bus.addEventListener('pos-kitchen-new-order', this.handleNewOrderNotification.bind(this));
        
        // ✅ ÉCOUTE DES NOTIFICATIONS BACKEND (Bus Odoo)
        try {
            // Tenter différents noms de service bus selon la version d'Odoo
            const busService = this.env.services.bus || this.env.services.bus_service || this.env.services['bus.bus'];
            
            if (busService && typeof busService.addChannel === 'function') {
                console.log(`[KITCHEN EXT] 📡 Subscribing to backend channel: ${this.screenChannel}`);
                busService.addChannel(this.screenChannel);
                busService.addEventListener('notification', this.handleBackendNotification.bind(this));
                this._busService = busService; // Stocker pour cleanup
            } else {
                console.warn('[KITCHEN EXT] ⚠️ Bus service not available or incompatible');
                console.log('[KITCHEN EXT] Available services:', Object.keys(this.env.services));
            }
        } catch (busError) {
            console.warn('[KITCHEN EXT] ⚠️ Error initializing bus service:', busError);
        }
        
        console.log(`[KITCHEN EXT] ✅ Screen initialized with ID: ${this.screenId}`);
        console.log(`[KITCHEN EXT] ✅ Channel: ${this.screenChannel}`);
        console.log(`[KITCHEN EXT] 🔊 Sound manager initialized`);
    },

    /**
     * ✅ GESTIONNAIRE DE NOTIFICATION DE NOUVELLE COMMANDE
     */
    handleNewOrderNotification(event) {
        const message = event.detail;
        
        if (!message || typeof message !== 'object') {
            console.warn('[KITCHEN EXT] ❌ Invalid new order message:', message);
            return;
        }

        console.log(`[KITCHEN EXT] 📨 Received new order notification:`, {
            screen_id: message.screen_id,
            order_reference: message.order_reference,
            type: message.type
        });

        // ✅ Vérifier que la notification est pour CET écran
        const isForThisScreen = message.screen_id === this.screenId;
        const isForThisConfig = message.config_id === this.currentShopId;
        
        if (!isForThisScreen) {
            console.log(`[KITCHEN EXT] 📭 Notification for different screen: ${message.screen_id} (current: ${this.screenId})`);
            return;
        }
        
        if (!isForThisConfig) {
            console.log(`[KITCHEN EXT] 📭 Notification for different config: ${message.config_id} (current: ${this.currentShopId})`);
            return;
        }

        console.log(`[KITCHEN EXT] ✅ New order notification IS FOR THIS SCREEN!`);

        // ✅ DÉCLENCHER LA NOTIFICATION VISUELLE ET SONORE
        this.triggerNewOrderAlert(message);
    },

    /**
     * ✅ DÉCLENCHEUR D'ALERTE POUR NOUVELLE COMMANDE
     */
    async triggerNewOrderAlert(message) {
        try {
            console.log(`[KITCHEN EXT] 🚨 TRIGGERING NEW ORDER ALERT`);
            
            // ✅ 1. JOUER LE SON DE NOTIFICATION
            await this.playNotificationSound();
            
            // ✅ 2. AFFICHER LA NOTIFICATION VISUELLE
            this.showVisualNotification(message);
            
            // ✅ 3. ACTUALISER LES COMMANDES
            setTimeout(() => {
                console.log(`[KITCHEN EXT] 🔄 Reloading orders after new order notification`);
                this.loadOrders();
            }, 1500);
            
        } catch (error) {
            console.error('[KITCHEN EXT] ❌ Error in new order alert:', error);
        }
    },

    /**
     * ✅ JOUER LE SON DE NOTIFICATION
     */
    async playNotificationSound() {
        try {
            console.log(`[KITCHEN EXT] 🔔 Playing notification sound`);
            await this.soundManager.play();
        } catch (error) {
            console.error('[KITCHEN EXT] ❌ Error playing notification sound:', error);
        }
    },

    /**
     * ✅ AFFICHER LA NOTIFICATION VISUELLE
     */
    showVisualNotification(message) {
        try {
            // Option 1: Utiliser le service de notification Odoo si disponible
            if (this.env.services.notification) {
                this.env.services.notification.add(
                    `🆕 Nouvelle commande reçue: ${message.order_reference || 'Commande'}`,
                    { 
                        type: 'info',
                        sticky: true, // Rester visible
                        className: 'kitchen-new-order-notification'
                    }
                );
            }
            
            // Option 2: Animation visuelle personnalisée
            this.triggerVisualAlert();
            
            console.log(`[KITCHEN EXT] 👁️ Visual notification displayed for order: ${message.order_reference}`);
            
        } catch (error) {
            console.error('[KITCHEN EXT] ❌ Error showing visual notification:', error);
        }
    },

    /**
     * ✅ ALERTE VISUELLE PERSONNALISÉE
     */
    triggerVisualAlert() {
        try {
            // Créer un élément de surbrillance temporaire
            const alertOverlay = document.createElement('div');
            alertOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 150, 255, 0.3);
                z-index: 9999;
                pointer-events: none;
                animation: flashAlert 2s ease-in-out;
            `;
            
            // Ajouter l'animation CSS
            const style = document.createElement('style');
            style.textContent = `
                @keyframes flashAlert {
                    0% { opacity: 0; background: rgba(0, 150, 255, 0); }
                    25% { opacity: 1; background: rgba(0, 150, 255, 0.3); }
                    50% { opacity: 0.5; background: rgba(0, 150, 255, 0.15); }
                    75% { opacity: 1; background: rgba(0, 150, 255, 0.3); }
                    100% { opacity: 0; background: rgba(0, 150, 255, 0); }
                }
            `;
            
            document.head.appendChild(style);
            document.body.appendChild(alertOverlay);
            
            // Supprimer après l'animation
            setTimeout(() => {
                if (alertOverlay.parentNode) {
                    alertOverlay.parentNode.removeChild(alertOverlay);
                }
                if (style.parentNode) {
                    style.parentNode.removeChild(style);
                }
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
        console.log(`\n${'='*80}`);
        console.log(`[KITCHEN EXT] 🚀 LOAD_ORDERS STARTED`);
        console.log(`[KITCHEN EXT] 📍 screenId: ${this.screenId}, shopId: ${this.currentShopId}`);
        console.log(`${'='*80}`);

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
            
            console.log(`[KITCHEN EXT] 📥 STEP 1: Calling RPC get_details(${this.currentShopId}, ${this.screenId})`);
            
            // ✅ ÉTAPE 1: APPEL RPC
            const result = await this.orm.call(
                "pos.order", 
                "get_details", 
                [this.currentShopId, this.screenId]
            );

            console.log('[KITCHEN EXT] 📦 STEP 2: RPC Response received:', {
                resultType: typeof result,
                resultExists: !!result,
                isObject: result && typeof result === 'object',
                resultKeys: result ? Object.keys(result) : 'NO RESULT'
            });

            // ✅ ÉTAPE 2: VALIDATION DE LA RÉPONSE
            if (!result) {
                console.error('[KITCHEN EXT] ❌ RPC returned NULL result');
                this.state.order_details = [];
                this.state.lines = [];
                return;
            }

            if (typeof result !== 'object') {
                console.error('[KITCHEN EXT] ❌ RPC returned non-object result:', typeof result);
                this.state.order_details = [];
                this.state.lines = [];
                return;
            }

            if (result.error) {
                console.error('[KITCHEN EXT] ❌ Backend error in response:', result.error);
                this.state.order_details = [];
                this.state.lines = [];
                return;
            }

            console.log('[KITCHEN EXT] ✅ RPC Response validated successfully');

            // ✅ ÉTAPE 3: EXTRACTION DES DONNÉES
            const rawOrders = result.orders || [];
            const rawLines = result.order_lines || [];
            
            console.log(`[KITCHEN EXT] 📊 STEP 3: Data extraction - ${rawOrders.length} raw orders, ${rawLines.length} raw lines`);
            console.log(`[KITCHEN EXT] 📋 Screen info: ${result.screen_name || 'N/A'} (ID: ${result.screen_id}), Categories: ${result.screen_categories || 'N/A'}`);

            this.state.order_details = rawOrders;
            this.state.lines = rawLines;

            // ✅ ÉTAPE 4: FILTRAGE MANY2MANY AVEC LOGS DÉTAILLÉS
            console.log(`\n[KITCHEN EXT] 🔍 STEP 4: Many2many filtering for screen ${this.screenId}`);
            
            const activeOrders = this.state.order_details.filter(order => {
                console.log(`\n[KITCHEN EXT] 🔍 Processing order: ${order.name || order.id}`);
                console.log(`[KITCHEN EXT]   - Order ID: ${order.id}`);
                console.log(`[KITCHEN EXT]   - Order status: ${order.order_status}`);
                console.log(`[KITCHEN EXT]   - Order state: ${order.state}`);
                console.log(`[KITCHEN EXT]   - Config ID: ${JSON.stringify(order.config_id)}`);
                console.log(`[KITCHEN EXT]   - Screen IDs: ${JSON.stringify(order.screen_ids)}`);

                // Vérification de la configuration POS
                let configMatch = false;
                if (Array.isArray(order.config_id)) {
                    configMatch = order.config_id[0] === this.currentShopId;
                    console.log(`[KITCHEN EXT]   - Config match (array): ${configMatch} (order: ${order.config_id[0]}, current: ${this.currentShopId})`);
                } else if (typeof order.config_id === 'object' && order.config_id !== null) {
                    configMatch = order.config_id.id === this.currentShopId;
                    console.log(`[KITCHEN EXT]   - Config match (object): ${configMatch} (order: ${order.config_id.id}, current: ${this.currentShopId})`);
                } else {
                    configMatch = order.config_id === this.currentShopId;
                    console.log(`[KITCHEN EXT]   - Config match (direct): ${configMatch} (order: ${order.config_id}, current: ${this.currentShopId})`);
                }

                // ✅ CORRECTION CRITIQUE: Vérification Many2many screen_ids
                let screenMatch = false;
                if (order.screen_ids && Array.isArray(order.screen_ids)) {
                    console.log(`[KITCHEN EXT]   - Raw screen_ids: ${JSON.stringify(order.screen_ids)}`);
                    
                    // Extraire les IDs purs du Many2many
                    const screenIds = order.screen_ids.map(item => {
                        if (Array.isArray(item)) {
                            // Format Odoo Many2many: [[id1, "name1"], [id2, "name2"]]
                            console.log(`[KITCHEN EXT]     → Many2many item: [${item[0]}, "${item[1]}"]`);
                            return item[0];
                        } else {
                            // Format simple: [id1, id2, id3]
                            console.log(`[KITCHEN EXT]     → Simple ID: ${item}`);
                            return item;
                        }
                    });
                    
                    console.log(`[KITCHEN EXT]   - Extracted screen IDs: [${screenIds.join(', ')}]`);
                    console.log(`[KITCHEN EXT]   - Looking for screen ID: ${this.screenId}`);
                    
                    screenMatch = screenIds.includes(this.screenId);
                    console.log(`[KITCHEN EXT]   - Screen match: ${screenMatch}`);
                    
                } else {
                    console.warn(`[KITCHEN EXT]   ❌ No screen_ids field or invalid format:`, order.screen_ids);
                    screenMatch = false;
                }

                // Vérification du statut
                const statusMatch = order.order_status !== 'cancel' && order.state !== 'cancel';
                console.log(`[KITCHEN EXT]   - Status match: ${statusMatch} (order_status: ${order.order_status}, state: ${order.state})`);

                const finalMatch = configMatch && screenMatch && statusMatch;
                console.log(`[KITCHEN EXT]   🎯 FINAL MATCH: ${finalMatch}`);

                if (!finalMatch) {
                    console.log(`[KITCHEN EXT]   ❌ FILTERED OUT: config=${configMatch}, screen=${screenMatch}, status=${statusMatch}`);
                } else {
                    console.log(`[KITCHEN EXT]   ✅ VISIBLE ON SCREEN`);
                }

                return finalMatch;
            });

            console.log(`\n[KITCHEN EXT] ✅ STEP 4 COMPLETE: ${activeOrders.length} visible orders after filtering`);

            // ✅ ÉTAPE 5: RÉCUPÉRATION DES TEMPS DE PRÉPARATION
            console.log(`[KITCHEN EXT] ⏱️ STEP 5: Fetching preparation times`);
            
            const productIds = [...new Set(this.state.lines.map(line => {
                let productId;
                
                if (Array.isArray(line.product_id)) {
                    productId = line.product_id[0];
                    console.log(`[KITCHEN EXT]   - Line ${line.id}: product_id array → ${productId}`);
                } else if (typeof line.product_id === 'object' && line.product_id !== null) {
                    productId = line.product_id.id;
                    console.log(`[KITCHEN EXT]   - Line ${line.id}: product_id object → ${productId}`);
                } else {
                    productId = line.product_id;
                    console.log(`[KITCHEN EXT]   - Line ${line.id}: product_id direct → ${productId}`);
                }
                
                return productId;
            }).filter(id => id))];

            console.log(`[KITCHEN EXT]   - Unique product IDs: [${productIds.join(', ')}]`);

            if (productIds.length > 0) {
                try {
                    console.log(`[KITCHEN EXT]   - Calling product.search_read for ${productIds.length} products`);
                    
                    const overTimes = await this.orm.call(
                        "product.product",
                        "search_read",
                        [[["id", "in", productIds]], ["id", "prepair_time_minutes"]]
                    );

                    console.log(`[KITCHEN EXT]   - Received ${overTimes.length} product time records`);

                    this.state.prepare_times = overTimes.map(item => {
                        const prepareTime = !item.prepair_time_minutes ? "00:00:00" :
                            typeof item.prepair_time_minutes === 'number' ?
                            parseFloat(item.prepair_time_minutes.toFixed(2)) :
                            item.prepair_time_minutes;
                        
                        console.log(`[KITCHEN EXT]     → Product ${item.id}: ${prepareTime}`);
                        return {
                            ...item,
                            prepare_time: prepareTime
                        };
                    });
                } catch (timeError) {
                    console.error('[KITCHEN EXT] ❌ Error fetching preparation times:', timeError);
                    this.state.prepare_times = [];
                }
            } else {
                console.log('[KITCHEN EXT]   - No product IDs found for time fetching');
                this.state.prepare_times = [];
            }

            // ✅ ÉTAPE 6: CALCUL DES COMPTEURS
            console.log(`[KITCHEN EXT] 📊 STEP 6: Calculating order counts`);
            
            this.state.draft_count = activeOrders.filter(o => o.order_status === 'draft').length;
            this.state.waiting_count = activeOrders.filter(o => o.order_status === 'waiting').length;
            this.state.ready_count = activeOrders.filter(o => o.order_status === 'ready').length;

            console.log(`[KITCHEN EXT]   - Draft orders: ${this.state.draft_count}`);
            console.log(`[KITCHEN EXT]   - Waiting orders: ${this.state.waiting_count}`);
            console.log(`[KITCHEN EXT]   - Ready orders: ${this.state.ready_count}`);
            console.log(`[KITCHEN EXT]   - Total visible: ${activeOrders.length}`);

            // ✅ ÉTAPE 7: GESTION DES COUNTDOWNS
            console.log(`[KITCHEN EXT] ⏰ STEP 7: Managing countdowns`);
            
            activeOrders.forEach(order => {
                console.log(`[KITCHEN EXT]   - Order ${order.id}: status=${order.order_status}, avg_time=${order.avg_prepare_time}`);
                
                if (order.order_status === 'waiting' && order.avg_prepare_time) {
                    if (!this.countdownIntervals[order.id]) {
                        console.log(`[KITCHEN EXT]     → Starting countdown for order ${order.id}`);
                        this.startCountdown(order.id, order.avg_prepare_time, order.config_id);
                    } else {
                        console.log(`[KITCHEN EXT]     → Countdown already running for order ${order.id}`);
                    }
                } else if (order.order_status === 'ready') {
                    console.log(`[KITCHEN EXT]     → Order ${order.id} is ready, stopping countdown`);
                    this.updateCountdownState(order.id, 0, true);
                    if (this.countdownIntervals[order.id]) {
                        clearInterval(this.countdownIntervals[order.id]);
                        delete this.countdownIntervals[order.id];
                    }
                }
            });

            console.log(`\n${'='*80}`);
            console.log(`[KITCHEN EXT] ✅ LOAD_ORDERS COMPLETED SUCCESSFULLY`);
            console.log(`[KITCHEN EXT] 📊 FINAL: ${activeOrders.length} orders, ${this.state.lines.length} lines`);
            console.log(`${'='*80}\n`);

        } catch (error) {
            console.error(`\n${'='*80}`);
            console.error("[KITCHEN EXT] ❌ CRITICAL ERROR in loadOrders:", error);
            console.error(`${'='*80}\n`);
            
            this.state.order_details = [];
            this.state.lines = [];
            this.state.prepare_times = [];
            this.state.draft_count = 0;
            this.state.waiting_count = 0;
            this.state.ready_count = 0;
        } finally {
            this.state.isLoading = false;
            console.log('[KITCHEN EXT] 🏁 Loading state reset to false');
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
    willDestroy() {
        if (this.soundManager) {
            this.soundManager.stop();
        }
        
        // Retirer l'écouteur d'événements
        this.env.bus.removeEventListener('pos-kitchen-new-order', this.handleNewOrderNotification.bind(this));
        
        super.willDestroy();
    }
});

console.log('[KITCHEN EXT] ✅ Kitchen Screen Extension loaded (Multi-Screen Many2many Support + Notifications)');