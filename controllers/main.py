# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request
import logging

_logger = logging.getLogger(__name__)


class KitchenScreenController(http.Controller):
    """Contrôleur pour gérer l'affichage des écrans de cuisine"""

    @http.route('/pos/kitchen', type='http', auth='user', website=True)
    def kitchen_screen(self, screen_id=None, **kwargs):
        """
        Route principale pour afficher l'écran de cuisine
        Remplace l'ancien système basé sur pos_config_id
        """
        if not screen_id:
            return request.render('pos_kitchen_screen_odoo_extension.error_no_screen', {
                'message': 'Aucun écran de cuisine spécifié'
            })

        try:
            screen_id = int(screen_id)
            screen = request.env['kitchen.screen'].browse(screen_id)
            
            if not screen.exists():
                return request.render('pos_kitchen_screen_odoo_extension.error_no_screen', {
                    'message': f'Écran de cuisine {screen_id} introuvable'
                })

            # Log pour débogage
            _logger.info(f"[KITCHEN] Opening screen: {screen.name} (ID: {screen.id})")
            _logger.info(f"[KITCHEN] Categories: {screen.pos_categ_ids.mapped('name')}")

            return request.render('pos_kitchen_screen_odoo_extension.kitchen_custom_dashboard_extension', {
                'screen_id': screen.id,
                'screen_name': screen.name,
                'screen_type': screen.screen_type,
                'categories': screen.pos_categ_ids.ids,
                'sound_enabled': screen.sound_enabled,
            })

        except Exception as e:
            _logger.error(f"[KITCHEN] Error loading screen: {str(e)}")
            return request.render('pos_kitchen_screen_odoo_extension.error_no_screen', {
                'message': f'Erreur lors du chargement: {str(e)}'
            })

    @http.route('/pos/kitchen/test', type='json', auth='user')
    def test_screen(self, screen_id):
        """Route de test pour vérifier le fonctionnement"""
        screen = request.env['kitchen.screen'].browse(screen_id)
        
        return {
            'success': True,
            'screen': {
                'id': screen.id,
                'name': screen.name,
                'categories': screen.pos_categ_ids.mapped('name'),
                'pos_config': screen.pos_config_id.name if screen.pos_config_id else 'Tous'
            }
        }