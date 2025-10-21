# -*- coding: utf-8 -*-
from odoo import api, fields, models
import logging
import pytz
from datetime import datetime

_logger = logging.getLogger(__name__)


class PosOrder(models.Model):
    _inherit = 'pos.order'

    # ✅ CHANGEMENT MAJEUR: Many2many au lieu de Many2one
    screen_ids = fields.Many2many(
        'kitchen.screen',
        'pos_order_kitchen_screen_rel',
        'order_id',
        'screen_id',
        string='Kitchen Screens',
        help='Kitchen screens where this order appears',
        copy=False
    )


    def _process_screen_assignment(self, target_screen_ids=None):
        """
        ✅ MÉTHODE UNIFIÉE: Traitement intelligent des écrans
        Combine single + multi screen en une seule logique
        """
        try:
            _logger.info(f"[KITCHEN] 🎯 Starting screen assignment for order {self.name}")
            
            # ✅ Si écrans cibles spécifiés, les utiliser directement
            if target_screen_ids:
                _logger.info(f"[KITCHEN] 📌 Using target screens: {target_screen_ids}")
                self.sudo().write({'screen_ids': [(6, 0, target_screen_ids)]})
                return True

            # ✅ Vérifier que la commande a des lignes de cuisine
            kitchen_lines = self.lines.filtered(lambda l: l.is_cooking)
            if not kitchen_lines:
                _logger.warning(f"[KITCHEN] ⚠ Order {self.name} has no kitchen lines")
                return False

            # ✅ Récupérer TOUTES les catégories uniques
            all_categ_ids = set()
            for line in kitchen_lines:
                if line.product_id and line.product_id.pos_categ_ids:
                    all_categ_ids.update(line.product_id.pos_categ_ids.ids)
            
            if not all_categ_ids:
                _logger.warning(f"[KITCHEN] ⚠ Order {self.name} has no POS categories")
                return False

            _logger.info(f"[KITCHEN] 📋 Order {self.name} has categories: {list(all_categ_ids)}")

            # ✅ Trouver les écrans correspondants
            kitchen_screens = self.env["kitchen.screen"].sudo().search([
                ("pos_config_id", "=", self.config_id.id),
                ("active", "=", True)
            ])

            if not kitchen_screens:
                _logger.warning(f"[KITCHEN] ⚠ No active screens for POS {self.config_id.name}")
                return False

            # ✅ Identifier les écrans correspondants
            matching_screens = []
            for screen in kitchen_screens:
                screen_categ_ids = set(screen.pos_categ_ids.ids)
                common_categs = all_categ_ids & screen_categ_ids
                
                if common_categs:
                    matching_screens.append(screen)
                    _logger.info(
                        f"[KITCHEN] ✅ Screen '{screen.name}' matches categories: {list(common_categs)}"
                    )

            if not matching_screens:
                _logger.warning(f"[KITCHEN] ❌ No screens match order categories {list(all_categ_ids)}")
                return False

            # ✅ Assigner les écrans
            screen_ids = [screen.id for screen in matching_screens]
            self.sudo().write({'screen_ids': [(6, 0, screen_ids)]})
            
            screen_names = [screen.name for screen in matching_screens]
            _logger.info(f"[KITCHEN] 🎯 Order {self.name} assigned to {len(matching_screens)} screens: {screen_names}")
            
            return True

        except Exception as e:
            _logger.error(f"[KITCHEN] ❌ Error in screen assignment: {str(e)}", exc_info=True)
            return False
  



    @api.model_create_multi
    def create(self, vals_list):
        """Routage multi-écrans - VERSION CORRIGÉE"""
        res = super().create(vals_list)

        for order in res:
            try:
                # ✅ NE traiter que les commandes NON cuisine ici
                # Les commandes cuisine sont gérées par _create_kitchen_order
                if not order.is_cooking:
                    _logger.info(f"[KITCHEN] 🔄 Processing non-kitchen order: {order.name}")
                    order._process_screen_assignment()
                else:
                    _logger.info(f"[KITCHEN] ⏩ Skipping kitchen order (will be handled by _create_kitchen_order): {order.name}")
                    
            except Exception as e:
                _logger.error(f"[KITCHEN] ❌ Error in create screen assignment: {e}")
                continue

        return res
   
   

    def _create_kitchen_order(self, order_data):
        """
        ✅ RÉÉCRITURE COMPLÈTE: Crée une nouvelle commande cuisine
        Version robuste avec validation complète des données
        """
        try:
            _logger.info(f"[KITCHEN] 🆕 START _create_kitchen_order for {order_data.get('pos_reference')}")
            
            # ✅ VALIDATION 1: Données critiques
            pos_reference = order_data.get('pos_reference')
            config_id = order_data.get('config_id')
            session_id = order_data.get('session_id')
            
            if not all([pos_reference, config_id, session_id]):
                _logger.error(f"[KITCHEN] ❌ Missing critical data: pos_reference={pos_reference}, config_id={config_id}, session_id={session_id}")
                return None

            # ✅ VALIDATION 2: Vérifier l'existence des enregistrements liés
            config = self.env['pos.config'].browse(config_id)
            if not config.exists():
                _logger.error(f"[KITCHEN] ❌ POS config {config_id} does not exist")
                return None

            session = self.env['pos.session'].browse(session_id)
            if not session.exists():
                _logger.error(f"[KITCHEN] ❌ POS session {session_id} does not exist")
                return None

            # ✅ VALIDATION 3: Vérifier les lignes de commande
            lines_data = order_data.get('lines', [])
            if not lines_data:
                _logger.error(f"[KITCHEN] ❌ No lines data provided")
                return None

            _logger.info(f"[KITCHEN] 📋 Creating kitchen order with {len(lines_data)} lines")

            # ✅ CONSTRUCTION DES VALEURS DE LA COMMANDE
            order_vals = {
                'pos_reference': pos_reference,
                'session_id': session_id,
                'config_id': config_id,
                'amount_total': order_data.get('amount_total', 0.0),
                'amount_paid': order_data.get('amount_paid', 0.0),
                'amount_return': order_data.get('amount_return', 0.0),
                'amount_tax': order_data.get('amount_tax', 0.0),
                'date_order': order_data.get('date_order', fields.Datetime.now()),
                'is_cooking': True,  # ✅ CRITIQUE: Marquer comme commande cuisine
                'order_status': 'draft',
                'table_id': order_data.get('table_id'),
                'lines': []
            }

            # ✅ TRAITEMENT DES LIGNES AVEC VALIDATION
            valid_lines_count = 0
            for line_index, line_data in enumerate(lines_data):
                try:
                    if isinstance(line_data, (list, tuple)) and len(line_data) >= 3:
                        line_vals = line_data[2]
                        
                        # Validation du produit
                        product_id = line_vals.get('product_id')
                        if not product_id:
                            _logger.warning(f"[KITCHEN] ⚠ Line {line_index} missing product_id")
                            continue

                        product = self.env['product.product'].browse(product_id)
                        if not product.exists():
                            _logger.warning(f"[KITCHEN] ⚠ Product {product_id} does not exist")
                            continue

                        # ✅ LOG DÉTAILLÉ DES CATÉGORIES
                        product_categ_ids = product.pos_categ_ids.ids
                        product_categ_names = product.pos_categ_ids.mapped('name')
                        _logger.info(
                            f"[KITCHEN] 📦 Product '{product.display_name}': "
                            f"Categories={product_categ_names} (IDs: {product_categ_ids})"
                        )

                        # Construction des valeurs de ligne
                        line_creation_vals = {
                            'product_id': product_id,
                            'qty': float(line_vals.get('qty', 1)),
                            'price_unit': float(line_vals.get('price_unit', 0)),
                            'price_subtotal': float(line_vals.get('price_subtotal', 0)),
                            'price_subtotal_incl': float(line_vals.get('price_subtotal_incl', 0)),
                            'discount': float(line_vals.get('discount', 0)),
                            'is_cooking': True,  # ✅ CRITIQUE: Ligne de cuisine
                            'name': line_vals.get('full_product_name') or product.display_name,
                            'full_product_name': line_vals.get('full_product_name') or product.display_name,
                            'note': line_vals.get('note', ''),
                            'price_extra': float(line_vals.get('price_extra', 0)),
                        }

                        # Gestion des taxes
                        if line_vals.get('tax_ids'):
                            tax_data = line_vals['tax_ids']
                            if isinstance(tax_data, list) and len(tax_data) > 0:
                                if isinstance(tax_data[0], (list, tuple)) and len(tax_data[0]) >= 3:
                                    tax_ids = tax_data[0][2]
                                else:
                                    tax_ids = tax_data
                                line_creation_vals['tax_ids'] = [(6, 0, tax_ids)]

                        order_vals['lines'].append((0, 0, line_creation_vals))
                        valid_lines_count += 1
                        
                        _logger.info(
                            f"[KITCHEN] ➕ Added line: {product.display_name} "
                            f"(Qty: {line_creation_vals['qty']}, Cooking: True)"
                        )

                except Exception as line_error:
                    _logger.error(f"[KITCHEN] ❌ Error processing line {line_index}: {line_error}")
                    continue

            # ✅ VALIDATION FINALE: Au moins une ligne valide
            if valid_lines_count == 0:
                _logger.error(f"[KITCHEN] ❌ No valid lines to create order")
                return None

            _logger.info(f"[KITCHEN] ✅ Prepared order with {valid_lines_count} valid lines")

            # ✅ CRÉATION DE LA COMMANDE
            try:
                order = self.sudo().create(order_vals)
                _logger.info(f"[KITCHEN] 🎉 Order created successfully: {order.name} (ID: {order.id})")
            except Exception as create_error:
                _logger.error(f"[KITCHEN] ❌ Order creation failed: {create_error}")
                return None

            # ✅ DÉCLENCHEMENT DU TRAITEMENT MULTI-ÉCRANS
            try:
                target_screen_ids = order_data.get('target_screen_ids', [])
                _logger.info(f"[KITCHEN] 🔄 Starting multi-screen processing for {order.name}")
                
                success = order.sudo()._trigger_multi_screen_processing(target_screen_ids=target_screen_ids)
                
                if success:
                    _logger.info(f"[KITCHEN] ✅ Multi-screen processing completed for {order.name}")
                else:
                    _logger.warning(f"[KITCHEN] ⚠ Multi-screen processing had issues for {order.name}")

            except Exception as screen_error:
                _logger.error(f"[KITCHEN] ❌ Multi-screen processing failed: {screen_error}")
                # Ne pas échouer la création à cause de l'écran

            # ✅ VÉRIFICATION FINALE
            order.invalidate_cache()
            final_screen_count = len(order.screen_ids)
            final_line_count = len(order.lines.filtered(lambda l: l.is_cooking))
            
            _logger.info(
                f"[KITCHEN] 🎯 CREATION COMPLETE - Order {order.name}: "
                f"{final_line_count} cooking lines, {final_screen_count} screens, "
                f"is_cooking={order.is_cooking}"
            )

            return order

        except Exception as e:
            _logger.error(f"[KITCHEN] ❌ CRITICAL ERROR in _create_kitchen_order: {str(e)}", exc_info=True)
            return None


  

    def _update_kitchen_order(self, order, order_data):
        """
        ✅ RÉÉCRITURE COMPLÈTE: Met à jour une commande cuisine existante
        Version robuste avec gestion complète des modifications
        """
        try:
            _logger.info(f"[KITCHEN] 🔄 START _update_kitchen_order for {order.name}")
            
            # ✅ VALIDATION: Commande existante et valide
            if not order or not order.exists():
                _logger.error(f"[KITCHEN] ❌ Invalid order provided for update")
                return False

            # ✅ SAUVEGARDE DE L'ÉTAT ACTUEL POUR COMPARAISON
            current_screen_ids = order.screen_ids.ids
            current_cooking_lines = order.lines.filtered(lambda l: l.is_cooking)
            current_line_count = len(current_cooking_lines)
            
            _logger.info(
                f"[KITCHEN] 📊 BEFORE UPDATE - Order {order.name}: "
                f"{current_line_count} cooking lines, screens={current_screen_ids}"
            )

            # ✅ VALIDATION DES DONNÉES D'ENTRÉE
            lines_data = order_data.get('lines', [])
            if not lines_data:
                _logger.warning(f"[KITCHEN] ⚠ No lines data provided for update")
                return False

            _logger.info(f"[KITCHEN] 📋 Updating order with {len(lines_data)} new lines")

            # ✅ SUPPRESSION DES ANCIENNES LIGNES CUISINE
            try:
                if current_cooking_lines:
                    _logger.info(f"[KITCHEN] 🗑️ Removing {len(current_cooking_lines)} existing cooking lines")
                    
                    # Sauvegarder les IDs pour le log
                    removed_line_ids = current_cooking_lines.ids
                    current_cooking_lines.sudo().unlink()
                    
                    _logger.info(f"[KITCHEN] ✅ Removed cooking lines: {removed_line_ids}")
                else:
                    _logger.info(f"[KITCHEN] 📝 No existing cooking lines to remove")
                    
            except Exception as delete_error:
                _logger.error(f"[KITCHEN] ❌ Error removing old lines: {delete_error}")
                return False

            # ✅ CRÉATION DES NOUVELLES LIGNES
            new_lines = []
            valid_lines_count = 0
            
            for line_index, line_data in enumerate(lines_data):
                try:
                    if isinstance(line_data, (list, tuple)) and len(line_data) >= 3:
                        line_vals = line_data[2]
                        
                        # Validation du produit
                        product_id = line_vals.get('product_id')
                        if not product_id:
                            _logger.warning(f"[KITCHEN] ⚠ Update line {line_index} missing product_id")
                            continue

                        product = self.env['product.product'].browse(product_id)
                        if not product.exists():
                            _logger.warning(f"[KITCHEN] ⚠ Update product {product_id} does not exist")
                            continue

                        # ✅ LOG DÉTAILLÉ DES CATÉGORIES
                        product_categ_ids = product.pos_categ_ids.ids
                        product_categ_names = product.pos_categ_ids.mapped('name')
                        _logger.info(
                            f"[KITCHEN] 📦 Update - Product '{product.display_name}': "
                            f"Categories={product_categ_names} (IDs: {product_categ_ids})"
                        )

                        # Construction des valeurs de ligne
                        line_creation_vals = {
                            'product_id': product_id,
                            'qty': float(line_vals.get('qty', 1)),
                            'price_unit': float(line_vals.get('price_unit', 0)),
                            'price_subtotal': float(line_vals.get('price_subtotal', 0)),
                            'price_subtotal_incl': float(line_vals.get('price_subtotal_incl', 0)),
                            'discount': float(line_vals.get('discount', 0)),
                            'is_cooking': True,  # ✅ CRITIQUE: Ligne de cuisine
                            'name': line_vals.get('full_product_name') or product.display_name,
                            'full_product_name': line_vals.get('full_product_name') or product.display_name,
                            'note': line_vals.get('note', ''),
                            'price_extra': float(line_vals.get('price_extra', 0)),
                        }

                        # Gestion des taxes
                        if line_vals.get('tax_ids'):
                            tax_data = line_vals['tax_ids']
                            if isinstance(tax_data, list) and len(tax_data) > 0:
                                if isinstance(tax_data[0], (list, tuple)) and len(tax_data[0]) >= 3:
                                    tax_ids = tax_data[0][2]
                                else:
                                    tax_ids = tax_data
                                line_creation_vals['tax_ids'] = [(6, 0, tax_ids)]

                        new_lines.append((0, 0, line_creation_vals))
                        valid_lines_count += 1
                        
                        _logger.info(
                            f"[KITCHEN] ➕ Adding update line: {product.display_name} "
                            f"(Qty: {line_creation_vals['qty']}, Cooking: True)"
                        )

                except Exception as line_error:
                    _logger.error(f"[KITCHEN] ❌ Error processing update line {line_index}: {line_error}")
                    continue

            # ✅ VALIDATION: Au moins une ligne valide
            if valid_lines_count == 0:
                _logger.error(f"[KITCHEN] ❌ No valid lines to update order")
                return False

            # ✅ MISE À JOUR DE LA COMMANDE
            try:
                update_vals = {
                    'lines': new_lines,
                    'is_cooking': True,  # ✅ S'assurer que c'est toujours une commande cuisine
                    'order_status': 'draft',
                    'amount_total': order_data.get('amount_total', order.amount_total),
                    'amount_paid': order_data.get('amount_paid', order.amount_paid),
                    'amount_return': order_data.get('amount_return', order.amount_return),
                    'amount_tax': order_data.get('amount_tax', order.amount_tax),
                }
                
                order.sudo().write(update_vals)
                _logger.info(f"[KITCHEN] ✅ Order updated successfully with {valid_lines_count} new lines")
                
            except Exception as update_error:
                _logger.error(f"[KITCHEN] ❌ Order update failed: {update_error}")
                return False

            # ✅ DÉCLENCHEMENT DU TRAITEMENT MULTI-ÉCRANS
            try:
                target_screen_ids = order_data.get('target_screen_ids', [])
                _logger.info(f"[KITCHEN] 🔄 Starting multi-screen processing for updated order {order.name}")
                
                success = order.sudo()._trigger_multi_screen_processing(target_screen_ids=target_screen_ids)
                
                if success:
                    _logger.info(f"[KITCHEN] ✅ Multi-screen processing completed for updated order")
                else:
                    _logger.warning(f"[KITCHEN] ⚠ Multi-screen processing had issues for updated order")

            except Exception as screen_error:
                _logger.error(f"[KITCHEN] ❌ Multi-screen processing failed for update: {screen_error}")
                # Ne pas échouer la mise à jour à cause de l'écran

            # ✅ VÉRIFICATION FINALE
            order.invalidate_cache()
            new_screen_ids = order.screen_ids.ids
            new_cooking_lines = order.lines.filtered(lambda l: l.is_cooking)
            new_line_count = len(new_cooking_lines)
            
            _logger.info(
                f"[KITCHEN] 🎯 UPDATE COMPLETE - Order {order.name}: "
                f"{new_line_count} cooking lines (was {current_line_count}), "
                f"screens={new_screen_ids} (was {current_screen_ids})"
            )

            # ✅ LOG DES LIGNES FINALES
            for line in new_cooking_lines:
                _logger.info(
                    f"[KITCHEN] 📝 Final line {line.id}: '{line.product_id.display_name}' "
                    f"(Qty: {line.qty}, Cooking: {line.is_cooking})"
                )

            return True

        except Exception as e:
            _logger.error(f"[KITCHEN] ❌ CRITICAL ERROR in _update_kitchen_order: {str(e)}", exc_info=True)
            return False


    
    def _trigger_multi_screen_processing(self, target_screen_ids=None):
        """
        ✅ VERSION SIMPLIFIÉE: Appel direct à la méthode unifiée
        """
        try:
            _logger.info(f"[KITCHEN] 🔄 Triggering screen processing for {self.name}")
            
            # ✅ Réinitialiser les écrans
            current_screens = self.screen_ids.ids
            if current_screens:
                _logger.info(f"[KITCHEN] 🗑️ Clearing current screens: {current_screens}")
                self.sudo().write({'screen_ids': [(5, 0, 0)]})
            
            # ✅ Appel direct à la méthode unifiée
            success = self._process_screen_assignment(target_screen_ids)
            
            # ✅ Vérification finale
            self.invalidate_cache()
            new_screens = self.screen_ids.ids
            _logger.info(f"[KITCHEN] ✅ Screen processing completed: {len(new_screens)} screens assigned")
            
            return success
            
        except Exception as e:
            _logger.error(f"[KITCHEN] ❌ Error in screen processing: {str(e)}", exc_info=True)
            return False


    
    
    
    @api.model
    def create_or_update_kitchen_order(self, orders_data):
        """
        ✅ VERSION AMÉLIORÉE: Gestion robuste des commandes cuisine
        """
        _logger.info(f"[KITCHEN] 📥 create_or_update_kitchen_order called with {len(orders_data)} orders")
        
        try:
            results = []
            for order_data in orders_data:
                try:
                    pos_reference = order_data.get('pos_reference')
                    config_id = order_data.get('config_id')
                    
                    if not pos_reference or not config_id:
                        _logger.error(f"[KITCHEN] ❌ Missing critical data in order")
                        continue

                    _logger.info(f"[KITCHEN] 🔍 Processing order {pos_reference}")
                    
                    # ✅ Récupérer les écrans cibles
                    target_screen_ids = order_data.get('target_screen_ids', [])
                    
                    # Recherche de commande existante
                    order = self.sudo().search([
                        ('pos_reference', '=', pos_reference),
                        ('config_id', '=', config_id)
                    ], limit=1)
                    
                    if order:
                        _logger.info(f"[KITCHEN] 📋 Updating existing order: {order.name}")
                        success = self._update_kitchen_order(order, order_data)
                        if success:
                            results.append(order.id)
                    else:
                        _logger.info(f"[KITCHEN] 🆕 Creating new kitchen order")
                        order = self._create_kitchen_order(order_data)
                        if order:
                            results.append(order.id)
                    
                    # ✅ APPEL UNIFIÉ pour l'assignation d'écrans
                    if order and order.exists():
                        _logger.info(f"[KITCHEN] 🔄 Triggering screen assignment for {order.name}")
                        order.sudo()._trigger_multi_screen_processing(target_screen_ids=target_screen_ids)
                        
                except Exception as order_error:
                    _logger.error(f"[KITCHEN] ❌ Error processing individual order: {order_error}")
                    continue
                        
            _logger.info(f"[KITCHEN] ✅ create_or_update_kitchen_order completed: {len(results)} orders processed")
            return results
            
        except Exception as e:
            _logger.error(f"[KITCHEN] ❌ Error in create_or_update_kitchen_order: {str(e)}", exc_info=True)
            return False




    @api.model
    def get_details(self, shop_id, screen_id=None, *args, **kwargs):
        """
        ✅ CORRECTION: Filtrage robuste avec Many2many
        """
        try:
            # ✅ CORRECTION: Utiliser sudo() pour garantir l'accès
            if screen_id:
                kitchen_screen = self.env["kitchen.screen"].sudo().browse(screen_id)
                if not kitchen_screen.exists():
                    _logger.warning(f"[KITCHEN] Screen {screen_id} not found")
                    return {"orders": [], "order_lines": []}
            else:
                kitchen_screen = self.env["kitchen.screen"].sudo().search([
                    ("pos_config_id", "=", shop_id), 
                    ("active", "=", True)
                ], limit=1)

            if not kitchen_screen or not kitchen_screen.exists():
                _logger.warning(f"[KITCHEN] No active screen found for POS {shop_id}")
                return {"orders": [], "order_lines": []}

            screen_categ_ids = kitchen_screen.pos_categ_ids.ids
            screen_name = kitchen_screen.display_name_custom or kitchen_screen.name or f"Screen {kitchen_screen.id}"
            
            _logger.info(
                f"[KITCHEN] 🔍 GET_DETAILS for Screen '{screen_name}' (ID: {kitchen_screen.id}) "
                f"with categories: {screen_categ_ids}"
            )

            if not screen_categ_ids:
                _logger.warning(f"[KITCHEN] Screen '{screen_name}' has NO categories assigned!")
                return {"orders": [], "order_lines": []}

            # ✅ CORRECTION CRITIQUE: Récupérer les commandes avec une approche différente
            # Rechercher les commandes qui ont CET écran dans leurs screen_ids
            pos_orders = self.env["pos.order"].sudo().search([
                ("is_cooking", "=", True),
                ("config_id", "=", shop_id),
                ("state", "not in", ["cancel", "paid"]),
                ("order_status", "!=", "cancel"),
            ])

            _logger.info(
                f"[KITCHEN] Found {len(pos_orders)} total cooking orders for POS {shop_id}"
            )

            # ✅ CORRECTION: Filtrer par screen_ids Many2many
            orders_for_this_screen = []
            visible_lines = self.env['pos.order.line']
            
            for order in pos_orders:
                _logger.info(
                    f"[KITCHEN] Checking order {order.name}: "
                    f"screen_ids={order.screen_ids.ids}, "
                    f"status={order.order_status}"
                )
                
                # Vérifier si la commande est assignée à cet écran
                current_screen_ids = order.screen_ids.ids
                screen_assigned = kitchen_screen.id in current_screen_ids
                
                if screen_assigned:
                    _logger.info(f"[KITCHEN] ✓ Order {order.name} is assigned to this screen")
                    
                    # Filtrer les lignes de CETTE commande pour CET écran
                    order_visible_lines = self._get_visible_lines_for_screen(order, kitchen_screen)
                    
                    if order_visible_lines:
                        orders_for_this_screen.append(order)
                        visible_lines |= order_visible_lines
                        _logger.info(
                            f"[KITCHEN] ✓ Order {order.name} has {len(order_visible_lines)} visible lines"
                        )
                    else:
                        _logger.warning(
                            f"[KITCHEN] ⚠ Order {order.name} assigned but no visible lines"
                        )
                else:
                    _logger.info(f"[KITCHEN] ✗ Order {order.name} not assigned to this screen")
                    
                    # ✅ CORRECTION: Vérifier si la commande DEVRAIT être sur cet écran
                    should_be_assigned = self._should_order_be_on_screen(order, kitchen_screen)
                    if should_be_assigned:
                        _logger.info(
                            f"[KITCHEN] 🔄 Order {order.name} should be on this screen - auto-assigning"
                        )
                        
                        # Auto-assigner
                        try:
                            order.sudo().with_context(skip_status_notification=True).write({
                                'screen_ids': [(4, kitchen_screen.id)]
                            })
                            self.env.cr.commit()
                            
                            # Re-vérifier les lignes après assignation
                            order_visible_lines = self._get_visible_lines_for_screen(order, kitchen_screen)
                            if order_visible_lines:
                                orders_for_this_screen.append(order)
                                visible_lines |= order_visible_lines
                                _logger.info(
                                    f"[KITCHEN] ✅ Auto-assigned and added {order.name} with {len(order_visible_lines)} lines"
                                )
                        except Exception as e:
                            _logger.error(f"[KITCHEN] ❌ Auto-assign failed: {e}")

            _logger.info(
                f"[KITCHEN] ✅ FINAL: {len(orders_for_this_screen)} orders, {len(visible_lines)} lines "
                f"for screen '{screen_name}'"
            )

            # Préparation du résultat
            values = {
                "orders": [order.read([])[0] for order in orders_for_this_screen],
                "order_lines": visible_lines.read([]),
                "screen_id": kitchen_screen.id,
                "screen_name": screen_name,
                "screen_categories": screen_categ_ids
            }

            # Conversion de l'heure (code existant)
            user_tz_str = self.env.user.tz or 'UTC'
            user_tz = pytz.timezone(user_tz_str)
            utc = pytz.utc

            for value in values['orders']:
                if value.get('table_id'):
                    value['floor'] = value['table_id'][1].split(',')[0].strip()

                date_str = value['date_order']
                try:
                    if isinstance(date_str, str):
                        utc_dt = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
                        utc_dt = utc.localize(utc_dt)
                    else:
                        utc_dt = utc.localize(value['date_order'])

                    local_dt = utc_dt.astimezone(user_tz)
                    value['hour'] = local_dt.hour
                    value['formatted_minutes'] = f"{local_dt.minute:02d}"
                    value['minutes'] = local_dt.minute
                except Exception as e:
                    _logger.error(f"[KITCHEN] Date conversion error: {e}")
                    value['hour'] = 0
                    value['minutes'] = 0
                    value['formatted_minutes'] = "00"

            return values

        except Exception as e:
            _logger.error(f"[KITCHEN] Error in get_details: {str(e)}", exc_info=True)
            return {"orders": [], "order_lines": []}
        


    @api.model
    def trigger_kitchen_notifications(self, pos_reference, screen_ids):
        """
        ✅ NOUVELLE MÉTHODE: Déclenche les notifications backend pour les écrans
        Appelée depuis le POS après soumission d'une commande
        """
        try:
            _logger.info(f"[KITCHEN] 🔔 Triggering notifications for order {pos_reference} to screens: {screen_ids}")
            
            # Récupérer la commande
            order = self.sudo().search([('pos_reference', '=', pos_reference)], limit=1)
            if not order or not order.exists():
                _logger.warning(f"[KITCHEN] ⚠ Order {pos_reference} not found for notification")
                return False
            
            # Récupérer les écrans
            screens = self.env['kitchen.screen'].sudo().browse(screen_ids)
            screens = screens.filtered(lambda s: s.exists())
            
            if not screens:
                _logger.warning(f"[KITCHEN] ⚠ No valid screens found for notification")
                return False
            
            _logger.info(f"[KITCHEN] 📡 Sending notifications to {len(screens)} screens")
            
            # Envoyer une notification à CHAQUE écran
            for screen in screens:
                self._send_new_order_notification(screen, order)
            
            _logger.info(f"[KITCHEN] ✅ Notifications sent successfully")
            return True
            
        except Exception as e:
            _logger.error(f"[KITCHEN] ❌ Error triggering notifications: {str(e)}", exc_info=True)
            return False

    def _send_new_order_notification(self, screen, order):
        """
        ✅ Envoie une notification de NOUVELLE COMMANDE à un écran spécifique
        """
        try:
            if not screen.exists() or not order.exists():
                _logger.warning("[KITCHEN] Invalid screen or order for new order notification")
                return

            channel = f"kitchen.screen.{screen.id}"
            screen_categ_ids = screen.pos_categ_ids.ids

            # Filtrer les lignes visibles pour cet écran
            visible_lines = order.lines.filtered(
                lambda line: (
                    line.is_cooking and 
                    line.product_id and 
                    (set(line.product_id.pos_categ_ids.ids) & set(screen_categ_ids))
                )
            )

            if not visible_lines:
                _logger.warning(f"[KITCHEN] No visible lines for screen {screen.id}")
                return

            screen_name = screen.display_name_custom or screen.name or f"Screen {screen.id}"

            # ✅ MESSAGE SPÉCIAL POUR NOUVELLE COMMANDE
            message = {
                "type": "new_order",  # Type spécifique
                "screen_id": screen.id,
                "screen_name": screen_name,
                "order_id": order.id,
                "order_name": order.name,
                "order_reference": order.pos_reference,
                "order_ref": order.order_ref or order.name,
                "order_status": order.order_status,
                "table_name": order.table_id.display_name if order.table_id else None,
                "config_id": order.config_id.id,
                "config_name": order.config_id.name,
                "timestamp": fields.Datetime.now().isoformat(),
                "lines_count": len(visible_lines),
                "lines": [{
                    'id': line.id,
                    'product_name': line.product_id.display_name,
                    'qty': line.qty,
                    'note': line.note or '',
                } for line in visible_lines if line.product_id]
            }

            # ✅ ENVOI SUR LE BUS
            self.env["bus.bus"]._sendone(channel, "new_order", message)

            _logger.info(
                f"[KITCHEN] 🔔 NEW ORDER notification sent to '{screen_name}' "
                f"(channel: {channel}) for order {order.pos_reference}"
            )

        except Exception as e:
            _logger.error(f"[KITCHEN] ❌ Error sending new order notification: {str(e)}", exc_info=True)
        


    def _get_visible_lines_for_screen(self, order, kitchen_screen):
        """Récupère les lignes visibles pour un écran spécifique"""
        try:
            screen_categ_ids = kitchen_screen.pos_categ_ids.ids
            visible_lines = self.env['pos.order.line']
            
            for line in order.lines.filtered(lambda l: l.is_cooking):
                if not line.product_id:
                    continue
                    
                product_categ_ids = line.product_id.pos_categ_ids.ids
                
                # Vérifier l'intersection avec les catégories de l'écran
                if set(product_categ_ids) & set(screen_categ_ids):
                    visible_lines |= line
                    _logger.debug(
                        f"[KITCHEN] ✓ Line {line.id} ({line.product_id.name}) "
                        f"visible on screen '{kitchen_screen.name}'"
                    )
            
            return visible_lines
            
        except Exception as e:
            _logger.error(f"[KITCHEN] Error in _get_visible_lines_for_screen: {e}")
            return self.env['pos.order.line']
        


    def _should_order_be_on_screen(self, order, kitchen_screen):
        """Détermine si une commande devrait être sur cet écran"""
        try:
            screen_categ_ids = kitchen_screen.pos_categ_ids.ids
            
            for line in order.lines.filtered(lambda l: l.is_cooking):
                if not line.product_id:
                    continue
                    
                product_categ_ids = line.product_id.pos_categ_ids.ids
                
                # Si au moins une ligne correspond aux catégories de l'écran
                if set(product_categ_ids) & set(screen_categ_ids):
                    return True
                    
            return False
            
        except Exception as e:
            _logger.error(f"[KITCHEN] Error in _should_order_be_on_screen: {e}")
            return False



    @api.model
    def check_order_status(self, order_name, pos_reference):
        """
        ✅ Vérifie le statut d'une commande
        Retourne False si la commande est terminée (payée + prête), True sinon
        """
        try:
            _logger.info(f"[KITCHEN] 🔍 Checking order status for: {pos_reference}")
            
            # Rechercher la commande par référence
            order = self.search([('pos_reference', '=', pos_reference)], limit=1)
            
            if not order:
                _logger.warning(f"[KITCHEN] Order {pos_reference} not found")
                return True  # Permettre la soumission si commande non trouvée
            
            # Vérifier si la commande est complètement terminée
            # (payée ET statut "ready")
            if order.state == "paid" and order.order_status == "ready":
                _logger.info(f"[KITCHEN] ❌ Order {pos_reference} is completed (paid + ready)")
                return False
            
            _logger.info(f"[KITCHEN] ✅ Order {pos_reference} can be updated")
            return True
            
        except Exception as e:
            _logger.error(f"[KITCHEN] Error checking order status: {str(e)}", exc_info=True)
            return True  # En cas d'erreur, permettre la soumission
    
    
    
    def _notify_single_screen(self, screen, order, notification_type):
        """Notifie UN SEUL écran avec uniquement SES lignes"""
        try:
            if not screen.exists() or not order.exists():
                _logger.warning("[KITCHEN] Invalid screen or order for notification")
                return

            screen_categ_ids = screen.pos_categ_ids.ids
            visible_lines = order.lines.filtered(
                lambda line: (
                    line.is_cooking and 
                    line.product_id and 
                    (set(line.product_id.pos_categ_ids.ids) & set(screen_categ_ids))
                )
            )

            if not visible_lines:
                _logger.warning(
                    f"[KITCHEN] Screen {screen.id} has no visible lines for order {order.name}"
                )
                return

            self._send_screen_notification(
                screen, 
                order, 
                notification_type,
                line_ids=visible_lines.ids
            )

            _logger.info(
                f"[KITCHEN] Single notification sent to screen '{screen.name}' "
                f"for order {order.name}: {notification_type}"
            )

        except Exception as e:
            _logger.error(f"[KITCHEN] Error in _notify_single_screen: {str(e)}", exc_info=True)

    def write(self, vals):
        """Override write pour notifier les changements de statut"""
        res = super(PosOrder, self).write(vals)

        try:
            if 'order_status' in vals and not self.env.context.get('skip_status_notification'):
                for order in self:
                    if order.is_cooking:
                        self._notify_screens_for_order(order, 'order_status_change')
        except Exception as e:
            _logger.error(f"[KITCHEN] Error in write notification: {str(e)}", exc_info=True)

        return res

    def _notify_screens_for_order(self, order, notification_type):
        """Notifier TOUS les écrans concernés"""
        try:
            kitchen_screens = self.env["kitchen.screen"].sudo().search([
                ("pos_config_id", "=", order.config_id.id),
                ("active", "=", True)
            ])

            if not kitchen_screens:
                return

            _logger.info(f"[KITCHEN] Notifying {len(kitchen_screens)} screens for order {order.name}")

            screen_lines_map = {}

            for line in order.lines.filtered(lambda l: l.is_cooking):
                if not line.product_id:
                    continue

                product_pos_categs = line.product_id.pos_categ_ids.ids

                for screen in kitchen_screens:
                    if not screen.exists():
                        continue

                    screen_categ_ids = screen.pos_categ_ids.ids

                    if set(product_pos_categs) & set(screen_categ_ids):
                        if screen.id not in screen_lines_map:
                            screen_lines_map[screen.id] = []
                        screen_lines_map[screen.id].append(line.id)

            for screen_id, line_ids in screen_lines_map.items():
                screen = self.env["kitchen.screen"].sudo().browse(screen_id)
                if screen.exists():
                    self._send_screen_notification(
                        screen, 
                        order, 
                        notification_type,
                        line_ids=line_ids
                    )
                    
                    _logger.info(
                        f"[KITCHEN] ✅ Notified '{screen.name}': {len(line_ids)} lines"
                    )

        except Exception as e:
            _logger.error(f"[KITCHEN] Error in _notify_screens_for_order: {str(e)}", exc_info=True)

    def _send_screen_notification(self, screen, order, notification_type, line_ids=None):
        """Envoie une notification à un écran spécifique"""
        try:
            if not screen.exists() or not order.exists():
                _logger.warning("[KITCHEN] Invalid screen or order for notification")
                return

            channel = f"kitchen.screen.{screen.id}"
            screen_categ_ids = screen.pos_categ_ids.ids

            if line_ids:
                visible_lines = order.lines.filtered(lambda l: l.id in line_ids)
            else:
                visible_lines = order.lines.filtered(
                    lambda line: (
                        line.is_cooking and 
                        line.product_id and 
                        (set(line.product_id.pos_categ_ids.ids) & set(screen_categ_ids))
                    )
                )

            if not visible_lines:
                _logger.warning(f"[KITCHEN] No visible lines for screen {screen.id}")
                return

            screen_name = screen.display_name_custom or screen.name or f"Screen {screen.id}"

            message = {
                "type": notification_type,
                "screen_id": screen.id,
                "screen_name": screen_name,
                "order_id": order.id,
                "order_name": order.name,
                "order_ref": order.order_ref or order.name,
                "order_status": order.order_status,
                "table_name": order.table_id.display_name if order.table_id else None,
                "config_id": order.config_id.id,
                "config_name": order.config_id.name,
                "timestamp": fields.Datetime.now().isoformat(),
                "lines": [{
                    'id': line.id,
                    'product_name': line.product_id.display_name,
                    'qty': line.qty,
                    'note': line.note or '',
                    'order_status': line.order_status,
                } for line in visible_lines if line.product_id]
            }

            self.env["bus.bus"]._sendone(channel, notification_type, message)

            _logger.info(
                f"[KITCHEN] ✉️ Notification sent to '{screen_name}' "
                f"(channel: {channel}): {notification_type} for order {order.name}"
            )

        except Exception as e:
            _logger.error(f"[KITCHEN] Error sending notification: {str(e)}", exc_info=True)


