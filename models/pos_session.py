# -*- coding: utf-8 -*-
from odoo import models, api
import logging

_logger = logging.getLogger(__name__)


class PosSession(models.Model):
    """Extension de la session POS pour supporter les écrans multiples"""
    _inherit = 'pos.session'

    def _pos_ui_models_to_load(self):
        """
        ✅ Ajoute kitchen.screen aux modèles à charger dans le POS
        Nécessaire pour que le frontend connaisse tous les écrans disponibles
        """
        result = super()._pos_ui_models_to_load()
        result.add('kitchen.screen')
        _logger.info("[POS SESSION] Added kitchen.screen to models to load")
        return result

    def _loader_params_kitchen_screen(self):
        """
        ✅ NOUVEAU: Paramètres de chargement pour kitchen.screen
        Charge uniquement les écrans actifs du POS courant
        """
        return {
            'search_params': {
                'domain': [
                    ('pos_config_id', '=', self.config_id.id),
                    ('active', '=', True)
                ],
                'fields': [
                    'id',
                    'name',
                    'sequence',
                    'screen_code',
                    'pos_config_id',
                    'pos_categ_ids',
                    'display_order',
                    'description',
                    'display_name_custom',
                    'is_preparation_complete',
                    'active'
                ],
                'order': 'display_order, name'
            }
        }

    def _get_pos_ui_kitchen_screen(self, params):
        """
        ✅ NOUVEAU: Récupère les données kitchen.screen pour le POS UI
        """
        screens = self.env['kitchen.screen'].search_read(**params['search_params'])
        
        _logger.info(
            f"[POS SESSION] Loaded {len(screens)} kitchen screens for POS '{self.config_id.name}'"
        )
        
        # Log détaillé des écrans chargés
        for screen in screens:
            _logger.debug(
                f"[POS SESSION] Screen: {screen.get('name')} "
                f"(ID: {screen.get('id')}, Categories: {screen.get('pos_categ_ids')})"
            )
        
        return screens

    def _loader_params_pos_order(self):
        """
        ✅ EXTENSION: Ajoute screen_ids aux champs à charger
        """
        result = super()._loader_params_pos_order()
        
        # Ajouter screen_ids pour le multi-screen
        if 'fields' in result['search_params']:
            if 'screen_ids' not in result['search_params']['fields']:
                result['search_params']['fields'].append('screen_ids')
        
        _logger.debug("[POS SESSION] Extended pos.order fields with screen_ids")
        
        return result

    def _loader_params_pos_order_line(self):
        """
        ✅ EXTENSION: Ajoute les champs nécessaires pour le filtrage multi-écrans
        """
        result = super()._loader_params_pos_order_line()
        
        # Ajouter des champs supplémentaires si nécessaire
        additional_fields = ['is_cooking', 'note']
        
        if 'fields' in result['search_params']:
            for field in additional_fields:
                if field not in result['search_params']['fields']:
                    result['search_params']['fields'].append(field)
        
        _logger.debug(
            f"[POS SESSION] Extended pos.order.line fields with {additional_fields}"
        )
        
        return result

    @api.model
    def get_active_screens_for_pos(self, pos_config_id):
        """
        ✅ NOUVEAU: Méthode utilitaire pour récupérer les écrans actifs
        Peut être appelée depuis le frontend
        """
        try:
            screens = self.env['kitchen.screen'].search([
                ('pos_config_id', '=', pos_config_id),
                ('active', '=', True)
            ], order='display_order, name')
            
            result = screens.read([
                'id',
                'name',
                'sequence',
                'screen_code',
                'pos_categ_ids',
                'display_order',
                'description',
                'display_name_custom'
            ])
            
            _logger.info(
                f"[POS SESSION] get_active_screens_for_pos: "
                f"Found {len(result)} screens for POS {pos_config_id}"
            )
            
            return result
            
        except Exception as e:
            _logger.error(
                f"[POS SESSION] Error in get_active_screens_for_pos: {str(e)}",
                exc_info=True
            )
            return []

    @api.model
    def validate_screen_categories(self, pos_config_id):
        """
        ✅ NOUVEAU: Valide que toutes les catégories POS ont un écran assigné
        Utile pour vérifier la configuration avant l'ouverture de session
        """
        try:
            # Récupérer toutes les catégories POS utilisées
            pos_categories = self.env['pos.category'].search([])
            
            # Récupérer les écrans actifs
            screens = self.env['kitchen.screen'].search([
                ('pos_config_id', '=', pos_config_id),
                ('active', '=', True)
            ])
            
            if not screens:
                _logger.warning(
                    f"[POS SESSION] No active kitchen screens found for POS {pos_config_id}"
                )
                return {
                    'valid': False,
                    'message': 'No active kitchen screens configured',
                    'missing_categories': [],
                    'total_screens': 0
                }
            
            # Récupérer toutes les catégories assignées aux écrans
            assigned_categories = set()
            for screen in screens:
                assigned_categories.update(screen.pos_categ_ids.ids)
            
            # Vérifier les catégories manquantes
            all_category_ids = set(pos_categories.ids)
            missing_category_ids = all_category_ids - assigned_categories
            
            if missing_category_ids:
                missing_categories = self.env['pos.category'].browse(
                    list(missing_category_ids)
                )
                missing_names = missing_categories.mapped('name')
                
                _logger.warning(
                    f"[POS SESSION] Categories without screen assignment: {missing_names}"
                )
                
                return {
                    'valid': False,
                    'message': f'{len(missing_names)} categories without screen assignment',
                    'missing_categories': missing_names,
                    'total_screens': len(screens)
                }
            
            _logger.info(
                f"[POS SESSION] ✅ All categories covered by {len(screens)} screens"
            )
            
            return {
                'valid': True,
                'message': 'All categories have screen assignments',
                'missing_categories': [],
                'total_screens': len(screens)
            }
            
        except Exception as e:
            _logger.error(
                f"[POS SESSION] Error in validate_screen_categories: {str(e)}",
                exc_info=True
            )
            return {
                'valid': False,
                'message': f'Validation error: {str(e)}',
                'missing_categories': [],
                'total_screens': 0
            }

    def action_pos_session_open(self):
        """
        ✅ EXTENSION: Validation automatique lors de l'ouverture de session
        """
        result = super().action_pos_session_open()
        
        try:
            # Valider la configuration des écrans
            validation = self.validate_screen_categories(self.config_id.id)
            
            if not validation['valid']:
                _logger.warning(
                    f"[POS SESSION] Session opened with configuration warnings: "
                    f"{validation['message']}"
                )
                
                # Option: Afficher un avertissement (mais ne pas bloquer)
                # Vous pouvez décommenter pour bloquer l'ouverture:
                # from odoo.exceptions import UserError
                # raise UserError(
                #     f"Kitchen Screen Configuration Warning:\n{validation['message']}\n"
                #     f"Missing categories: {', '.join(validation['missing_categories'])}"
                # )
            else:
                _logger.info(
                    f"[POS SESSION] ✅ Session opened with valid screen configuration: "
                    f"{validation['total_screens']} active screens"
                )
                
        except Exception as e:
            _logger.error(
                f"[POS SESSION] Error during session opening validation: {str(e)}",
                exc_info=True
            )
        
        return result

    def action_pos_session_closing_control(self):
        """
        ✅ EXTENSION: Vérifications lors de la fermeture de session
        """
        result = super().action_pos_session_closing_control()
        
        try:
            # Vérifier s'il reste des commandes en cuisine
            pending_orders = self.env['pos.order'].search([
                ('config_id', '=', self.config_id.id),
                ('is_cooking', '=', True),
                ('order_status', 'in', ['draft', 'waiting']),
                ('state', '!=', 'cancel')
            ])
            
            if pending_orders:
                pending_count = len(pending_orders)
                pending_refs = pending_orders.mapped('name')
                
                _logger.warning(
                    f"[POS SESSION] ⚠ Closing session with {pending_count} "
                    f"pending kitchen orders: {pending_refs[:5]}"  # Log first 5
                )
                
                # Option: Afficher un avertissement
                # Vous pouvez décommenter pour afficher une notification:
                # self.env['bus.bus']._sendone(
                #     f"pos.session.{self.id}",
                #     "kitchen_warning",
                #     {
                #         'message': f'{pending_count} orders still in kitchen',
                #         'order_refs': pending_refs
                #     }
                # )
            else:
                _logger.info(
                    "[POS SESSION] ✅ No pending kitchen orders at session closing"
                )
                
        except Exception as e:
            _logger.error(
                f"[POS SESSION] Error during closing control: {str(e)}",
                exc_info=True
            )
        
        return result

    @api.model
    def get_kitchen_statistics(self, pos_config_id):
        """
        ✅ NOUVEAU: Statistiques cuisine en temps réel
        Peut être appelé depuis le backend ou le frontend
        """
        try:
            screens = self.env['kitchen.screen'].search([
                ('pos_config_id', '=', pos_config_id),
                ('active', '=', True)
            ])
            
            statistics = {
                'pos_config_id': pos_config_id,
                'total_screens': len(screens),
                'screens': [],
                'total_orders': 0,
                'draft_orders': 0,
                'waiting_orders': 0,
                'ready_orders': 0
            }
            
            for screen in screens:
                screen_stats = self.env['kitchen.screen'].get_screen_statistics(screen.id)
                statistics['screens'].append(screen_stats)
                
                statistics['total_orders'] += screen_stats.get('total_orders', 0)
                statistics['draft_orders'] += screen_stats.get('cooking_orders', 0)
                statistics['waiting_orders'] += screen_stats.get('ready_orders', 0)
            
            return statistics
            
        except Exception as e:
            _logger.error(
                f"[POS SESSION] Error in get_kitchen_statistics: {str(e)}",
                exc_info=True
            )
            return {
                'pos_config_id': pos_config_id,
                'error': str(e)
            }