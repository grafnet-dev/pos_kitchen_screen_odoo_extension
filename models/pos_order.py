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
        ✅ CORRIGÉE: Assignation directe sans filtrage préalable
        """
        try:
            _logger.info(f"[KITCHEN] 🎯 ==========================================")
            _logger.info(f"[KITCHEN] 🎯 Starting screen assignment for order {self.name}")
            
            # ✅ Si écrans cibles spécifiés, ASSIGNER DIRECTEMENT
            if target_screen_ids:
                _logger.info(f"[KITCHEN] 📌 Target screens provided: {target_screen_ids}")
                
                screens_to_check = self.env["kitchen.screen"].sudo().browse(target_screen_ids)
                screens_to_check = screens_to_check.filtered(lambda s: s.exists() and s.active)
                
                if not screens_to_check:
                    _logger.error(f"[KITCHEN] ❌ No valid screens in target list: {target_screen_ids}")
                    return False
                
                valid_screen_ids = screens_to_check.ids
                screen_names = screens_to_check.mapped('name')
                
                _logger.info(
                    f"[KITCHEN] 🎯 Assigning {len(valid_screen_ids)} screens directly: "
                    f"{screen_names} (IDs: {valid_screen_ids})"
                )
                
                # ✅ ASSIGNATION DIRECTE
                self.sudo().write({'screen_ids': [(6, 0, valid_screen_ids)]})
                
                # ✅ Validation immédiate
                self.invalidate_cache(['screen_ids'])
                actual_screens = self.screen_ids.ids
                
                _logger.info(
                    f"[KITCHEN] ✅ Assignment complete. Verification: {actual_screens}"
                )
                
                if actual_screens != valid_screen_ids:
                    _logger.error(
                        f"[KITCHEN] ❌ Assignment MISMATCH! "
                        f"Expected: {valid_screen_ids}, Got: {actual_screens}"
                    )
                    return False
                
                _logger.info(f"[KITCHEN] 🎯 ==========================================")
                return True
                            
            # ✅ Détection automatique (fallback)
            kitchen_lines = self.lines.filtered(lambda l: l.is_cooking)
            if not kitchen_lines:
                _logger.warning(f"[KITCHEN] ⚠ Order {self.name} has no kitchen lines")
                return False

            all_categ_ids = set()
            for line in kitchen_lines:
                if line.product_id and line.product_id.pos_categ_ids:
                    line_categs = line.product_id.pos_categ_ids.ids
                    all_categ_ids.update(line_categs)
            
            if not all_categ_ids:
                _logger.warning(f"[KITCHEN] ⚠ Order {self.name} has no POS categories")
                return False

            all_categ_list = list(all_categ_ids)
            _logger.info(f"[KITCHEN] 📋 Order {self.name} categories: {all_categ_list}")

            kitchen_screens = self.env["kitchen.screen"].sudo().search([
                ("pos_config_id", "=", self.config_id.id),
                ("active", "=", True)
            ])

            if not kitchen_screens:
                _logger.warning(f"[KITCHEN] ⚠ No active screens for POS {self.config_id.name}")
                return False

            matching_screens = []
            for screen in kitchen_screens:
                screen_categ_ids = set(screen.pos_categ_ids.ids)
                common_categs = all_categ_ids & screen_categ_ids
                
                if common_categs:
                    matching_screens.append(screen)

            if not matching_screens:
                _logger.error(
                    f"[KITCHEN] ❌ No screens match order categories {all_categ_list}"
                )
                return False

            screen_ids = [screen.id for screen in matching_screens]
            screen_names = [screen.name for screen in matching_screens]
            
            _logger.info(
                f"[KITCHEN] 🎯 Auto-assigning {len(matching_screens)} screens: "
                f"{screen_names} (IDs: {screen_ids})"
            )
            
            self.sudo().write({'screen_ids': [(6, 0, screen_ids)]})
            self.invalidate_cache(['screen_ids'])
            
            assigned_count = len(self.screen_ids)
            if assigned_count == 0:
                _logger.error(f"[KITCHEN] ❌ Assignment failed!")
                return False
            
            _logger.info(f"[KITCHEN] ✅ Assignment successful: {assigned_count} screens")
            _logger.info(f"[KITCHEN] ==========================================")
            
            return True

        except Exception as e:
            _logger.error(
                f"[KITCHEN] ❌ CRITICAL ERROR in screen assignment for {self.name}: {str(e)}", 
                exc_info=True
            )
            return False


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

    
    
    def _send_instant_notifications(self, order, screen_ids):
        """
        ✅ NOUVELLE : Envoie des notifications instantanées aux écrans
        """
        try:
            _logger.info(f"[KITCHEN] 🔔 Sending instant notifications for {order.name}")
            
            screens = self.env['kitchen.screen'].sudo().browse(screen_ids)
            screens = screens.filtered(lambda s: s.exists())
            
            for screen in screens:
                # Vérifier que l'écran a des lignes visibles
                visible_lines = self._get_visible_lines_for_screen(order, screen)
                if visible_lines:
                    self._send_new_order_notification(screen, order)
                    _logger.info(
                        f"[KITCHEN] ✅ Notification sent to '{screen.name}' "
                        f"({len(visible_lines)} lines)"
                    )
                else:
                    _logger.warning(
                        f"[KITCHEN] ⚠ Skipped notification to '{screen.name}' "
                        f"(no visible lines)"
                    )
            
            _logger.info(f"[KITCHEN] 🔔 Instant notifications completed")
            
        except Exception as e:
            _logger.error(f"[KITCHEN] ❌ Error in instant notifications: {str(e)}", exc_info=True)


    @api.model_create_multi
    def create(self, vals_list):
        """
        ✅ CORRECTION CRITIQUE: Désactiver l'assignation automatique
        L'assignation sera faite UNIQUEMENT par create_or_update_kitchen_order
        """
        res = super().create(vals_list)

        for order in res:
            try:
                _logger.info(f"[KITCHEN] 🆕 Order created: {order.name}")
                _logger.info(f"[KITCHEN] 🆕 is_cooking={order.is_cooking}")
                
                # ✅ NE PLUS ASSIGNER ICI - Laisser create_or_update_kitchen_order gérer
                if order.is_cooking:
                    _logger.info(
                        f"[KITCHEN] ⏸️ Kitchen order {order.name} created - "
                        f"waiting for explicit screen assignment"
                    )
                    
            except Exception as e:
                _logger.error(
                    f"[KITCHEN] ❌ Error in create for {order.name}: {e}",
                    exc_info=True
                )
                continue

        return res
    
   
    def _create_kitchen_order(self, order_data):
        """
        ✅ SIMPLIFIÉE : Crée UNIQUEMENT la commande, SANS assignation d'écrans
        L'assignation sera faite par create_or_update_kitchen_order
        """
        try:
            _logger.info(f"[KITCHEN] 🆕 ==========================================")
            _logger.info(f"[KITCHEN] 🆕 START _create_kitchen_order for {order_data.get('pos_reference')}")
            
            # ✅ VALIDATION des données critiques
            pos_reference = order_data.get('pos_reference')
            config_id = order_data.get('config_id')
            session_id = order_data.get('session_id')
            
            if not all([pos_reference, config_id, session_id]):
                _logger.error(
                    f"[KITCHEN] ❌ Missing critical data: "
                    f"pos_reference={pos_reference}, config_id={config_id}, session_id={session_id}"
                )
                return None

            # Validation des enregistrements
            config = self.env['pos.config'].browse(config_id)
            if not config.exists():
                _logger.error(f"[KITCHEN] ❌ POS config {config_id} does not exist")
                return None

            session = self.env['pos.session'].browse(session_id)
            if not session.exists():
                _logger.error(f"[KITCHEN] ❌ POS session {session_id} does not exist")
                return None

            lines_data = order_data.get('lines', [])
            if not lines_data:
                _logger.error(f"[KITCHEN] ❌ No lines data provided")
                return None

            _logger.info(f"[KITCHEN] 📋 Creating kitchen order with {len(lines_data)} lines")

            # ✅ Construction des valeurs de commande
            order_vals = {
                'pos_reference': pos_reference,
                'session_id': session_id,
                'config_id': config_id,
                'amount_total': order_data.get('amount_total', 0.0),
                'amount_paid': order_data.get('amount_paid', 0.0),
                'amount_return': order_data.get('amount_return', 0.0),
                'amount_tax': order_data.get('amount_tax', 0.0),
                'date_order': order_data.get('date_order', fields.Datetime.now()),
                'is_cooking': True,
                'order_status': 'draft',
                'table_id': order_data.get('table_id'),
                'lines': [],
                # ✅ PAS d'assignation d'écrans ici !
            }

            # ✅ Traitement des lignes
            valid_lines_count = 0
            for line_index, line_data in enumerate(lines_data):
                try:
                    if isinstance(line_data, (list, tuple)) and len(line_data) >= 3:
                        line_vals = line_data[2]
                        
                        product_id = line_vals.get('product_id')
                        if not product_id:
                            _logger.warning(f"[KITCHEN] ⚠ Line {line_index} missing product_id")
                            continue

                        product = self.env['product.product'].browse(product_id)
                        if not product.exists():
                            _logger.warning(f"[KITCHEN] ⚠ Product {product_id} does not exist")
                            continue

                        line_creation_vals = {
                            'product_id': product_id,
                            'qty': float(line_vals.get('qty', 1)),
                            'price_unit': float(line_vals.get('price_unit', 0)),
                            'price_subtotal': float(line_vals.get('price_subtotal', 0)),
                            'price_subtotal_incl': float(line_vals.get('price_subtotal_incl', 0)),
                            'discount': float(line_vals.get('discount', 0)),
                            'is_cooking': True,
                            'name': line_vals.get('full_product_name') or product.display_name,
                            'full_product_name': line_vals.get('full_product_name') or product.display_name,
                            'note': line_vals.get('note', ''),
                            'price_extra': float(line_vals.get('price_extra', 0)),
                        }

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

                except Exception as line_error:
                    _logger.error(f"[KITCHEN] ❌ Error processing line {line_index}: {line_error}")
                    continue

            if valid_lines_count == 0:
                _logger.error(f"[KITCHEN] ❌ No valid lines to create order")
                return None

            # ✅ CRÉATION DE LA COMMANDE (sans écrans)
            try:
                order = self.sudo().create(order_vals)
                _logger.info(
                    f"[KITCHEN] 🎉 Order created: {order.name} (ID: {order.id}) "
                    f"with {valid_lines_count} lines"
                )
            except Exception as create_error:
                _logger.error(f"[KITCHEN] ❌ Order creation failed: {create_error}")
                return None

            # ✅ RETOUR de la commande (l'assignation se fera dans create_or_update_kitchen_order)
            _logger.info(f"[KITCHEN] ✅ _create_kitchen_order completed for {order.name}")
            _logger.info(f"[KITCHEN] ==========================================")

            return order

        except Exception as e:
            _logger.error(
                f"[KITCHEN] ❌ CRITICAL ERROR in _create_kitchen_order: {str(e)}", 
                exc_info=True
            )
            return None


    
    def _update_kitchen_order(self, order, order_data):
        """
        ✅ SIMPLIFIÉE : Met à jour UNIQUEMENT les lignes, SANS réassignation d'écrans
        La réassignation sera faite par create_or_update_kitchen_order
        """
        try:
            _logger.info(f"[KITCHEN] 🔄 ==========================================")
            _logger.info(f"[KITCHEN] 🔄 START _update_kitchen_order for {order.name}")
            
            if not order or not order.exists():
                _logger.error(f"[KITCHEN] ❌ Invalid order for update")
                return False

            current_cooking_lines = order.lines.filtered(lambda l: l.is_cooking)
            current_line_count = len(current_cooking_lines)
            
            _logger.info(
                f"[KITCHEN] 📊 BEFORE UPDATE - Order {order.name}: "
                f"{current_line_count} cooking lines"
            )

            lines_data = order_data.get('lines', [])
            if not lines_data:
                _logger.warning(f"[KITCHEN] ⚠ No lines data for update")
                return False

            # ✅ Suppression des anciennes lignes de cuisine
            try:
                if current_cooking_lines:
                    removed_line_ids = current_cooking_lines.ids
                    current_cooking_lines.sudo().unlink()
                    _logger.info(f"[KITCHEN] 🗑️ Removed {len(removed_line_ids)} cooking lines")
            except Exception as delete_error:
                _logger.error(f"[KITCHEN] ❌ Error removing old lines: {delete_error}")
                return False

            # ✅ Création des nouvelles lignes
            new_lines = []
            valid_lines_count = 0
            
            for line_index, line_data in enumerate(lines_data):
                try:
                    if isinstance(line_data, (list, tuple)) and len(line_data) >= 3:
                        line_vals = line_data[2]
                        
                        product_id = line_vals.get('product_id')
                        if not product_id:
                            continue

                        product = self.env['product.product'].browse(product_id)
                        if not product.exists():
                            continue

                        line_creation_vals = {
                            'product_id': product_id,
                            'qty': float(line_vals.get('qty', 1)),
                            'price_unit': float(line_vals.get('price_unit', 0)),
                            'price_subtotal': float(line_vals.get('price_subtotal', 0)),
                            'price_subtotal_incl': float(line_vals.get('price_subtotal_incl', 0)),
                            'discount': float(line_vals.get('discount', 0)),
                            'is_cooking': True,
                            'name': line_vals.get('full_product_name') or product.display_name,
                            'full_product_name': line_vals.get('full_product_name') or product.display_name,
                            'note': line_vals.get('note', ''),
                            'price_extra': float(line_vals.get('price_extra', 0)),
                        }

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

                except Exception as line_error:
                    _logger.error(f"[KITCHEN] ❌ Error processing update line {line_index}: {line_error}")
                    continue

            if valid_lines_count == 0:
                _logger.error(f"[KITCHEN] ❌ No valid lines to update")
                return False

            # ✅ Mise à jour de la commande
            try:
                update_vals = {
                    'lines': new_lines,
                    'is_cooking': True,
                    'order_status': 'draft',
                    'amount_total': order_data.get('amount_total', order.amount_total),
                    'amount_paid': order_data.get('amount_paid', order.amount_paid),
                    'amount_return': order_data.get('amount_return', order.amount_return),
                    'amount_tax': order_data.get('amount_tax', order.amount_tax),
                    # ✅ PAS de réassignation d'écrans ici !
                }
                
                order.sudo().write(update_vals)
                _logger.info(
                    f"[KITCHEN] ✅ Order updated with {valid_lines_count} new lines "
                    f"(was {current_line_count})"
                )
                
            except Exception as update_error:
                _logger.error(f"[KITCHEN] ❌ Order update failed: {update_error}")
                return False

            # ✅ RETOUR (la réassignation se fera dans create_or_update_kitchen_order)
            _logger.info(f"[KITCHEN] ✅ _update_kitchen_order completed for {order.name}")
            _logger.info(f"[KITCHEN] ==========================================")

            return True

        except Exception as e:
            _logger.error(
                f"[KITCHEN] ❌ CRITICAL ERROR in _update_kitchen_order: {str(e)}", 
                exc_info=True
            )
            return False



    @api.model
    def create_or_update_kitchen_order(self, orders_data):
            """
            ✅ CORRIGÉE : Assignation unique et fiable avec commits explicites
            """
            _logger.info(f"[KITCHEN] 📥 ==========================================")
            _logger.info(f"[KITCHEN] 📥 create_or_update_kitchen_order called with {len(orders_data)} orders")
            
            try:
                results = []
                
                for order_data in orders_data:
                    order = None
                    try:
                        pos_reference = order_data.get('pos_reference')
                        config_id = order_data.get('config_id')
                        target_screen_ids = order_data.get('target_screen_ids', [])
                        
                        if not pos_reference or not config_id:
                            _logger.error(f"[KITCHEN] ❌ Missing critical data in order")
                            continue

                        _logger.info(f"[KITCHEN] 🔍 Processing order {pos_reference}")
                        _logger.info(f"[KITCHEN] 🎯 Target screens: {target_screen_ids}")
                        
                        # ✅ ÉTAPE 1 : Recherche
                        order = self.sudo().search([
                            ('pos_reference', '=', pos_reference),
                            ('config_id', '=', config_id)
                        ], limit=1)
                        
                        # ✅ ÉTAPE 2 : Créer OU Mettre à jour
                        if order:
                            _logger.info(f"[KITCHEN] 📋 Updating existing order: {order.name}")
                            success = self._update_kitchen_order(order, order_data)
                            if not success:
                                _logger.error(f"[KITCHEN] ❌ Update failed for {order.name}")
                                continue
                        else:
                            _logger.info(f"[KITCHEN] 🆕 Creating new kitchen order")
                            order = self._create_kitchen_order(order_data)
                            if not order or not order.exists():
                                _logger.error(f"[KITCHEN] ❌ Creation failed")
                                continue
                        
                        # ✅ ÉTAPE 3 : COMMIT INTERMÉDIAIRE pour sécuriser la commande
                        _logger.info(f"[KITCHEN] 💾 Committing order to database...")
                        self.env.cr.commit()
                        
                        # ✅ ÉTAPE 4 : Nettoyer les anciennes assignations
                        if order.screen_ids:
                            old_screens = order.screen_ids.ids
                            _logger.info(f"[KITCHEN] 🗑️ Clearing old screens: {old_screens}")
                            order.sudo().write({'screen_ids': [(5, 0, 0)]})
                            self.env.cr.commit()
                        
                        # ✅ ÉTAPE 5 : Assigner les écrans
                        _logger.info(f"[KITCHEN] 🎯 Screen assignment for {order.name}")
                        
                        assignment_success = order.sudo()._process_screen_assignment(
                            target_screen_ids=target_screen_ids
                        )
                        
                        if not assignment_success:
                            _logger.error(f"[KITCHEN] ❌ Screen assignment FAILED for {order.name}")
                            continue
                        
                        # ✅ ÉTAPE 6 : COMMIT FINAL
                        _logger.info(f"[KITCHEN] 💾 Final commit...")
                        self.env.cr.commit()
                        
                        # ✅ ÉTAPE 7 : Validation
                        order.invalidate_cache()
                        self.env.invalidate_all()
                        
                        # ✅ Re-charger la commande pour vérifier
                        order = self.sudo().browse(order.id)
                        assigned_screen_ids = order.screen_ids.ids
                        assigned_screen_names = order.screen_ids.mapped('name')
                        
                        _logger.info(
                            f"[KITCHEN] ✅ Order {order.name} FINAL STATE: "
                            f"{len(assigned_screen_ids)} screens: {assigned_screen_names} "
                            f"(IDs: {assigned_screen_ids})"
                        )
                        
                        if not assigned_screen_ids:
                            _logger.error(f"[KITCHEN] ❌ NO SCREENS ASSIGNED after commit!")
                            continue
                        
                        # ✅ ÉTAPE 8 : Notifications
                        if assigned_screen_ids:
                            _logger.info(f"[KITCHEN] 🔔 Sending notifications...")
                            
                            for screen_id in assigned_screen_ids:
                                try:
                                    screen = self.env['kitchen.screen'].sudo().browse(screen_id)
                                    if screen.exists():
                                        self._send_new_order_notification(screen, order)
                                        _logger.info(
                                            f"[KITCHEN] ✅ Notification sent to '{screen.name}'"
                                        )
                                except Exception as notif_error:
                                    _logger.error(
                                        f"[KITCHEN] ❌ Notification error for screen {screen_id}: "
                                        f"{notif_error}"
                                    )
                        
                        results.append(order.id)
                        
                        _logger.info(f"[KITCHEN] ✅ Order {order.name} COMPLETE")
                        _logger.info(f"[KITCHEN] ==========================================\n")
                        
                    except Exception as order_error:
                        _logger.error(
                            f"[KITCHEN] ❌ Error processing order: {order_error}", 
                            exc_info=True
                        )
                        self.env.cr.rollback()
                        continue
                
                _logger.info(
                    f"[KITCHEN] ✅ Processing completed: {len(results)} orders"
                )
                
                return results
                
            except Exception as e:
                _logger.error(
                    f"[KITCHEN] ❌ CRITICAL ERROR: {str(e)}", 
                    exc_info=True
                )
                self.env.cr.rollback()
                return False
    



    @api.model
    def get_details(self, shop_id, screen_id=None, *args, **kwargs):
        """
        ✅ REFONTE COMPLÈTE : Logique claire et robuste
        Retourne TOUTES les commandes où cet écran est assigné,
        avec UNIQUEMENT les lignes visibles pour cet écran
        """
        try:
            _logger.info(f"[KITCHEN] 🔍 ==========================================")
            _logger.info(f"[KITCHEN] 🔍 GET_DETAILS called")
            _logger.info(f"[KITCHEN] 🔍 shop_id={shop_id}, screen_id={screen_id}")
            
            # ✅ Forcer le refresh du cache
            self.env.invalidate_all()
            
            # ✅ ÉTAPE 1 : Récupérer l'écran
            if not screen_id:
                _logger.warning(f"[KITCHEN] ⚠ No screen_id provided")
                return {
                    "orders": [],
                    "order_lines": [],
                    "screen_id": None,
                    "screen_name": None,
                    "screen_categories": []
                }
            
            kitchen_screen = self.env["kitchen.screen"].sudo().browse(screen_id)
            if not kitchen_screen.exists():
                _logger.error(f"[KITCHEN] ❌ Screen {screen_id} not found")
                return {
                    "orders": [],
                    "order_lines": [],
                    "screen_id": screen_id,
                    "screen_name": "Not Found",
                    "screen_categories": []
                }

            screen_categ_ids = kitchen_screen.pos_categ_ids.ids
            screen_name = kitchen_screen.display_name_custom or kitchen_screen.name
            
            _logger.info(
                f"[KITCHEN] 📺 Screen: '{screen_name}' (ID: {screen_id}), "
                f"Categories: {screen_categ_ids}"
            )

            if not screen_categ_ids:
                _logger.warning(f"[KITCHEN] ⚠ Screen has NO categories configured")
                return {
                    "orders": [],
                    "order_lines": [],
                    "screen_id": screen_id,
                    "screen_name": screen_name,
                    "screen_categories": []
                }

            # ✅ ÉTAPE 2 : Rechercher TOUTES les commandes cuisine actives
            all_cooking_orders = self.env["pos.order"].sudo().search([
                ("is_cooking", "=", True),
                ("config_id", "=", shop_id),
                ("state", "not in", ["cancel", "paid"]),
                ("order_status", "!=", "cancel"),
            ])

            _logger.info(f"[KITCHEN] 📦 Found {len(all_cooking_orders)} total cooking orders")

            # ✅ ÉTAPE 3 : Filtrer les commandes pour CET écran
            orders_for_this_screen = []
            all_visible_lines = self.env['pos.order.line']
            
            for order in all_cooking_orders:
                try:
                    # Vérifier si cet écran est assigné à la commande
                    current_screen_ids = order.screen_ids.ids
                    is_screen_assigned = screen_id in current_screen_ids
                    
                    _logger.info(
                        f"[KITCHEN] 🔍 Order {order.name}: "
                        f"screen_ids={current_screen_ids}, "
                        f"is_assigned={is_screen_assigned}"
                    )
                    
                    if is_screen_assigned:
                        # ✅ Récupérer les lignes visibles pour cet écran
                        visible_lines = self._get_visible_lines_for_screen(order, kitchen_screen)
                        
                        if visible_lines:
                            # ✅ CAS NORMAL : Écran assigné ET lignes visibles
                            orders_for_this_screen.append(order)
                            all_visible_lines |= visible_lines
                            _logger.info(
                                f"[KITCHEN] ✅ Order {order.name} INCLUDED: "
                                f"{len(visible_lines)} visible lines"
                            )
                        else:
                            # ⚠️ CAS ANORMAL : Écran assigné MAIS aucune ligne visible
                            _logger.warning(
                                f"[KITCHEN] ⚠️ Order {order.name} assigned to screen BUT "
                                f"has NO visible lines! This should not happen."
                            )
                            # ✅ CORRECTION AUTO : Retirer cet écran de la commande
                            _logger.info(f"[KITCHEN] 🔧 Auto-removing screen from order {order.name}")
                            try:
                                order.sudo().with_context(skip_status_notification=True).write({
                                    'screen_ids': [(3, screen_id)]  # Unlink
                                })
                                self.env.cr.commit()
                                _logger.info(f"[KITCHEN] ✅ Screen removed from order {order.name}")
                            except Exception as unlink_error:
                                _logger.error(f"[KITCHEN] ❌ Failed to unlink screen: {unlink_error}")
                    else:
                        # Écran NON assigné : vérifier s'il devrait l'être
                        should_be_assigned = self._should_order_be_on_screen(order, kitchen_screen)
                        
                        if should_be_assigned:
                            _logger.info(
                                f"[KITCHEN] 🔧 Order {order.name} SHOULD be assigned - "
                                f"auto-assigning..."
                            )
                            try:
                                # Assigner l'écran
                                order.sudo().with_context(skip_status_notification=True).write({
                                    'screen_ids': [(4, screen_id)]  # Link
                                })
                                self.env.cr.commit()
                                
                                # Récupérer les lignes visibles
                                visible_lines = self._get_visible_lines_for_screen(order, kitchen_screen)
                                
                                if visible_lines:
                                    orders_for_this_screen.append(order)
                                    all_visible_lines |= visible_lines
                                    _logger.info(
                                        f"[KITCHEN] ✅ Order {order.name} auto-assigned and INCLUDED: "
                                        f"{len(visible_lines)} visible lines"
                                    )
                                else:
                                    _logger.warning(
                                        f"[KITCHEN] ⚠️ Order {order.name} auto-assigned but "
                                        f"NO visible lines found!"
                                    )
                            except Exception as assign_error:
                                _logger.error(
                                    f"[KITCHEN] ❌ Auto-assignment failed for {order.name}: "
                                    f"{assign_error}"
                                )
                        else:
                            _logger.debug(
                                f"[KITCHEN] ⏭️ Order {order.name} NOT for this screen - skipped"
                            )
                
                except Exception as order_error:
                    _logger.error(
                        f"[KITCHEN] ❌ Error processing order {order.id}: {order_error}",
                        exc_info=True
                    )
                    continue

            _logger.info(
                f"[KITCHEN] ✅ FINAL RESULT: {len(orders_for_this_screen)} orders, "
                f"{len(all_visible_lines)} lines for screen '{screen_name}'"
            )
            _logger.info(f"[KITCHEN] ==========================================")

            # ✅ ÉTAPE 4 : Préparer les données pour le frontend
            orders_data = []
            for order in orders_for_this_screen:
                order_dict = order.read([])[0]
                
                # Conversion de l'heure
                user_tz_str = self.env.user.tz or 'UTC'
                user_tz = pytz.timezone(user_tz_str)
                utc = pytz.utc
                
                date_str = order_dict.get('date_order')
                try:
                    if isinstance(date_str, str):
                        utc_dt = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
                        utc_dt = utc.localize(utc_dt)
                    else:
                        utc_dt = utc.localize(order_dict['date_order'])

                    local_dt = utc_dt.astimezone(user_tz)
                    order_dict['hour'] = local_dt.hour
                    order_dict['formatted_minutes'] = f"{local_dt.minute:02d}"
                    order_dict['minutes'] = local_dt.minute
                except Exception as time_error:
                    _logger.warning(f"[KITCHEN] Time conversion error: {time_error}")
                    order_dict['hour'] = 0
                    order_dict['minutes'] = 0
                    order_dict['formatted_minutes'] = "00"
                
                # Ajouter le nom du floor si table
                if order_dict.get('table_id'):
                    order_dict['floor'] = order_dict['table_id'][1].split(',')[0].strip()
                
                orders_data.append(order_dict)

            lines_data = all_visible_lines.read([])

            return {
                "orders": orders_data,
                "order_lines": lines_data,
                "screen_id": screen_id,
                "screen_name": screen_name,
                "screen_categories": screen_categ_ids
            }

        except Exception as e:
            _logger.error(
                f"[KITCHEN] ❌ CRITICAL ERROR in get_details: {str(e)}", 
                exc_info=True
            )
            return {
                "orders": [],
                "order_lines": [],
                "screen_id": screen_id if screen_id else None,
                "screen_name": "Error",
                "screen_categories": []
            }

    
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
        ✅ CORRIGÉE : Envoyer TOUJOURS, même sans lignes visibles
        Le frontend filtrera lors du loadOrders
        """
        try:
            if not screen.exists() or not order.exists():
                _logger.warning("[KITCHEN] Invalid screen or order for new order notification")
                return

            channel = f"kitchen.screen.{screen.id}"
            screen_categ_ids = screen.pos_categ_ids.ids
            screen_name = screen.display_name_custom or screen.name or f"Screen {screen.id}"

            # ✅ Récupérer les lignes visibles (pour info seulement)
            visible_lines = order.lines.filtered(
                lambda line: (
                    line.is_cooking and 
                    line.product_id and 
                    (set(line.product_id.pos_categ_ids.ids) & set(screen_categ_ids))
                )
            )

            # ✅ CHANGEMENT CRITIQUE: Envoyer MÊME si visible_lines est vide
            # Le frontend fera le filtrage lors du loadOrders()
            _logger.info(
                f"[KITCHEN] 🔔 Sending notification to '{screen_name}' "
                f"({len(visible_lines)} visible lines)"
            )

            # ✅ Message de notification
            message = {
                "type": "new_order",
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

            # ✅ ENVOI sur le bus
            self.env["bus.bus"]._sendone(channel, "new_order", message)

            _logger.info(
                f"[KITCHEN] ✅ Notification sent to '{screen_name}' (channel: {channel})"
            )

        except Exception as e:
            _logger.error(
                f"[KITCHEN] ❌ Error sending new order notification: {str(e)}", 
                exc_info=True
            )


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


    @api.model
    def test_kitchen_notification(self, screen_id, test_message=None):
        """
        ✅ MÉTHODE DE TEST: Envoie une notification de test
        Utiliser depuis le backend pour tester les notifications
        """
        try:
            screen = self.env['kitchen.screen'].sudo().browse(screen_id)
            if not screen.exists():
                return {'success': False, 'error': 'Screen not found'}
            
            channel = f"kitchen.screen.{screen_id}"
            
            message = test_message or {
                "type": "new_order",
                "screen_id": screen_id,
                "screen_name": screen.name,
                "order_reference": "TEST-001",
                "order_name": "Test Order",
                "timestamp": fields.Datetime.now().isoformat(),
                "lines_count": 1,
                "test": True
            }
            
            self.env["bus.bus"]._sendone(channel, "new_order", message)
            
            _logger.info(f"[KITCHEN TEST] ✅ Test notification sent to screen {screen_id}")
            
            return {'success': True, 'channel': channel, 'message': message}
            
        except Exception as e:
            _logger.error(f"[KITCHEN TEST] ❌ Error: {str(e)}", exc_info=True)
            return {'success': False, 'error': str(e)}


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