class PosOrderLine(models.Model):
    _inherit = 'pos.order.line'

    def write(self, vals):
        """Notifier les écrans lors de modification de lignes"""
        res = super(PosOrderLine, self).write(vals)

        try:
            if 'order_status' in vals:
                for line in self:
                    if line.order_id and line.order_id.is_cooking:
                        self._notify_line_change(line)
        except Exception as e:
            _logger.error(f"[KITCHEN] Error in line write notification: {str(e)}", exc_info=True)

        return res

    def _notify_line_change(self, line):
        """Notifie TOUS les écrans concernés par cette ligne"""
        try:
            if not line.product_id:
                return

            product_pos_categs = line.product_id.pos_categ_ids.ids
            if not product_pos_categs:
                return

            screens = self.env['kitchen.screen'].sudo().search([
                ('pos_config_id', '=', line.order_id.config_id.id),
                ('active', '=', True)
            ])

            screens_to_notify = screens.filtered(
                lambda s: (
                    s.exists() and 
                    (set(s.pos_categ_ids.ids) & set(product_pos_categs))
                )
            )

            for screen in screens_to_notify:
                if not screen.exists():
                    continue

                channel = f"kitchen.screen.{screen.id}"

                message = {
                    "type": "order_line_updated",
                    "screen_id": screen.id,
                    "line_id": line.id,
                    "order_id": line.order_id.id,
                    "order_name": line.order_id.name,
                    "product_name": line.product_id.display_name,
                    "qty": line.qty,
                    "order_status": line.order_status,
                    "timestamp": fields.Datetime.now().isoformat(),
                }

                self.env["bus.bus"]._sendone(channel, "order_line_updated", message)

        except Exception as e:
            _logger.error(f"[KITCHEN] Error in _notify_line_change: {str(e)}", exc_info=True)