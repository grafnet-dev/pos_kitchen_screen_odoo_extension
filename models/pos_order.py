# -*- coding: utf-8 -*-
from odoo import api, fields, models
import logging

_logger = logging.getLogger(__name__)


class PosOrder(models.Model):
    """Extension de pos.order pour gérer les notifications par catégorie"""
    _inherit = 'pos.order'

    @api.model_create_multi
    def create(self, vals_list):
        """Override create pour envoyer des notifications aux écrans concernés"""
        orders = super(PosOrder, self).create(vals_list)
        
        for order in orders:
            if order.is_cooking:
                self._notify_kitchen_screens(order, 'new_order')
        
        return orders

    def write(self, vals):
        """Override write pour notifier les changements de statut"""
        res = super(PosOrder, self).write(vals)
        
        if 'order_status' in vals:
            for order in self:
                if order.is_cooking:
                    self._notify_kitchen_screens(order, 'order_status_change')
        
        return res

    def _notify_kitchen_screens(self, order, notification_type):
        """
        Envoie une notification à tous les écrans concernés par cette commande
        Basé sur les catégories de produits
        """
        # Récupérer toutes les catégories des produits de la commande
        product_categories = order.lines.mapped('product_id.categ_id')
        
        if not product_categories:
            _logger.warning(f"[KITCHEN] Order {order.name} has no product categories")
            return

        # Trouver tous les écrans qui affichent ces catégories
        screens = self.env['kitchen.screen'].search([
            ('pos_categ_ids', 'in', product_categories.ids),
            ('active', '=', True)
        ])

        # Si pos_config_id est défini sur l'écran, filtrer
        screens = screens.filtered(
            lambda s: not s.pos_config_id or s.pos_config_id.id == order.config_id.id
        )

        _logger.info(
            f"[KITCHEN] Order {order.name} -> {len(screens)} screens: "
            f"{screens.mapped('name')}"
        )

        # Envoyer une notification à chaque écran concerné
        for screen in screens:
            self._send_screen_notification(screen, order, notification_type)

    def _send_screen_notification(self, screen, order, notification_type):
        """Envoie une notification à un écran spécifique via le bus"""
        channel = f"kitchen.screen.{screen.id}"
        
        message = {
            "type": notification_type,
            "screen_id": screen.id,
            "order_id": order.id,
            "order_name": order.name,
            "order_ref": order.order_ref or order.name,
            "order_status": order.order_status,
            "table_name": order.table_id.name if order.table_id else None,
            "config_id": order.config_id.id,
            "config_name": order.config_id.name,
            "timestamp": fields.Datetime.now().isoformat(),
            "lines": [{
                'id': line.id,
                'product_name': line.product_id.display_name,
                'qty': line.qty,
                'note': line.note or '',
            } for line in order.lines]
        }

        # Envoyer via le bus
        self.env["bus.bus"]._sendone(channel, notification_type, message)
        
        _logger.info(
            f"[KITCHEN] Notification sent to {screen.name}: "
            f"{notification_type} for order {order.name}"
        )


class PosOrderLine(models.Model):
    """Extension de pos.order.line pour gérer les notifications de lignes"""
    _inherit = 'pos.order.line'

    def write(self, vals):
        """Notifier les écrans lors de modification de lignes"""
        res = super(PosOrderLine, self).write(vals)
        
        if 'order_status' in vals:
            for line in self:
                if line.order_id.is_cooking:
                    self._notify_line_change(line)
        
        return res

    def _notify_line_change(self, line):
        """Notifie les écrans concernés d'un changement de ligne"""
        product_category = line.product_id.categ_id
        
        if not product_category:
            return

        screens = self.env['kitchen.screen'].search([
            ('pos_categ_ids', 'in', product_category.ids),
            ('active', '=', True)
        ])

        for screen in screens:
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