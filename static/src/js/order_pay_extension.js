/** @odoo-module */
import { patch } from "@web/core/utils/patch";
import { ActionpadWidget } from "@point_of_sale/app/screens/product_screen/action_pad/action_pad";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { _t } from "@web/core/l10n/translation";

/**
 * Extension du ActionpadWidget pour support multi-écrans
 * Ce patch détermine TOUS les écrans concernés par la commande
 * basé sur les catégories des produits
 */
patch(ActionpadWidget.prototype, {
    /**
     * ✅ NOUVELLE MÉTHODE: Récupère TOUS les écrans concernés par cette commande
     * @returns {Array} Liste des screen_ids concernés par les produits de la commande
     */
    async getAllScreensForOrder() {
        const order = this.pos.get_order();
        if (!order || !order.lines || order.lines.length === 0) {
            console.warn('[ACTION PAD] No order or lines found');
            return [];
        }

        // Récupérer toutes les catégories uniques des produits dans la commande
        const categoryIds = new Set();
        
        for (const line of order.lines) {
            const product = line.product_id;
            if (product && product.pos_categ_ids && product.pos_categ_ids.length > 0) {
                // ✅ CORRECTION CRITIQUE: Extraire les IDs numériques des objets
                product.pos_categ_ids.forEach(categ => {
                    // categ peut être un objet {id: X} ou directement un nombre
                    const categId = typeof categ === 'object' ? categ.id : categ;
                    categoryIds.add(categId);
                });
                
                const categIdsArray = product.pos_categ_ids.map(c => typeof c === 'object' ? c.id : c);
                console.log(`[ACTION PAD] Product "${product.display_name}" has categories: [${categIdsArray.join(', ')}]`);
            }
        }

        if (categoryIds.size === 0) {
            console.warn('[ACTION PAD] No POS categories found in order products');
            return [];
        }

        const categoryArray = Array.from(categoryIds);
        console.log(`[ACTION PAD] 🔍 Searching screens for categories: [${categoryArray.join(', ')}]`);

        try {
            // ✅ Récupérer TOUS les écrans actifs du POS
            const allScreens = await this.env.services.orm.call(
                "kitchen.screen",
                "get_screens_for_pos",
                [this.pos.config.id]
            );

            if (!allScreens || allScreens.length === 0) {
                console.warn(`[ACTION PAD] ⚠ No active screens found for POS ${this.pos.config.id}`);
                return [];
            }

            console.log(`[ACTION PAD] Found ${allScreens.length} active screens for this POS`);

            // ✅ Filtrer les écrans qui ont au moins une catégorie en commun
            const matchingScreens = [];
            
            for (const screen of allScreens) {
                // screen.pos_categ_ids contient les IDs des catégories de l'écran
                const screenCategs = screen.pos_categ_ids || [];
                
                // ✅ CORRECTION: S'assurer que screenCategs contient des nombres
                const screenCategIds = screenCategs.map(c => typeof c === 'object' ? c.id : c);
                
                // Vérifier l'intersection
                const hasMatch = categoryArray.some(categId => screenCategIds.includes(categId));
                
                if (hasMatch) {
                    const matchingCategs = categoryArray.filter(c => screenCategIds.includes(c));
                    
                    matchingScreens.push({
                        id: screen.id,
                        name: screen.name,
                        categories: screenCategIds
                    });
                    
                    console.log(
                        `[ACTION PAD] ✓ Screen "${screen.name}" (ID: ${screen.id}) matches ` +
                        `with categories: [${matchingCategs.join(', ')}] (has: [${screenCategIds.join(', ')}])`
                    );
                } else {
                    console.log(
                        `[ACTION PAD] ✗ Screen "${screen.name}" (ID: ${screen.id}) does NOT match. ` +
                        `Order has: [${categoryArray.join(', ')}], Screen has: [${screenCategIds.join(', ')}]`
                    );
                }
            }

            if (matchingScreens.length === 0) {
                console.warn(`[ACTION PAD] ⚠ No screens match the order categories [${categoryArray.join(', ')}]`);
            } else {
                console.log(`[ACTION PAD] ✅ Found ${matchingScreens.length} matching screens:`, 
                    matchingScreens.map(s => s.name).join(', ')
                );
            }

            return matchingScreens;

        } catch (error) {
            console.error("[ACTION PAD] ❌ Error getting screens for order:", error);
            return [];
        }
    },

    /**
     * ✅ Mapper les lignes de commande par écran
     * Retourne un objet: { screen_id: [lignes correspondantes] }
     */
    async getOrderLinesByScreen() {
        const order = this.pos.get_order();
        if (!order || !order.lines || order.lines.length === 0) {
            return {};
        }

        const matchingScreens = await this.getAllScreensForOrder();
        if (matchingScreens.length === 0) {
            return {};
        }

        const linesByScreen = {};

        // Initialiser les tableaux pour chaque écran
        for (const screen of matchingScreens) {
            linesByScreen[screen.id] = {
                screen_name: screen.name,
                lines: []
            };
        }

        // Distribuer les lignes aux écrans correspondants
        for (const line of order.lines) {
            const product = line.product_id;
            if (!product || !product.pos_categ_ids || product.pos_categ_ids.length === 0) {
                continue;
            }

            // ✅ CORRECTION: Extraire les IDs numériques
            const productCategs = product.pos_categ_ids.map(c => typeof c === 'object' ? c.id : c);

            // Vérifier chaque écran pour cette ligne
            for (const screen of matchingScreens) {
                const screenCategs = screen.categories;
                
                // Si intersection des catégories
                const hasMatch = productCategs.some(categId => screenCategs.includes(categId));
                
                if (hasMatch) {
                    linesByScreen[screen.id].lines.push({
                        product_name: product.display_name,
                        qty: line.qty || line.quantity || line.get_quantity() || 1,
                        line_obj: line
                    });
                }
            }
        }

        // Log du résultat
        for (const [screenId, data] of Object.entries(linesByScreen)) {
            console.log(`[ACTION PAD] Screen "${data.screen_name}" will receive ${data.lines.length} lines`);
        }

        return linesByScreen;
    },

    /**
     * ✅ Vérification des catégories avant soumission
     */
    async checkCategoriesHaveScreen() {
        const order = this.pos.get_order();
        if (!order || !order.lines || order.lines.length === 0) {
            return { valid: true, missing_categories: [] };
        }

        const categoryIds = new Set();
        for (const line of order.lines) {
            const product = line.product_id;
            if (product && product.pos_categ_ids) {
                // ✅ CORRECTION: Extraire les IDs numériques
                product.pos_categ_ids.forEach(categ => {
                    const categId = typeof categ === 'object' ? categ.id : categ;
                    categoryIds.add(categId);
                });
            }
        }

        if (categoryIds.size === 0) {
            return { valid: true, missing_categories: [] };
        }

        try {
            const result = await this.env.services.orm.call(
                "pos.config",
                "check_categories_have_screen",
                [Array.from(categoryIds), this.pos.config.id]
            );
            
            return result;
        } catch (error) {
            console.error("[ACTION PAD] Error checking categories:", error);
            return { valid: true, missing_categories: [] };
        }
    },

    /**
     * ✅ Override de submitOrder pour support multi-écrans
     */
    async submitOrder() {
        var line = [];
        var self = this;
        
        if (!this.clicked) {
            this.clicked = true;
            try {
                console.log('[ACTION PAD] 🚀 Starting submitOrder for multi-screen dispatch');

                // ✅ Étape 1: Récupérer TOUS les écrans concernés
                const matchingScreens = await this.getAllScreensForOrder();
                
                if (matchingScreens.length === 0) {
                    console.warn("[ACTION PAD] ⚠ No kitchen screens found for this order's categories");
                    
                    // Option: Afficher un avertissement (décommentez si nécessaire)
                    // await this.env.services.dialog.add(AlertDialog, {
                    //     title: _t("Warning"),
                    //     body: _t("No kitchen screen configured for these products. Order will be processed without kitchen display."),
                    // });
                } else {
                    console.log(
                        `[ACTION PAD] ✅ Order will be sent to ${matchingScreens.length} screens: ` +
                        matchingScreens.map(s => s.name).join(', ')
                    );
                }

                // ✅ Étape 2: Vérifier le statut de la commande
                const orderStatus = await self.env.services.orm.call(
                    "pos.order", 
                    "check_order_status", 
                    ["", this.pos.get_order().pos_reference]
                );

                if (orderStatus === false) {
                    self.kitchen_order_status = false;
                    await self.env.services.dialog.add(AlertDialog, {
                        title: _t("Order is Completed"),
                        body: _t("This Order is Completed. Please create a new Order"),
                    });
                    return;
                } else {
                    self.kitchen_order_status = true;
                }

                if (self.kitchen_order_status) {
                    // ✅ Étape 3: Envoyer la mise à jour de préparation
                    await this.pos.sendOrderInPreparationUpdateLastChange(this.currentOrder);

                    // ✅ Étape 4: Construire les lignes de commande
                    for (const orders of this.pos.get_order().lines) {
                        let actualQty = orders.qty || orders.quantity || orders.get_quantity() || 1;

                        console.log('[ACTION PAD] 📋 Processing line:', {
                            product: orders.product_id.display_name,
                            categories: orders.product_id.pos_categ_ids,
                            qty: actualQty,
                            has_is_cooking: orders.hasOwnProperty('is_cooking')
                        });

                        line.push([0, 0, {
                            'qty': actualQty,
                            'price_unit': orders.price_unit,
                            'price_subtotal': orders.price_subtotal,
                            'price_subtotal_incl': orders.price_subtotal_incl,
                            'discount': orders.discount,
                            'product_id': orders.product_id.id,
                            'tax_ids': [
                                [6, 0, orders.tax_ids.map((tax) => tax.id)]
                            ],
                            'id': orders.id,
                            'pack_lot_ids': [],
                            'full_product_name': orders.product_id.display_name,
                            'price_extra': orders.price_extra,
                            'name': orders.product_id.display_name,
                            'is_cooking': true,
                            'note': orders.note || ''
                        }]);
                    }

                    // ✅ Étape 5: Extraire la date
                    const date = new Date(self.currentOrder.date_order.replace(' ', 'T'));
                    
                    // ✅ Étape 6: Construire l'objet commande
                    var orders = [{
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
                        // ✅ AJOUT: Liste des screen_ids concernés (pour référence)
                        'target_screen_ids': matchingScreens.map(s => s.id)
                    }];

                    console.log('[ACTION PAD] 📤 Submitting order with data:', {
                        pos_reference: orders[0].pos_reference,
                        config_id: orders[0].config_id,
                        lines_count: line.length,
                        target_screens: matchingScreens.length,
                        screen_names: matchingScreens.map(s => s.name)
                    });

                    // ✅ Étape 7: Appel RPC pour créer/mettre à jour la commande cuisine
                    await self.env.services.orm.call(
                        "pos.order", 
                        "create_or_update_kitchen_order", 
                        [orders]
                    );
                    
                    console.log('[ACTION PAD] ✅ Order submitted successfully');
                    
                    // ✅ Étape 8: Trigger le bus pour TOUS les écrans concernés AVEC NOTIFICATION
                    if (matchingScreens.length > 0) {
                        for (const screen of matchingScreens) {
                            // ✅ NOTIFICATION: Déclencher l'événement de nouvelle commande
                            this.env.bus.trigger('pos-kitchen-new-order', {
                                screen_id: screen.id,
                                screen_name: screen.name,
                                config_id: this.pos.get_order().config_id.id,
                                order_reference: this.pos.get_order().pos_reference,
                                order_data: orders[0],
                                timestamp: new Date().toISOString(),
                                type: 'new_order' // Type d'événement pour le filtrage
                            });
                            
                            console.log(`[ACTION PAD] 📡 Bus notification sent to screen "${screen.name}" (ID: ${screen.id})`);
                        }
                        
                        console.log(`[ACTION PAD] ✅ Notifications sent to ${matchingScreens.length} screens`);
                    }

                    // ✅ Étape 9: Afficher un message de confirmation (optionnel)
                    if (matchingScreens.length > 0 && this.env.services.notification) {
                        const screenNames = matchingScreens.map(s => s.name).join(', ');
                        this.env.services.notification.add(
                            _t(`Order sent to: ${screenNames}`),
                            { type: 'success' }
                        );
                    }
                }
            } catch (error) {
                console.error('[ACTION PAD] ❌ Error in submitOrder:', error);
                
                // Afficher une notification d'erreur à l'utilisateur
                if (this.env.services.notification) {
                    this.env.services.notification.add(
                        _t("Error submitting order to kitchen. Please try again."),
                        { type: 'danger' }
                    );
                }
            } finally {
                this.clicked = false;
            }
        }
    },

    /**
     * ✅ MÉTHODE UTILITAIRE: Afficher un résumé de la distribution des lignes
     */
    async showOrderDistributionSummary() {
        const linesByScreen = await this.getOrderLinesByScreen();
        
        if (Object.keys(linesByScreen).length === 0) {
            console.warn('[ACTION PAD] No screen distribution available');
            return;
        }

        console.log('[ACTION PAD] 📊 Order Distribution Summary:');
        console.log('==========================================');
        
        for (const [screenId, data] of Object.entries(linesByScreen)) {
            console.log(`\n🖥️  Screen: ${data.screen_name} (ID: ${screenId})`);
            console.log(`   Lines: ${data.lines.length}`);
            
            for (const line of data.lines) {
                console.log(`   - ${line.qty}x ${line.product_name}`);
            }
        }
        
        console.log('\n==========================================');
    }
});

console.log('[ACTION PAD] ✅ Multi-Screen Action Pad Extension loaded');