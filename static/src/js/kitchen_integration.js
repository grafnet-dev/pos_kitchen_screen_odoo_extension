/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onMounted, onWillUnmount, useState, onPatched } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

export class KitchenScreenIntegration extends Component {
   
    setup() {
        // Services Odoo
        this.orm = useService("orm");
        this.busService = useService("bus_service");
        this.notification = useService("notification");
        
        this.state = useState({
            screenId: null,
            screen: null,
            category_ids: [],  // IDs des catégories de cet écran
            order_details: [], // Liste complète des commandes
            lines: [],         // Toutes les lignes de commandes
            prepare_times: [], // Temps de préparation par produit
            countdowns: {},    // Compteurs pour chaque commande
            draft_count: 0,
            waiting_count: 0,
            ready_count: 0,
            stages: 'draft',   // Stage actuel affiché
            isReady: false,
            soundEnabled: true,
            seenOrders: new Set() // Pour détecter les nouvelles commandes
        });

        onMounted(async () => {
            await this.initialize();
            this.startCountdowns();
        });

        onPatched(() => {
            // Appliquer le filtrage après chaque mise à jour du DOM
            this.applyClientSideFiltering();
        });

        onWillUnmount(() => {
            this.cleanup();
        });
    }

    async initialize() {
        console.log('[KITCHEN] Initializing...');
        
        this.state.screenId = this.getScreenId();
        
        if (!this.state.screenId) {
            console.error('[KITCHEN] No screen_id found');
            this.showError('Aucun écran de cuisine spécifié');
            return;
        }

        try {
            await this.loadScreenInfo();
            await this.loadCompleteOrderData();
            this.subscribeToBus();
            
            // Auto-refresh toutes les 30 secondes
            this.autoRefreshInterval = setInterval(() => {
                this.loadCompleteOrderData();
            }, 30000);
            
            this.state.isReady = true;
            console.log('[KITCHEN] Initialization complete');
            
        } catch (error) {
            console.error('[KITCHEN] Initialization error:', error);
            this.showError('Erreur lors de l\'initialisation');
        }
    }

