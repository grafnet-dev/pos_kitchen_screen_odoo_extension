/** @odoo-module */
import { patch } from "@web/core/utils/patch";
import { registry } from "@web/core/registry";

// Récupération de l'action de base
let KitchenScreenDashboard;
try {
    KitchenScreenDashboard = registry
        .category("actions")
        .get("kitchen_custom_dashboard_tags");
    console.log('[KITCHEN NOTIF] ✅ Base action found:', KitchenScreenDashboard);
} catch (e) {
    console.error('[KITCHEN NOTIF] ❌ Base action NOT found! Error:', e);
    throw new Error('Kitchen base action not found. Make sure the base module is loaded first.');
}

// Stockage en mémoire global
const screenMemoryStore = {
    currentScreenId: null,
    screenHistory: []
};

// Gestionnaire de notification sonore
class NotificationSoundManager {
    constructor() {
        this.audio = null;
        this.soundPath = '/pos_kitchen_screen_odoo_extension/static/src/sounds/notification.mp3';
        this.isInitialized = false;
    }

    initialize() {
        if (this.isInitialized) return;
        
        try {
            this.audio = new Audio(this.soundPath);
            this.audio.preload = 'auto';
            this.audio.volume = 0.8; // Volume à 80%
            this.isInitialized = true;
            console.log('[KITCHEN NOTIF] 🔊 Sound manager initialized');
        } catch (error) {
            console.error('[KITCHEN NOTIF] ❌ Error initializing sound:', error);
        }
    }

    async play() {
        if (!this.isInitialized) {
            this.initialize();
        }

        if (!this.audio) {
            console.warn('[KITCHEN NOTIF] ⚠️ Audio not initialized');
            return;
        }

        try {
            // Réinitialiser la position pour permettre plusieurs notifications rapides
            this.audio.currentTime = 0;
            
            const playPromise = this.audio.play();
            
            if (playPromise !== undefined) {
                await playPromise;
                console.log('[KITCHEN NOTIF] 🔊 Sound played successfully');
            }
        } catch (error) {
            // Gérer l'erreur si l'utilisateur n'a pas interagi avec la page
            if (error.name === 'NotAllowedError') {
                console.warn('[KITCHEN NOTIF] ⚠️ Sound blocked by browser (user interaction required)');
            } else {
                console.error('[KITCHEN NOTIF] ❌ Error playing sound:', error);
            }
        }
    }
}

// Instance globale du gestionnaire de son
const soundManager = new NotificationSoundManager();

