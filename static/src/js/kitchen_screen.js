/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onMounted, onWillUnmount } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class KitchenScreenView extends Component {
    setup() {
        this.orm = useService("orm");
        this.bus = useService("bus_service");
        this.notification = useService("notification");
        
        this.state = useState({
            screenId: this.props.action.context.screen_id,
            screenConfig: null,
            orders: [],
            statistics: {
                draft_count: 0,
                waiting_count: 0,
                ready_count: 0,
                total_count: 0
            },
            loading: true,
            error: null
        });

        this.audioContext = null;
        this.refreshInterval = null;

        onMounted(() => {
            this.initializeScreen();
        });

        onWillUnmount(() => {
            this.cleanup();
        });
    }

    async initializeScreen() {
        try {
            // Charger la configuration de l'écran
            const config = await this.orm.call(
                "pos.kitchen.screen",
                "get_screen_config",
                [this.state.screenId]
            );

            if (!config) {
                throw new Error("Configuration de l'écran introuvable");
            }

            this.state.screenConfig = config;
            
            // Charger les commandes initiales
            await this.loadOrders();
            
            // S'abonner aux notifications
            this.subscribeToNotifications();
            
            // Configurer le rafraîchissement automatique
            if (config.auto_refresh) {
                this.setupAutoRefresh(config.refresh_interval);
            }
            
            this.state.loading = false;
            
        } catch (error) {
            console.error("Erreur d'initialisation:", error);
            this.state.error = error.message;
            this.state.loading = false;
        }
    }

    async loadOrders() {
        try {
            const orders = await this.orm.call(
                "pos.kitchen.screen",
                "get_screen_orders",
                [this.state.screenId]
            );
            
            this.state.orders = orders || [];
            
            // Charger les statistiques
            const stats = await this.orm.call(
                "pos.kitchen.screen",
                "get_screen_statistics",
                [this.state.screenId]
            );
            
            if (stats) {
                this.state.statistics = stats;
            }
            
        } catch (error) {
            console.error("Erreur de chargement des commandes:", error);
        }
    }

    subscribeToNotifications() {
        const channel = `kitchen_screen_${this.state.screenId}`;
        
        this.bus.addEventListener("notification", ({ detail }) => {
            if (detail.type === "notification") {
                const payload = detail.payload;
                
                if (payload.message === "kitchen_sound_notification" && 
                    payload.screen_id === this.state.screenId) {
                    this.handleNotification(payload);
                }
            }
        });

        this.bus.addChannel(channel);
    }

    async handleNotification(notification) {
        console.log("Notification reçue:", notification);
        
        // Jouer le son
        if (notification.sound_config?.enabled) {
            this.playSound(notification.sound_config);
        }
        
        // Afficher une notification visuelle
        const messages = {
            'new_order': 'Nouvelle commande',
            'order_accepted': 'Commande acceptée',
            'order_completed': 'Commande terminée',
            'order_cancelled': 'Commande annulée'
        };
        
        this.notification.add(
            `${messages[notification.notification_type]}: ${notification.order_ref}`,
            { type: 'info' }
        );
        
        // Rafraîchir les commandes
        await this.loadOrders();
    }

    playSound(soundConfig) {
        try {
            let soundUrl;
            
            if (soundConfig.file === 'custom' && soundConfig.custom_sound) {
                soundUrl = soundConfig.custom_sound;
            } else {
                soundUrl = `/point_of_sale/static/src/sounds/${soundConfig.file}.wav`;
            }
            
            const audio = new Audio(soundUrl);
            audio.volume = soundConfig.volume || 0.5;
            audio.play().catch(err => {
                console.warn("Impossible de jouer le son:", err);
            });
            
        } catch (error) {
            console.error("Erreur lors de la lecture du son:", error);
        }
    }

    setupAutoRefresh(interval) {
        this.refreshInterval = setInterval(() => {
            this.loadOrders();
        }, interval * 1000);
    }

    async changeOrderStatus(orderId, newStatus) {
        try {
            let method;
            
            switch(newStatus) {
                case 'waiting':
                    method = 'order_progress_draft';
                    break;
                case 'ready':
                    method = 'order_progress_change';
                    break;
                case 'cancel':
                    method = 'order_progress_cancel';
                    break;
                default:
                    return;
            }
            
            await this.orm.call("pos.order", method, [[orderId]]);
            await this.loadOrders();
            
        } catch (error) {
            console.error("Erreur changement statut:", error);
            this.notification.add("Erreur lors du changement de statut", { type: "danger" });
        }
    }

    cleanup() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
    }

    getStatusColor(status) {
        const colors = {
            'draft': 'warning',
            'waiting': 'info',
            'ready': 'success',
            'cancel': 'danger'
        };
        return colors[status] || 'secondary';
    }

    getStatusLabel(status) {
        const labels = {
            'draft': 'Nouveau',
            'waiting': 'En cours',
            'ready': 'Prêt',
            'cancel': 'Annulé'
        };
        return labels[status] || status;
    }

    formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
}

KitchenScreenView.template = "pos_kitchen_screen.KitchenScreenView";

registry.category("actions").add("kitchen_screen_view", KitchenScreenView);