    getScreenId() {
        if (window.kitchen_screen_config?.screen_id) {
            return window.kitchen_screen_config.screen_id;
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const screenId = urlParams.get('screen_id');
        
        return screenId ? parseInt(screenId) : null;
    }

    async loadScreenInfo() {
        try {
            console.log(`[KITCHEN] Loading screen info for ID ${this.state.screenId}...`);
            
            const result = await this.orm.call(
                'kitchen.screen',
                'get_screen_config',
                [[this.state.screenId]]
            );
            
            if (result && result.length > 0) {
                this.state.screen = result[0];
                this.state.category_ids = result[0].pos_categ_ids || [];
                this.state.soundEnabled = result[0].sound_enabled || false;
                
                console.log('[KITCHEN] Screen loaded:', this.state.screen);
                console.log('[KITCHEN] Categories:', this.state.category_ids);
            }
        } catch (error) {
            console.error('[KITCHEN] Error loading screen:', error);
            throw error;
        }
    }

    /**
     * Charge TOUTES les données nécessaires au template
     */
    async loadCompleteOrderData() {
        try {
            console.log(`[KITCHEN] Loading complete order data...`);
            
            // Appeler une méthode qui retourne TOUT
            const data = await this.orm.call(
                'kitchen.screen',
                'get_complete_kitchen_data',
                [[this.state.screenId]]
            );
            
            console.log('[KITCHEN] Received data:', data);
            
            // Mettre à jour le state avec toutes les données
            this.state.order_details = data.orders || [];
            this.state.lines = data.lines || [];
            this.state.prepare_times = data.prepare_times || [];
            
            // Détecter les nouvelles commandes
            this.detectNewOrders();
            
            this.updateOrderCounts();
            this.initializeCountdowns();
            
        } catch (error) {
            console.error('[KITCHEN] Error loading data:', error);
            this.state.order_details = [];
            this.state.lines = [];
        }
    }

    /**
     * Applique le filtrage côté client après le rendu
     */
    applyClientSideFiltering() {
        if (!this.state.category_ids || this.state.category_ids.length === 0) {
            return; // Pas de filtrage si aucune catégorie définie
        }

        // Parcourir toutes les cartes de commande dans le DOM
        const orderCards = document.querySelectorAll('.card[data-order-id]');
        
        orderCards.forEach(card => {
            const orderId = parseInt(card.getAttribute('data-order-id'));
            const order = this.state.order_details.find(o => o.id === orderId);
            
            if (order) {
                const matches = this.orderMatchesCategories(order, this.state.category_ids);
                
                if (matches) {
                    card.classList.remove('hidden-by-category', 'filtered-out');
                    card.classList.add('filtered-in');
                    
                    // Ajouter animation si nouvelle commande
                    if (this.isNewOrder(orderId)) {
                        card.classList.add('new-order-animation');
                        
                        // Retirer l'animation après 6 secondes
                        setTimeout(() => {
                            card.classList.remove('new-order-animation');
                        }, 6000);
                    }
                } else {
                    card.classList.add('hidden-by-category', 'filtered-out');
                    card.classList.remove('filtered-in', 'new-order-animation');
                }
            }
        });
    }

    /**
     * Détecte les nouvelles commandes pour jouer le son
     */
    detectNewOrders() {
        const currentOrderIds = new Set(
            this.state.order_details
                .filter(o => this.orderMatchesCategories(o, this.state.category_ids))
                .map(o => o.id)
        );
        
        // Trouver les nouvelles commandes
        const newOrders = [...currentOrderIds].filter(
            id => !this.state.seenOrders.has(id)
        );
        
        // Jouer le son pour chaque nouvelle commande
        if (newOrders.length > 0 && this.state.seenOrders.size > 0) {
            this.playSound('new_order');
            
            // Afficher notification
            newOrders.forEach(orderId => {
                const order = this.state.order_details.find(o => o.id === orderId);
                if (order) {
                    this.showOrderNotification(order);
                }
            });
        }
        
        // Mettre à jour la liste des commandes vues
        this.state.seenOrders = currentOrderIds;
    }

    /**
     * Vérifie si une commande correspond aux catégories de l'écran
     */
    orderMatchesCategories(order, categoryIds) {
        if (!categoryIds || categoryIds.length === 0) {
            return true; // Si pas de filtre, on affiche tout
        }
        
        // Vérifier si au moins un produit de la commande est dans nos catégories
        const orderLineIds = order.lines || [];
        
        for (const lineId of orderLineIds) {
            const line = this.state.lines.find(l => l.id === lineId);
            if (line && line.product_categ_id) {
                const productCategoryId = Array.isArray(line.product_categ_id) 
                    ? line.product_categ_id[0] 
                    : line.product_categ_id;
                
                if (categoryIds.includes(productCategoryId)) {
                    return true;
                }
            }
        }
        
        return false;
    }
   
    /**
     * Vérifie si une commande est nouvelle
     */
    isNewOrder(orderId) {
        return !this.state.seenOrders.has(orderId);
    }

    updateOrderCounts() {
        const orders = this.state.order_details.filter(
            order => this.orderMatchesCategories(order, this.state.category_ids)
        );
        
        this.state.draft_count = orders.filter(o => o.order_status === 'draft').length;
        this.state.waiting_count = orders.filter(o => o.order_status === 'waiting').length;
        this.state.ready_count = orders.filter(o => o.order_status === 'ready').length;
        
        console.log('[KITCHEN] Order counts:', {
            draft: this.state.draft_count,
            waiting: this.state.waiting_count,
            ready: this.state.ready_count
        });
    }

    /**
     * Initialise les compteurs de temps pour chaque commande
     */
    initializeCountdowns() {
        this.state.order_details.forEach(order => {
            if (!this.state.countdowns[order.id] && order.avg_prepare_time > 0) {
                const totalSeconds = Math.floor(order.avg_prepare_time * 60);
                this.state.countdowns[order.id] = {
                    minutes: Math.floor(totalSeconds / 60),
                    seconds: totalSeconds % 60,
                    isCompleted: false
                };
            }
        });
    }

    /**
     * Démarre les compteurs à rebours
     */
    startCountdowns() {
        this.countdownInterval = setInterval(() => {
            Object.keys(this.state.countdowns).forEach(orderId => {
                const countdown = this.state.countdowns[orderId];
                
                if (countdown.isCompleted) return;
                
                if (countdown.seconds > 0) {
                    countdown.seconds--;
                } else if (countdown.minutes > 0) {
                    countdown.minutes--;
                    countdown.seconds = 59;
                } else {
                    countdown.isCompleted = true;
                    // Son de fin de timer
                    if (this.state.soundEnabled) {
                        this.playSound('timer_completed');
                    }
                }
            });
        }, 1000);
    }

    subscribeToBus() {
        const channel = `kitchen.screen.${this.state.screenId}`;
        
        try {
            this.busService.addChannel(channel);
            this.busService.addEventListener('notification', this.onBusNotification.bind(this));
            
            console.log(`[KITCHEN] Subscribed to: ${channel}`);
        } catch (error) {
            console.error('[KITCHEN] Error subscribing to bus:', error);
        }
    }

    onBusNotification({ detail: notifications }) {
        console.log('[KITCHEN] Bus notification received:', notifications);
        
        for (const notification of notifications) {
            const { type, payload } = notification;
            
            if (payload.screen_id !== this.state.screenId) {
                continue;
            }

            console.log(`[KITCHEN] Processing ${type}:`, payload);

            switch (type) {
                case 'new_order':
                    this.handleNewOrder(payload);
                    break;
                case 'order_status_change':
                    this.handleStatusChange(payload);
                    break;
                case 'order_line_updated':
                    this.handleLineUpdate(payload);
                    break;
            }
        }
    }

    handleNewOrder(data) {
        console.log('[KITCHEN] New order:', data.order_name);
        
        this.loadCompleteOrderData();
        
        if (this.state.soundEnabled) {
            this.playSound('new_order');
        }
        
        this.showOrderNotification({
            name: data.order_name,
            config_id: [null, data.config_name],
            table_id: [null, data.table_name]
        });
    }

    handleStatusChange(data) {
        console.log('[KITCHEN] Status change:', data.order_name, '->', data.order_status);
        
        this.loadCompleteOrderData();
        
        if (this.state.soundEnabled) {
            const soundType = this.getSoundForStatus(data.order_status);
            this.playSound(soundType);
        }
    }

    handleLineUpdate(data) {
        console.log('[KITCHEN] Line updated:', data.product_name);
        this.loadCompleteOrderData();
    }

    showOrderNotification(order) {
        this.notification.add(
            `${order.name} - Table: ${order.table_id ? order.table_id[1] : 'N/A'}`,
            { 
                type: 'success', 
                title: '🔔 Nouvelle Commande',
                sticky: false
            }
        );
    }

    getSoundForStatus(status) {
        const soundMap = {
            'waiting': 'order_accepted',
            'ready': 'order_completed',
            'cancel': 'order_cancelled'
        };
        return soundMap[status] || 'notification';
    }

    playSound(soundType) {
        if (!this.state.screen || !this.state.soundEnabled) return;

        try {
            const audio = new Audio();
            const soundFile = this.state.screen.sound_file || 'pos_notification';
            const volume = (this.state.screen.sound_volume || 50) / 100;

            const soundMap = {
                'pos_notification': '/pos_kitchen_screen_odoo_extension/static/src/sounds/notification.mp3',
                'pos_ready': '/pos_kitchen_screen_odoo_extension/static/src/sounds/ready.mp3',
                'pos_ding': '/pos_kitchen_screen_odoo_extension/static/src/sounds/ding.mp3',
                'custom': this.state.screen.custom_sound_url
            };

            audio.src = soundMap[soundFile] || soundMap['pos_notification'];
            audio.volume = volume;
            
            audio.play().catch(error => {
                console.error('[KITCHEN] Error playing sound:', error);
            });
            
            console.log(`[KITCHEN] Playing sound: ${soundType}`);
        } catch (error) {
            console.error('[KITCHEN] Sound error:', error);
        }
    }

    // === Méthodes pour changer de stage ===
    draft_stage() {
        this.state.stages = 'draft';
    }

    waiting_stage() {
        this.state.stages = 'waiting';
    }

    ready_stage() {
        this.state.stages = 'ready';
    }

    // === Actions sur les commandes ===
    async accept_order(e) {
        const orderId = parseInt(e.target.value);
        
        try {
            await this.orm.call("pos.order", "order_progress_draft", [orderId]);
            await this.loadCompleteOrderData();
            
            this.notification.add('Commande acceptée', { type: 'success' });
        } catch (error) {
            console.error('[KITCHEN] Error accepting order:', error);
            this.notification.add('Erreur', { type: 'danger' });
        }
    }

    async done_order(e) {
        const orderId = parseInt(e.target.value);
        
        try {
            await this.orm.call("pos.order", "order_progress_change", [orderId]);
            await this.loadCompleteOrderData();
            
            this.notification.add('Commande terminée', { type: 'success' });
            
            if (this.state.soundEnabled) {
                this.playSound('order_completed');
            }
        } catch (error) {
            console.error('[KITCHEN] Error completing order:', error);
            this.notification.add('Erreur', { type: 'danger' });
        }
    }

    async cancel_order(e) {
        const orderId = parseInt(e.target.value);
        
        try {
            await this.orm.call("pos.order", "order_progress_cancel", [orderId]);
            await this.loadCompleteOrderData();
            
            this.notification.add('Commande annulée', { type: 'info' });
        } catch (error) {
            console.error('[KITCHEN] Error cancelling order:', error);
            this.notification.add('Erreur', { type: 'danger' });
        }
    }

    async accept_order_line(e) {
        const lineId = parseInt(e.target.value);
        
        try {
            await this.orm.call("pos.order.line", "order_progress_change", [lineId]);
            await this.loadCompleteOrderData();
        } catch (error) {
            console.error('[KITCHEN] Error updating line:', error);
        }
    }

    forceRefresh() {
        this.loadCompleteOrderData();
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'kitchen-error';
        errorDiv.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 9999;';
        errorDiv.innerHTML = `
            <div class="alert alert-danger" style="min-width: 400px;">
                <i class="fa fa-exclamation-triangle"></i>
                ${message}
            </div>
        `;
        document.body.appendChild(errorDiv);
    }

    cleanup() {
        console.log('[KITCHEN] Cleaning up...');
        
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }
        
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
        
        if (this.state.screenId) {
            const channel = `kitchen.screen.${this.state.screenId}`;
            this.busService.deleteChannel(channel);
        }
    }
}

KitchenScreenIntegration.template = "KitchenCustomDashBoard";

registry.category("actions").add("kitchen_screen_action", KitchenScreenIntegration);