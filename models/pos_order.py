# -*- coding: utf-8 -*-
from odoo import api, fields, models
import logging
import pytz
from datetime import datetime

_logger = logging.getLogger(__name__)


class PosOrder(models.Model):
    _inherit = 'pos.order'
    
    @api.model_create_multi
    def create(self, vals_list):
        """Routage multi-écrans de cuisine selon les catégories"""
        # On garde le comportement d'origine
        res = super().create(vals_list)

        # Liste des ordres à notifier
        orders_to_notify = []

        for order in res:
            # On récupère tous les écrans liés à ce POS
            kitchen_screens = self.env["kitchen.screen"].search([
                ("pos_config_id", "=", order.config_id.id)
            ])

            if not kitchen_screens:
                continue

            # Drapeau pour savoir si cet ordre a des produits de cuisine
            has_kitchen_items = False

            # On parcourt les lignes du ticket
            for line in order.lines:
                # On récupère les catégories du produit
                product_categs = line.product_id.pos_categ_ids.ids

                # On vérifie pour chaque écran de cuisine
                for screen in kitchen_screens:
                    # Si le produit appartient à cet écran
                    if any(categ.id in product_categs for categ in screen.pos_categ_ids):
                        line.is_cooking = True
                        has_kitchen_items = True

                        # ✅ Notification spécifique à cet écran
                        message = {
                            'res_model': self._name,
                            'message': 'pos_order_created',
                            'order_id': order.id,
                            'config_id': order.config_id.id,
                            'screen_id': screen.id,
                            'screen_name': screen.name,
                            'order_ref': order.name,
                        }
                        channel = f'pos_order_created_{order.config_id.id}'
                        self.env["bus.bus"]._sendone(channel, "notification", message)

            # Si au moins une ligne est “cooking”, on marque la commande
            if has_kitchen_items:
                order.is_cooking = True
                order.order_ref = order.name
                if order.order_status != 'draft':
                    order.order_status = 'draft'
                orders_to_notify.append(order)

        self.env.cr.commit()
        return res
    
    @api.model
    def get_details(self, shop_id, screen_id=None, *args, **kwargs):
        """Renvoie uniquement les lignes correspondant à l'écran donné."""
        # Etzpe 1 : on récupère l'écran spécifique s'il est passé
        if screen_id:
            kitchen_screen = self.env["kitchen.screen"].sudo().browse(screen_id)
        else:
            kitchen_screen = self.env["kitchen.screen"].sudo().search(
                [("pos_config_id", "=", shop_id)]
            )

        if not kitchen_screen:
            return {"orders": [], "order_lines": []}

        # etape 2 : on récupère toutes les commandes concernées
        pos_orders = self.env["pos.order"].search([
            ("is_cooking", "=", True),
            ("config_id", "=", shop_id),
            ("state", "not in", ["cancel", "paid"]),
            ("order_status", "!=", "cancel"),
            "|", "|",
            ("order_status", "=", "draft"),
            ("order_status", "=", "waiting"),
            ("order_status", "=", "ready")
        ], order="date_order")

        pos_orders = pos_orders.filtered(lambda o: not (
            o.state == "paid" and o.order_status == "ready"))

        # étape 3 : on filtre les lignes selon les catégories de cet écran
        pos_lines = pos_orders.lines.filtered(
            lambda line: line.is_cooking and any(
                categ.id in kitchen_screen.pos_categ_ids.ids
                for categ in line.product_id.pos_categ_ids
            )
        )

        # Étape 4 : préparation du résultat
        values = {"orders": pos_orders.read(), "order_lines": pos_lines.read()}

        # Étape 5 : conversion d’heure (inchangée)
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
            except Exception:
                value['hour'] = 0
                value['minutes'] = 0
                value['formatted_minutes'] = "00"

        return values

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