/** @odoo-module */
import { patch } from "@web/core/utils/patch";
import { ActionpadWidget } from "@point_of_sale/app/screens/product_screen/action_pad/action_pad";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { _t } from "@web/core/l10n/translation";

patch(ActionpadWidget.prototype, {
    async getAllScreensForOrder() {
        const order = this.pos.get_order();
        if (!order || !order.lines || order.lines.length === 0) {
            console.warn('[ACTION PAD] No order or lines found');
            return [];
        }

        const categoryIds = new Set();
        
        for (const line of order.lines) {
            const product = line.product_id;
            if (product && product.pos_categ_ids && product.pos_categ_ids.length > 0) {
                product.pos_categ_ids.forEach(categ => {
                    const categId = typeof categ === 'object' ? categ.id : categ;
                    categoryIds.add(categId);
                });
            }
        }

        if (categoryIds.size === 0) {
            console.warn('[ACTION PAD] No POS categories found in order products');
            return [];
        }

        const categoryArray = Array.from(categoryIds);
        console.log(`[ACTION PAD] 🔍 Searching screens for categories: [${categoryArray.join(', ')}]`);

        try {
            const allScreens = await this.env.services.orm.call(
                "kitchen.screen",
                "get_screens_for_pos",
                [this.pos.config.id]
            );

            if (!allScreens || allScreens.length === 0) {
                console.warn(`[ACTION PAD] ⚠ No active screens found for POS ${this.pos.config.id}`);
                return [];
            }

            const matchingScreens = [];
            
            for (const screen of allScreens) {
                const screenCategs = screen.pos_categ_ids || [];
                const screenCategIds = screenCategs.map(c => typeof c === 'object' ? c.id : c);
                const hasMatch = categoryArray.some(categId => screenCategIds.includes(categId));
                
                if (hasMatch) {
                    matchingScreens.push({
                        id: screen.id,
                        name: screen.name,
                        categories: screenCategIds
                    });
                    
                    console.log(
                        `[ACTION PAD] ✓ Screen "${screen.name}" (ID: ${screen.id}) matches`
                    );
                }
            }

            console.log(`[ACTION PAD] ✅ Found ${matchingScreens.length} matching screens`);

            return matchingScreens;

        } catch (error) {
            console.error("[ACTION PAD] ❌ Error getting screens for order:", error);
            return [];
        }
    },

    /**
     * ✅ CORRECTION: Envoyer les notifications SANS attendre
     */
    async forceNotificationToScreens(matchingScreens, orderData) {
        console.log('[ACTION PAD] 🔔 Forcing notifications to screens');

        for (const screen of matchingScreens) {
            console.log(`[ACTION PAD] 📡 Sending to "${screen.name}" (ID: ${screen.id})`);

            // ✅ Frontend Bus
            this.sendFrontendBusNotification(screen, orderData);

            // ✅ Global Broadcast
            this.sendGlobalBroadcast(screen, orderData);

            // ✅ Backend (async, sans bloquer)
            this.sendBackendNotification(screen.id, orderData)
                .catch(error => {
                    console.warn(`[ACTION PAD] Backend notification failed:`, error);
                });
        }

        console.log('[ACTION PAD] ✅ All notifications sent');
    },

    async sendBackendNotification(screenId, orderData) {
        try {
            const result = await this.env.services.orm.call(
                "pos.order",
                "trigger_kitchen_notifications",
                [orderData.pos_reference, [screenId]]
            );
            
            console.log(`[ACTION PAD] ✅ Backend RPC result:`, result);
            return result;
        } catch (error) {
            console.error(`[ACTION PAD] ❌ Backend RPC error:`, error);
            throw error;
        }
    },

    sendFrontendBusNotification(screen, orderData) {
        try {
            const notification = {
                screen_id: screen.id,
                screen_name: screen.name,
                config_id: orderData.config_id,
                order_reference: orderData.pos_reference,
                order_name: orderData.pos_reference,
                timestamp: new Date().toISOString(),
                type: 'new_order',
                lines_count: orderData.lines?.length || 0,
                source: 'frontend_bus'
            };
            
            this.env.bus.trigger('pos-kitchen-new-order', notification);
            this.env.bus.trigger('kitchen-screen-notification', notification);
            
            console.log(`[ACTION PAD] ✅ Frontend bus triggered`);
        } catch (error) {
            console.error(`[ACTION PAD] ❌ Frontend bus error:`, error);
        }
    },

    sendGlobalBroadcast(screen, orderData) {
        try {
            const broadcastData = {
                screen_id: screen.id,
                screen_name: screen.name,
                config_id: orderData.config_id,
                order_reference: orderData.pos_reference,
                timestamp: Date.now(),
                type: 'new_order'
            };
            
            const customEvent = new CustomEvent('kitchen-new-order-global', {
                detail: broadcastData,
                bubbles: true
            });
            
            window.dispatchEvent(customEvent);
            
            console.log(`[ACTION PAD] ✅ Global broadcast dispatched`);
        } catch (error) {
            console.error(`[ACTION PAD] ❌ Global broadcast error:`, error);
        }
    },

    /**
     * ✅ CORRECTION CRITIQUE: Éviter la duplication
     */
    async submitOrder() {
        // ✅ Protection contre double-clic
        if (this.clicked) {
            console.warn('[ACTION PAD] ⏸️ Submit already in progress, ignoring...');
            return;
        }
        
        this.clicked = true;
        
        try {
            console.log('[ACTION PAD] 🚀 ========================================');
            console.log('[ACTION PAD] 🚀 STARTING ORDER SUBMISSION');
            console.log('[ACTION PAD] 🚀 ========================================');

            // ✅ Récupérer les écrans
            const matchingScreens = await this.getAllScreensForOrder();
            
            if (matchingScreens.length === 0) {
                console.warn("[ACTION PAD] ⚠ No kitchen screens found");
                // ✅ Ne pas bloquer, continuer quand même
            }

            // ✅ Vérifier le statut
            const orderStatus = await this.env.services.orm.call(
                "pos.order", 
                "check_order_status", 
                ["", this.pos.get_order().pos_reference]
            );

            if (orderStatus === false) {
                await this.env.services.dialog.add(AlertDialog, {
                    title: _t("Order is Completed"),
                    body: _t("This Order is Completed. Please create a new Order"),
                });
                return;
            }

            // ✅ Mise à jour préparation
            await this.pos.sendOrderInPreparationUpdateLastChange(this.currentOrder);

            // ✅ Construire les lignes
            const line = [];
            for (const orders of this.pos.get_order().lines) {
                let actualQty = orders.qty || orders.quantity || orders.get_quantity() || 1;

                line.push([0, 0, {
                    'qty': actualQty,
                    'price_unit': orders.price_unit,
                    'price_subtotal': orders.price_subtotal,
                    'price_subtotal_incl': orders.price_subtotal_incl,
                    'discount': orders.discount,
                    'product_id': orders.product_id.id,
                    'tax_ids': [[6, 0, orders.tax_ids.map((tax) => tax.id)]],
                    'id': orders.id,
                    'pack_lot_ids': [],
                    'full_product_name': orders.product_id.display_name,
                    'price_extra': orders.price_extra,
                    'name': orders.product_id.display_name,
                    'is_cooking': true,
                    'note': orders.note || ''
                }]);
            }

            // ✅ Construire l'objet commande
            const date = new Date(this.currentOrder.date_order.replace(' ', 'T'));
            
            const orders = [{
                'pos_reference': this.pos.get_order().pos_reference,
                'session_id': this.pos.get_order().session_id.id,
                'amount_total': this.pos.get_order().amount_total,
                'amount_paid': this.pos.get_order().amount_paid,
                'amount_return': this.pos.get_order().amount_return,
                'amount_tax': this.pos.get_order().amount_tax,
                'lines': line,
                'is_cooking': true,
                'order_status': 'draft',
                'company_id': this.pos.company.id,
                'hour': date.getHours(),
                'minutes': date.getMinutes(),
                'table_id': this.pos.get_order().table_id.id,
                'floor': this.pos.get_order().table_id.floor_id.name,
                'config_id': this.pos.get_order().config_id.id,
                'target_screen_ids': matchingScreens.map(s => s.id)
            }];

            console.log('[ACTION PAD] 📤 Submitting order:', {
                pos_reference: orders[0].pos_reference,
                target_screens: matchingScreens.length,
                lines_count: line.length
            });

            // ✅ Créer la commande cuisine
            await this.env.services.orm.call(
                "pos.order", 
                "create_or_update_kitchen_order", 
                [orders]
            );
            
            console.log('[ACTION PAD] ✅ Order submitted successfully');

            // ✅ Envoyer les notifications
            if (matchingScreens.length > 0) {
                await this.forceNotificationToScreens(matchingScreens, orders[0]);
                
                // ✅ Notification visuelle
                if (this.env.services.notification) {
                    const screenNames = matchingScreens.map(s => s.name).join(', ');
                    this.env.services.notification.add(
                        _t(`✅ Commande envoyée à: ${screenNames}`),
                        { type: 'success' }
                    );
                }
            }

            console.log('[ACTION PAD] ========================================');
            console.log('[ACTION PAD] ✅ SUBMISSION COMPLETED');
            console.log('[ACTION PAD] ========================================');
            
        } catch (error) {
            console.error('[ACTION PAD] ❌ Error in submitOrder:', error);
            
            if (this.env.services.notification) {
                this.env.services.notification.add(
                    _t("Error submitting order to kitchen. Please try again."),
                    { type: 'danger' }
                );
            }
        } finally {
            // ✅ IMPORTANT: Réinitialiser après un délai pour éviter re-soumission immédiate
            setTimeout(() => {
                this.clicked = false;
                console.log('[ACTION PAD] 🔓 Submit unlocked');
            }, 2000); // 2 secondes de protection
        }
    }
});

console.log('[ACTION PAD] ✅ Action Pad Extension loaded (Fixed Duplication)');