// Patch de l'action
patch(KitchenScreenDashboard.prototype, {
    setup() {
        super.setup();
        
        console.log('[KITCHEN NOTIF] 🔍 Setup called with props:', this.props);
        
        this.screenId = this.getScreenId();
        
        if (!this.screenId || this.screenId === 0) {
            console.error('[KITCHEN NOTIF] ⚠️ CRITICAL: Invalid screen_id!');
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
        
        // ✅ Initialiser le gestionnaire de son
        soundManager.initialize();
        
        console.log(`[KITCHEN NOTIF] ✅ Screen initialized with ID: ${this.screenId}`);
        console.log(`[KITCHEN NOTIF] ✅ Channel: ${this.screenChannel}`);
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
        
        console.log('[KITCHEN NOTIF] 🔍 Starting screen_id detection...');
        
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
                console.warn('[KITCHEN NOTIF] Error parsing hash:', e);
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
            console.error('[KITCHEN NOTIF] ❌ NO VALID SCREEN_ID FOUND!');
            console.error('[KITCHEN NOTIF] Debug info:', debugInfo);
        } else {
            console.log(`[KITCHEN NOTIF] ✅ Final screen_id: ${parsedId} (source: ${debugInfo.source})`);
        }
        
        return parsedId;
    },

    /**
     * ✅ Afficher une notification visuelle
     */
    showVisualNotification(orderReference, screenName) {
        if (!this.env.services.notification) {
            console.warn('[KITCHEN NOTIF] ⚠️ Notification service not available');
            return;
        }

        try {
            this.env.services.notification.add(
                `🔔 Nouvelle commande: ${orderReference}`,
                {
                    type: 'success',
                    title: `📍 ${screenName || 'Cuisine'}`,
                    sticky: false,
                    className: 'kitchen_new_order_notification'
                }
            );
            console.log(`[KITCHEN NOTIF] ✅ Visual notification shown for ${orderReference}`);
        } catch (error) {
            console.error('[KITCHEN NOTIF] ❌ Error showing notification:', error);
        }
    },

    /**
     * ✅ Jouer le son de notification
     */
    async playNotificationSound() {
        try {
            await soundManager.play();
        } catch (error) {
            console.error('[KITCHEN NOTIF] ❌ Error playing notification sound:', error);
        }
    },

    /**
     * ✅ Notification complète (visuelle + sonore)
     */
    async triggerNewOrderNotification(orderReference, screenName) {
        console.log(`[KITCHEN NOTIF] 🔔 Triggering notification for order: ${orderReference}`);
        
        // Notification visuelle
        this.showVisualNotification(orderReference, screenName);
        
        // Alerte sonore
        await this.playNotificationSound();
        
        console.log(`[KITCHEN NOTIF] ✅ Complete notification triggered`);
    },

    /**
     * ✅ CORRECTION MAJEURE: Chargement des commandes avec filtrage Many2many
     */
    async loadOrders() {
        console.log(`\n${'='*80}`);
        console.log(`[KITCHEN NOTIF] 🚀 LOAD_ORDERS STARTED`);
        console.log(`[KITCHEN NOTIF] 📍 screenId: ${this.screenId}, shopId: ${this.currentShopId}`);
        console.log(`${'='*80}`);

        if (!this.screenId || this.screenId === 0) {
            console.error('[KITCHEN NOTIF] ❌ CRITICAL: Cannot load orders - invalid screen_id');
            this.state.order_details = [];
            this.state.lines = [];
            return;
        }

        if (this.state.isLoading) {
            console.log('[KITCHEN NOTIF] ⏳ Load already in progress, skipping...');
            return;
        }

        try {
            this.state.isLoading = true;
            
            console.log(`[KITCHEN NOTIF] 📥 STEP 1: Calling RPC get_details(${this.currentShopId}, ${this.screenId})`);
            
            // ✅ ÉTAPE 1: APPEL RPC
            const result = await this.orm.call(
                "pos.order", 
                "get_details", 
                [this.currentShopId, this.screenId]
            );

            console.log('[KITCHEN NOTIF] 📦 STEP 2: RPC Response received:', {
                resultType: typeof result,
                resultExists: !!result,
                isObject: result && typeof result === 'object',
                resultKeys: result ? Object.keys(result) : 'NO RESULT'
            });

            // ✅ ÉTAPE 2: VALIDATION DE LA RÉPONSE
            if (!result) {
                console.error('[KITCHEN NOTIF] ❌ RPC returned NULL result');
                this.state.order_details = [];
                this.state.lines = [];
                return;
            }

            if (typeof result !== 'object') {
                console.error('[KITCHEN NOTIF] ❌ RPC returned non-object result:', typeof result);
                this.state.order_details = [];
                this.state.lines = [];
                return;
            }

            if (result.error) {
                console.error('[KITCHEN NOTIF] ❌ Backend error in response:', result.error);
                this.state.order_details = [];
                this.state.lines = [];
                return;
            }

            console.log('[KITCHEN NOTIF] ✅ RPC Response validated successfully');

            // ✅ ÉTAPE 3: EXTRACTION DES DONNÉES
            const rawOrders = result.orders || [];
            const rawLines = result.order_lines || [];
            
            console.log(`[KITCHEN NOTIF] 📊 STEP 3: Data extraction - ${rawOrders.length} raw orders, ${rawLines.length} raw lines`);
            console.log(`[KITCHEN NOTIF] 📋 Screen info: ${result.screen_name || 'N/A'} (ID: ${result.screen_id}), Categories: ${result.screen_categories || 'N/A'}`);

            this.state.order_details = rawOrders;
            this.state.lines = rawLines;

            // ✅ ÉTAPE 4: FILTRAGE MANY2MANY AVEC LOGS DÉTAILLÉS
            console.log(`\n[KITCHEN NOTIF] 🔍 STEP 4: Many2many filtering for screen ${this.screenId}`);
            
            const activeOrders = this.state.order_details.filter(order => {
                console.log(`\n[KITCHEN NOTIF] 🔍 Processing order: ${order.name || order.id}`);
                console.log(`[KITCHEN NOTIF]   - Order ID: ${order.id}`);
                console.log(`[KITCHEN NOTIF]   - Order status: ${order.order_status}`);
                console.log(`[KITCHEN NOTIF]   - Order state: ${order.state}`);
                console.log(`[KITCHEN NOTIF]   - Config ID: ${JSON.stringify(order.config_id)}`);
                console.log(`[KITCHEN NOTIF]   - Screen IDs: ${JSON.stringify(order.screen_ids)}`);

                // Vérification de la configuration POS
                let configMatch = false;
                if (Array.isArray(order.config_id)) {
                    configMatch = order.config_id[0] === this.currentShopId;
                    console.log(`[KITCHEN NOTIF]   - Config match (array): ${configMatch} (order: ${order.config_id[0]}, current: ${this.currentShopId})`);
                } else if (typeof order.config_id === 'object' && order.config_id !== null) {
                    configMatch = order.config_id.id === this.currentShopId;
                    console.log(`[KITCHEN NOTIF]   - Config match (object): ${configMatch} (order: ${order.config_id.id}, current: ${this.currentShopId})`);
                } else {
                    configMatch = order.config_id === this.currentShopId;
                    console.log(`[KITCHEN NOTIF]   - Config match (direct): ${configMatch} (order: ${order.config_id}, current: ${this.currentShopId})`);
                }

                // ✅ CORRECTION CRITIQUE: Vérification Many2many screen_ids
                let screenMatch = false;
                if (order.screen_ids && Array.isArray(order.screen_ids)) {
                    console.log(`[KITCHEN NOTIF]   - Raw screen_ids: ${JSON.stringify(order.screen_ids)}`);
                    
                    // Extraire les IDs purs du Many2many
                    const screenIds = order.screen_ids.map(item => {
                        if (Array.isArray(item)) {
                            console.log(`[KITCHEN NOTIF]     → Many2many item: [${item[0]}, "${item[1]}"]`);
                            return item[0];
                        } else {
                            console.log(`[KITCHEN NOTIF]     → Simple ID: ${item}`);
                            return item;
                        }
                    });
                    
                    console.log(`[KITCHEN NOTIF]   - Extracted screen IDs: [${screenIds.join(', ')}]`);
                    console.log(`[KITCHEN NOTIF]   - Looking for screen ID: ${this.screenId}`);
                    
                    screenMatch = screenIds.includes(this.screenId);
                    console.log(`[KITCHEN NOTIF]   - Screen match: ${screenMatch}`);
                    
                } else {
                    console.warn(`[KITCHEN NOTIF]   ❌ No screen_ids field or invalid format:`, order.screen_ids);
                    screenMatch = false;
                }

                // Vérification du statut
                const statusMatch = order.order_status !== 'cancel' && order.state !== 'cancel';
                console.log(`[KITCHEN NOTIF]   - Status match: ${statusMatch} (order_status: ${order.order_status}, state: ${order.state})`);

                const finalMatch = configMatch && screenMatch && statusMatch;
                console.log(`[KITCHEN NOTIF]   🎯 FINAL MATCH: ${finalMatch}`);

                if (!finalMatch) {
                    console.log(`[KITCHEN NOTIF]   ❌ FILTERED OUT: config=${configMatch}, screen=${screenMatch}, status=${statusMatch}`);
                } else {
                    console.log(`[KITCHEN NOTIF]   ✅ VISIBLE ON SCREEN`);
                }

                return finalMatch;
            });

            console.log(`\n[KITCHEN NOTIF] ✅ STEP 4 COMPLETE: ${activeOrders.length} visible orders after filtering`);

            // ✅ ÉTAPE 5: RÉCUPÉRATION DES TEMPS DE PRÉPARATION
            console.log(`[KITCHEN NOTIF] ⏱️ STEP 5: Fetching preparation times`);
            
            const productIds = [...new Set(this.state.lines.map(line => {
                let productId;
                
                if (Array.isArray(line.product_id)) {
                    productId = line.product_id[0];
                    console.log(`[KITCHEN NOTIF]   - Line ${line.id}: product_id array → ${productId}`);
                } else if (typeof line.product_id === 'object' && line.product_id !== null) {
                    productId = line.product_id.id;
                    console.log(`[KITCHEN NOTIF]   - Line ${line.id}: product_id object → ${productId}`);
                } else {
                    productId = line.product_id;
                    console.log(`[KITCHEN NOTIF]   - Line ${line.id}: product_id direct → ${productId}`);
                }
                
                return productId;
            }).filter(id => id))];

            console.log(`[KITCHEN NOTIF]   - Unique product IDs: [${productIds.join(', ')}]`);

            if (productIds.length > 0) {
                try {
                    console.log(`[KITCHEN NOTIF]   - Calling product.search_read for ${productIds.length} products`);
                    
                    const overTimes = await this.orm.call(
                        "product.product",
                        "search_read",
                        [[["id", "in", productIds]], ["id", "prepair_time_minutes"]]
                    );

                    console.log(`[KITCHEN NOTIF]   - Received ${overTimes.length} product time records`);

                    this.state.prepare_times = overTimes.map(item => {
                        const prepareTime = !item.prepair_time_minutes ? "00:00:00" :
                            typeof item.prepair_time_minutes === 'number' ?
                            parseFloat(item.prepair_time_minutes.toFixed(2)) :
                            item.prepair_time_minutes;
                        
                        console.log(`[KITCHEN NOTIF]     → Product ${item.id}: ${prepareTime}`);
                        return {
                            ...item,
                            prepare_time: prepareTime
                        };
                    });
                } catch (timeError) {
                    console.error('[KITCHEN NOTIF] ❌ Error fetching preparation times:', timeError);
                    this.state.prepare_times = [];
                }
            } else {
                console.log('[KITCHEN NOTIF]   - No product IDs found for time fetching');
                this.state.prepare_times = [];
            }

            // ✅ ÉTAPE 6: CALCUL DES COMPTEURS
            console.log(`[KITCHEN NOTIF] 📊 STEP 6: Calculating order counts`);
            
            this.state.draft_count = activeOrders.filter(o => o.order_status === 'draft').length;
            this.state.waiting_count = activeOrders.filter(o => o.order_status === 'waiting').length;
            this.state.ready_count = activeOrders.filter(o => o.order_status === 'ready').length;

            console.log(`[KITCHEN NOTIF]   - Draft orders: ${this.state.draft_count}`);
            console.log(`[KITCHEN NOTIF]   - Waiting orders: ${this.state.waiting_count}`);
            console.log(`[KITCHEN NOTIF]   - Ready orders: ${this.state.ready_count}`);
            console.log(`[KITCHEN NOTIF]   - Total visible: ${activeOrders.length}`);

            // ✅ ÉTAPE 7: GESTION DES COUNTDOWNS
            console.log(`[KITCHEN NOTIF] ⏰ STEP 7: Managing countdowns`);
            
            activeOrders.forEach(order => {
                console.log(`[KITCHEN NOTIF]   - Order ${order.id}: status=${order.order_status}, avg_time=${order.avg_prepare_time}`);
                
                if (order.order_status === 'waiting' && order.avg_prepare_time) {
                    if (!this.countdownIntervals[order.id]) {
                        console.log(`[KITCHEN NOTIF]     → Starting countdown for order ${order.id}`);
                        this.startCountdown(order.id, order.avg_prepare_time, order.config_id);
                    } else {
                        console.log(`[KITCHEN NOTIF]     → Countdown already running for order ${order.id}`);
                    }
                } else if (order.order_status === 'ready') {
                    console.log(`[KITCHEN NOTIF]     → Order ${order.id} is ready, stopping countdown`);
                    this.updateCountdownState(order.id, 0, true);
                    if (this.countdownIntervals[order.id]) {
                        clearInterval(this.countdownIntervals[order.id]);
                        delete this.countdownIntervals[order.id];
                    }
                }
            });

            console.log(`\n${'='*80}`);
            console.log(`[KITCHEN NOTIF] ✅ LOAD_ORDERS COMPLETED SUCCESSFULLY`);
            console.log(`[KITCHEN NOTIF] 📊 FINAL: ${activeOrders.length} orders, ${this.state.lines.length} lines`);
            console.log(`${'='*80}\n`);

        } catch (error) {
            console.error(`\n${'='*80}`);
            console.error("[KITCHEN NOTIF] ❌ CRITICAL ERROR in loadOrders:", error);
            console.error(`${'='*80}\n`);
            
            this.state.order_details = [];
            this.state.lines = [];
            this.state.prepare_times = [];
            this.state.draft_count = 0;
            this.state.waiting_count = 0;
            this.state.ready_count = 0;
        } finally {
            this.state.isLoading = false;
            console.log('[KITCHEN NOTIF] 🏁 Loading state reset to false');
        }
    },

    /**
     * ✅ Validation des messages bus avec NOTIFICATION
     */
    onPosOrderCreation(message) {
        if (!message || typeof message !== 'object') {
            console.warn('[KITCHEN NOTIF] Invalid message:', message);
            return;
        }

        console.log(`[KITCHEN NOTIF] 📨 Received message:`, message);

        // Vérifier que le message concerne CE screen_id
        const configMatch = message.config_id === this.currentShopId;
        const screenMatch = !message.screen_id || message.screen_id === this.screenId;
        
        if (!configMatch) {
            console.log(`[KITCHEN NOTIF] Message filtered (config: ${configMatch})`);
            return;
        }
        
        // Si le message a un screen_id spécifique, vérifier la correspondance
        if (message.screen_id && message.screen_id !== this.screenId) {
            console.log(`[KITCHEN NOTIF] Message for different screen: ${message.screen_id} (current: ${this.screenId})`);
            return;
        }

        const relevantMessages = [
            'new_order', 'order_status_change', 'order_accepted', 
            'order_completed', 'order_cancelled', 'order_line_updated'
        ];

        if (relevantMessages.includes(message.type)) {
            console.log(`[KITCHEN NOTIF] ✅ Processing: ${message.type}`);
            
            // ✅ DÉCLENCHEUR DE NOTIFICATION pour nouvelle commande
            if (message.type === 'new_order') {
                const orderRef = message.order_reference || message.pos_reference || 'Nouvelle commande';
                const screenName = message.screen_name || 'Cuisine';
                
                console.log(`[KITCHEN NOTIF] 🔔 NEW ORDER DETECTED: ${orderRef} for screen ${screenName}`);
                
                // Déclencher notification visuelle + sonore
                this.triggerNewOrderNotification(orderRef, screenName);
            }
            
            // ✅ AJOUTER UN DÉLAI pour laisser le temps à la BD de se mettre à jour
            setTimeout(() => {
                console.log(`[KITCHEN NOTIF] 🔄 Reloading orders after notification`);
                this.loadOrders();
            }, 1000); // 1 seconde de délai
        }
    }
});

console.log('[KITCHEN NOTIF] ✅ Kitchen Screen Notification Extension loaded (Visual + Sound)');