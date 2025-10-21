/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onWillStart, onMounted, onWillUnmount, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

/**
 * Composant d'affichage des commandes de cuisine avec notifications temps réel
 */
export class KitchenScreenDisplay extends Component {
    setup() {
        this.orm = useService("orm");
        this.bus = useService("bus_service");
        this.notification = useService("notification");
        this.audio = new Audio('/pos_kitchen_screen_odoo_extension/static/src/sound/notification.mp3');
        
        this.state = useState({
            orders: [],
            orderLines: [],
            screenId: null,
            configId: null,
            loading: true,
            lastUpdate: null,
        });

        onWillStart(async () => {
            await this.loadInitialData();
            this.subscribeToNotifications();
        });

        onMounted(() => {
            // Rafraîchissement périodique (backup si notification échoue)
            this.refreshInterval = setInterval(() => {
                this.refreshOrders();
            }, 30000); // Toutes les 30 secondes
        });

        onWillUnmount(() => {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
            this.unsubscribeFromNotifications();
        });
    }

    /**
     * Chargement initial des données
     */
    async loadInitialData() {
        try {
            // Récupérer l'ID de l'écran depuis l'URL ou le contexte
            const urlParams = new URLSearchParams(window.location.search);
            this.state.screenId = parseInt(urlParams.get('screen_id')) || null;
            this.state.configId = parseInt(urlParams.get('config_id')) || null;

            if (!this.state.screenId || !this.state.configId) {
                throw new Error("Screen ID et Config ID requis");
            }

            await this.refreshOrders();
        } catch (error) {
            console.error("[KITCHEN] Erreur lors du chargement initial:", error);
            this.notification.add("Erreur de chargement des données", {
                type: "danger",
            });
        } finally {
            this.state.loading = false;
        }
    }

    /**
     * Rafraîchir les commandes depuis le serveur
     */
    async refreshOrders() {
        try {
            const result = await this.orm.call(
                "pos.order",
                "get_details",
                [this.state.configId, this.state.screenId]
            );

            this.state.orders = result.orders || [];
            this.state.orderLines = result.order_lines || [];
            this.state.lastUpdate = new Date().toLocaleTimeString();

            console.log(
                `[KITCHEN] Rafraîchissement: ${this.state.orders.length} commandes, ` +
                `${this.state.orderLines.length} lignes`
            );
        } catch (error) {
            console.error("[KITCHEN] Erreur lors du rafraîchissement:", error);
        }
    }

    /**
     * S'abonner aux notifications du bus Odoo
     */
    subscribeToNotifications() {
        const channel = `kitchen.screen.${this.state.screenId}`;
        
        console.log(`[KITCHEN] Abonnement au canal: ${channel}`);

        // Écouter les nouvelles commandes
        this.bus.addEventListener("notification", ({ detail }) => {
            const [channelName, notifType, message] = detail;
            
            if (channelName === channel) {
                this.handleNotification(notifType, message);
            }
        });

        // S'abonner explicitement au canal
        this.bus.addChannel(channel);
    }

    /**
     * Se désabonner des notifications
     */
    unsubscribeFromNotifications() {
        const channel = `kitchen.screen.${this.state.screenId}`;
        this.bus.deleteChannel(channel);
        console.log(`[KITCHEN] Désabonnement du canal: ${channel}`);
    }

    /**
     * Gérer les notifications reçues
     */
    handleNotification(notifType, message) {
        console.log(`[KITCHEN] 📨 Notification reçue:`, notifType, message);

        switch (notifType) {
            case "new_order":
                this.handleNewOrder(message);
                break;
            
            case "order_status_change":
                this.handleStatusChange(message);
                break;
            
            case "order_line_updated":
                this.handleLineUpdate(message);
                break;
            
            default:
                console.warn(`[KITCHEN] Type de notification inconnu: ${notifType}`);
        }
    }

    /**
     * Gérer une nouvelle commande
     */
    async handleNewOrder(message) {
        console.log(`[KITCHEN] 🆕 Nouvelle commande: ${message.order_name}`);
        
        // Son de notification
        this.playNotificationSound();
        
        // Afficher une notification visuelle
        this.notification.add(
            `Nouvelle commande: ${message.order_ref || message.order_name}`,
            {
                type: "success",
                title: "Nouvelle commande",
                sticky: false,
            }
        );

        // Rafraîchir immédiatement l'affichage
        await this.refreshOrders();
        
        // Animation visuelle pour la nouvelle commande
        this.highlightOrder(message.order_id);
    }

    /**
     * Gérer un changement de statut
     */
    async handleStatusChange(message) {
        console.log(
            `[KITCHEN] 🔄 Changement statut commande ${message.order_name}: ${message.order_status}`
        );
        
        const statusLabels = {
            draft: "En attente",
            waiting: "En préparation",
            ready: "Prête",
            cancel: "Annulée"
        };

        this.notification.add(
            `Commande ${message.order_ref}: ${statusLabels[message.order_status] || message.order_status}`,
            {
                type: message.order_status === "ready" ? "success" : "info",
            }
        );

        // Rafraîchir l'affichage
        await this.refreshOrders();
    }

    /**
     * Gérer une mise à jour de ligne
     */
    async handleLineUpdate(message) {
        console.log(`[KITCHEN] 📝 Ligne mise à jour: ${message.product_name}`);
        
        // Rafraîchir l'affichage
        await this.refreshOrders();
    }

    /**
     * Jouer le son de notification
     */
    playNotificationSound() {
        try {
            this.audio.currentTime = 0;
            this.audio.play().catch(err => {
                console.warn("[KITCHEN] Impossible de jouer le son:", err);
            });
        } catch (error) {
            console.error("[KITCHEN] Erreur audio:", error);
        }
    }

    /**
     * Mettre en surbrillance une commande
     */
    highlightOrder(orderId) {
        setTimeout(() => {
            const orderElement = document.querySelector(`[data-order-id="${orderId}"]`);
            if (orderElement) {
                orderElement.classList.add('new-order-highlight');
                setTimeout(() => {
                    orderElement.classList.remove('new-order-highlight');
                }, 3000);
            }
        }, 100);
    }

    /**
     * Changer le statut d'une commande
     */
    async changeOrderStatus(orderId, newStatus) {
        try {
            await this.orm.write("pos.order", [orderId], {
                order_status: newStatus
            });

            console.log(`[KITCHEN] Statut changé pour commande ${orderId}: ${newStatus}`);
            
            // Le rafraîchissement sera fait par la notification
        } catch (error) {
            console.error("[KITCHEN] Erreur changement statut:", error);
            this.notification.add("Erreur lors du changement de statut", {
                type: "danger",
            });
        }
    }

    /**
     * Obtenir les lignes d'une commande spécifique
     */
    getOrderLines(orderId) {
        return this.state.orderLines.filter(line => line.order_id[0] === orderId);
    }

    /**
     * Formater l'heure d'une commande
     */
    formatOrderTime(order) {
        if (order.hour !== undefined && order.formatted_minutes) {
            return `${order.hour}:${order.formatted_minutes}`;
        }
        return "N/A";
    }

    /**
     * Obtenir la classe CSS selon le statut
     */
    getStatusClass(status) {
        const statusClasses = {
            draft: "status-draft",
            waiting: "status-waiting",
            ready: "status-ready",
            cancel: "status-cancel"
        };
        return statusClasses[status] || "status-unknown";
    }
}

KitchenScreenDisplay.template = "kitchen_screen.KitchenScreenDisplay";

// Enregistrer le composant dans le registre Odoo
registry.category("actions").add("kitchen_screen_display", KitchenScreenDisplay);