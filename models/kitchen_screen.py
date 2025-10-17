# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError
import logging

_logger = logging.getLogger(__name__)


class KitchenScreen(models.Model):
    _inherit = 'kitchen.screen'
    
    name = fields.Char(
        string='Nom de l\'écran',
        required=True,
        help='Exemple: Cuisine Principale, Bar, Pâtisserie'
    )

    screen_type = fields.Selection([
        ('kitchen', 'Cuisine'),
        ('bar', 'Bar'),
    ], string='Type d\'écran', default='kitchen', required=True)

    pos_categ_ids = fields.Many2many(
        string='Catégories POS',
        required=True,
        help='Les produits de ces catégories seront affichés sur cet écran. '
             'Vous pouvez sélectionner plusieurs catégories.'
    )

    pos_config_id = fields.Many2one(
        'pos.config',
        string='Configuration POS',
        help='Si vide, l\'écran recevra les commandes de tous les POS'
    )

    active = fields.Boolean(string='Actif', default=True)
    sound_enabled = fields.Boolean(string='Sons activés', default=True)
    sound_file = fields.Selection([
        ('pos_notification', 'Notification'),
        ('pos_ready', 'Commande prête'),
        ('pos_ding', 'Ding'),
        ('custom', 'Personnalisé')
    ], string='Fichier son', default='pos_notification')
    sound_volume = fields.Integer(string='Volume', default=50)
    custom_sound_url = fields.Char(string='URL son personnalisé')

    pending_orders_count = fields.Integer(
        string='Commandes en attente',
        compute='_compute_orders_count',
        store=False
    )
    ready_orders_count = fields.Integer(
        string='Commandes prêtes',
        compute='_compute_orders_count',
        store=False
    )
    total_orders_today = fields.Integer(
        string='Total commandes aujourd\'hui',
        compute='_compute_orders_count',
        store=False
    )

    @api.constrains('pos_categ_ids')
    def _check_pos_categ_ids(self):
        for screen in self:
            if not screen.pos_categ_ids:
                raise ValidationError(
                    _("Vous devez sélectionner au moins une catégorie POS pour l'écran '%s'.") % screen.name
                )

    @api.depends('pos_categ_ids')
    def _compute_orders_count(self):
        for screen in self:
            if not screen.pos_categ_ids:
                screen.pending_orders_count = 0
                screen.ready_orders_count = 0
                screen.total_orders_today = 0
                continue

            domain = [
                ('product_id.categ_id', 'in', screen.pos_categ_ids.ids),
                ('order_id.state', '!=', 'cancel')
            ]

            if screen.pos_config_id:
                domain.append(('order_id.config_id', '=', screen.pos_config_id.id))

            lines = self.env['pos.order.line'].search(domain)

            pending = lines.filtered(
                lambda l: l.order_id.order_status in ['draft', 'waiting']
            )
            ready = lines.filtered(
                lambda l: l.order_id.order_status == 'ready'
            )

            today_start = fields.Datetime.now().replace(hour=0, minute=0, second=0)
            today_lines = lines.filtered(
                lambda l: l.order_id.create_date >= today_start
            )

            screen.pending_orders_count = len(set(pending.mapped('order_id.id')))
            screen.ready_orders_count = len(set(ready.mapped('order_id.id')))
            screen.total_orders_today = len(set(today_lines.mapped('order_id.id')))

    def action_open_screen(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_url',
            'target': 'new',
            'url': f'/pos/kitchen?screen_id={self.id}',
        }

    def kitchen_screen(self):
        self.ensure_one()
        return self.action_open_screen()

    def get_orders_for_screen(self):
        """Retourne les commandes au bon format"""
        self.ensure_one()

        if not self.pos_categ_ids:
            _logger.warning(f"[KITCHEN] Screen {self.name} has no categories")
            return []

        domain = [
            ('product_id.categ_id', 'in', self.pos_categ_ids.ids),
            ('order_id.state', '!=', 'cancel'),
            ('order_id.is_cooking', '=', True)
        ]

        if self.pos_config_id:
            domain.append(('order_id.config_id', '=', self.pos_config_id.id))

        _logger.info(f"[KITCHEN] Search domain: {domain}")

        lines = self.env['pos.order.line'].search(domain)
        _logger.info(f"[KITCHEN] Found {len(lines)} order lines")

        orders = lines.mapped('order_id')

        result = []
        for order in orders:
            order_lines = lines.filtered(lambda l: l.order_id.id == order.id)

            result.append({
                'id': order.id,
                'name': order.name,
                'order_ref': order.order_ref or order.name,
                'order_status': order.order_status,
                'create_date': order.create_date.isoformat() if order.create_date else None,
                'table_name': order.table_id.name if order.table_id else None,
                'config_id': [order.config_id.id, order.config_id.name] if order.config_id else None,
                'avg_prepare_time': order.avg_prepare_time if hasattr(order, 'avg_prepare_time') else 0,
                'lines': [{
                    'id': line.id,
                    'product_id': [line.product_id.id, line.product_id.display_name],
                    'qty': line.qty,
                    'note': line.note or '',
                    'order_status': line.order_status if hasattr(line, 'order_status') else 'draft',
                    'category': line.product_id.categ_id.name if line.product_id.categ_id else 'Sans catégorie'
                } for line in order_lines]
            })

        _logger.info(f"[KITCHEN] Returning {len(result)} orders for screen {self.name}")
        return result

    def get_complete_kitchen_data(self):
        """
        ✅ MÉTHODE AJOUTÉE
        Retourne TOUTES les données nécessaires pour le template JS
        """
        self.ensure_one()

        if not self.pos_categ_ids:
            _logger.warning(f"[KITCHEN] Screen {self.name} has no categories")
            return {
                'orders': [],
                'lines': [],
                'prepare_times': []
            }

        orders = self.get_orders_for_screen()

        all_lines = []
        for order in orders:
            for line in order.get('lines', []):
                line_data = line.copy()
                
                product = self.env['product.product'].browse(line['product_id'][0])
                if product.categ_id:
                    line_data['product_categ_id'] = [
                        product.categ_id.id,
                        product.categ_id.name
                    ]
                else:
                    line_data['product_categ_id'] = None
                
                all_lines.append(line_data)

        prepare_times = []
        for order in orders:
            for line in order.get('lines', []):
                product = self.env['product.product'].browse(line['product_id'][0])
                if hasattr(product, 'preparation_time') and product.preparation_time:
                    prepare_times.append({
                        'product_id': product.id,
                        'product_name': product.display_name,
                        'time': product.preparation_time
                    })

        return {
            'orders': orders,
            'lines': all_lines,
            'prepare_times': prepare_times
        }

    def get_screen_config(self):
        """✅ CORRECTION: Retourne une LISTE"""
        self.ensure_one()

        return [{  # ✅ Liste au lieu de dict
            'id': self.id,
            'name': self.name,
            'sequence': self.sequence,
            'screen_type': self.screen_type,
            'sound_enabled': self.sound_enabled,
            'sound_file': self.sound_file,
            'sound_volume': self.sound_volume,
            'custom_sound_url': self.custom_sound_url or '',
            'pos_categ_ids': self.pos_categ_ids.ids,  # ✅ IDs des catégories
            'categories': [{
                'id': cat.id,
                'name': cat.name
            } for cat in self.pos_categ_ids],
            'pos_config_id': self.pos_config_id.id if self.pos_config_id else None,
            'pos_config_name': self.pos_config_id.name if self.pos_config_id else 'Tous les POS',
            'is_preparation_complete': self.is_preparation_complete,
        }]

    def action_test_notification(self):
        self.ensure_one()

        message = {
            "type": "test",
            "screen_id": self.id,
            "screen_name": self.name,
            "message": "Notification de test",
            "timestamp": fields.Datetime.now().isoformat(),
        }

        channel = f"kitchen.screen.{self.id}"
        self.env["bus.bus"]._sendone(channel, "test_notification", message)

        _logger.info(f"[KITCHEN] Test notification sent to {self.name}")

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Test envoyé',
                'message': f'Notification de test envoyée à l\'écran {self.name}',
                'type': 'success',
                'sticky': False,
            }
        }