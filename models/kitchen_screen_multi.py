# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError
import logging

_logger = logging.getLogger(__name__)


class KitchenScreen(models.Model):
    """Extension du modèle Kitchen Screen pour supporter plusieurs écrans par POS"""
    _inherit = 'kitchen.screen'
    
    # ✅ MODIFICATION 1: Ajouter un nom d'affichage unique pour l'écran
    name = fields.Char(
        string='Screen Name',
        required=True,
        help='Unique name for this kitchen screen (e.g., "Grill Station", "Drinks Bar")'
    )
    
    # ✅ MODIFICATION 2: Retirer la contrainte sur pos_config_id
    # Permettre plusieurs écrans pour le même POS
    pos_config_id = fields.Many2one(
        'pos.config', 
        string='Allowed POS',
        required=True,
        help="POS configuration for this kitchen screen"
    )
    
    # ✅ MODIFICATION 3: Ajouter un champ pour identifier l'écran
    screen_code = fields.Char(
        string='Screen Code',
        help='Unique code to identify this screen (auto-generated)',
        readonly=True,
        copy=False
    )
    
    # ✅ MODIFICATION 4: Champ actif pour désactiver temporairement un écran
    active = fields.Boolean(
        string='Active',
        default=True,
        help='Uncheck to temporarily disable this kitchen screen'
    )
    
    # ✅ MODIFICATION 5: Ordre d'affichage des écrans
    display_order = fields.Integer(
        string='Display Order',
        default=10,
        help='Order in which screens are displayed in the list'
    )
    
    # ✅ MODIFICATION 6: Description de l'écran
    description = fields.Text(
        string='Description',
        help='Description of what this screen is used for'
    )
    
    # ✅ MODIFICATION 7: Affichage combiné pour les vues
    display_name_custom = fields.Char(
        string='Display Name',
        compute='_compute_display_name_custom',
        store=True
    )
    
    @api.depends('name', 'pos_config_id', 'sequence')
    def _compute_display_name_custom(self):
        """Génère un nom d'affichage combiné"""
        for record in self:
            if record.pos_config_id and record.name:
                record.display_name_custom = f"[{record.pos_config_id.name}] {record.name}"
            elif record.name:
                record.display_name_custom = record.name
            else:
                record.display_name_custom = record.sequence or 'New Screen'
    
    # ✅ MODIFICATION 8: Redéfinir _rec_name pour affichage
    _rec_name = 'display_name_custom'
    
    # ✅ MODIFICATION 9: Contrainte d'unicité sur (POS + Nom d'écran)
    _sql_constraints = [
        (
            'unique_screen_per_pos',
            'UNIQUE(pos_config_id, name)',
            'A screen with this name already exists for this POS!'
        ),
        (
            'unique_screen_code',
            'UNIQUE(screen_code)',
            'Screen code must be unique!'
        )
    ]
    
    @api.constrains('pos_categ_ids')
    def _check_pos_categ_ids(self):
        """Valider qu'au moins une catégorie est assignée"""
        for record in self:
            if not record.pos_categ_ids:
                raise ValidationError(
                    _('Please assign at least one POS category to the kitchen screen "%s".')
                    % record.name
                )
    
    @api.constrains('pos_config_id', 'pos_categ_ids')
    def _check_category_overlap(self):
        """
        Optionnel: Avertir s'il y a un chevauchement de catégories entre écrans
        (Désactivé par défaut - décommenter pour activer)
        """
        # for record in self:
        #     if not record.pos_categ_ids:
        #         continue
        #     
        #     # Chercher d'autres écrans actifs du même POS
        #     other_screens = self.search([
        #         ('id', '!=', record.id),
        #         ('pos_config_id', '=', record.pos_config_id.id),
        #         ('active', '=', True)
        #     ])
        #     
        #     for other_screen in other_screens:
        #         common_categs = record.pos_categ_ids & other_screen.pos_categ_ids
        #         if common_categs:
        #             _logger.warning(
        #                 f"Screen '{record.name}' shares categories {common_categs.mapped('name')} "
        #                 f"with screen '{other_screen.name}'"
        #             )
        pass
    
    @api.model_create_multi
    def create(self, vals_list):
        """Génération de la séquence et du code écran"""
        for vals in vals_list:
            # Générer la séquence si nécessaire
            if vals.get('sequence', 'New') == 'New':
                vals['sequence'] = self.env['ir.sequence'].next_by_code(
                    'kitchen.screen'
                ) or 'New'
            
            # ✅ Générer un code écran unique
            if not vals.get('screen_code'):
                pos_id = vals.get('pos_config_id')
                screen_name = vals.get('name', 'screen')
                timestamp = fields.Datetime.now().strftime('%Y%m%d%H%M%S')
                
                # Format: POS{id}_SCREENNAME_TIMESTAMP
                screen_code = f"POS{pos_id}_{screen_name.upper().replace(' ', '_')}_{timestamp}"
                vals['screen_code'] = screen_code[:64]  # Limiter la longueur
        
        result = super().create(vals_list)
        
        # ✅ Log de création
        for record in result:
            _logger.info(
                f"[KITCHEN SCREEN] Created screen '{record.name}' "
                f"(Code: {record.screen_code}) for POS '{record.pos_config_id.name}' "
                f"with categories: {record.pos_categ_ids.mapped('name')}"
            )
        
        return result
    
    def write(self, vals):
        """Log des modifications importantes"""
        result = super().write(vals)
        
        if 'pos_categ_ids' in vals or 'active' in vals:
            for record in self:
                _logger.info(
                    f"[KITCHEN SCREEN] Updated screen '{record.name}' "
                    f"(Active: {record.active}, Categories: {record.pos_categ_ids.mapped('name')})"
                )
        
        return result
    
    
    def kitchen_screen(self):
        """
        ✅ CORRECTION
        """
        self.ensure_one()
        
        _logger.info(f"[KITCHEN SCREEN] Opening screen ID={self.id}, Name='{self.name}', POS={self.pos_config_id.id}")
        
        # ✅ MÉTHODE 1: Via params (RECOMMANDÉ)
        action = {
            'name': f'Kitchen Screen - {self.name}',
            'type': 'ir.actions.client',
            'tag': 'kitchen_custom_dashboard_tags',
            'params': {
                'screen_id': self.id,
                'pos_config_id': self.pos_config_id.id,
                'screen_name': self.name,
            },
            'context': {
                'default_screen_id': self.id,
                'default_pos_config_id': self.pos_config_id.id,
                'screen_id': self.id,  # Triple redondance pour sécurité
            },
            'target': 'fullscreen',
        }
        
        _logger.info(f"[KITCHEN SCREEN] Action prepared: {action}")
        
        return action


    
    
    @api.model
    def get_screens_for_pos(self, pos_config_id):
        """
        ✅ NOUVELLE MÉTHODE: Récupérer tous les écrans actifs d'un POS
        Utilisé par le frontend pour lister les écrans disponibles
        """
        screens = self.search([
            ('pos_config_id', '=', pos_config_id),
            ('active', '=', True)
        ], order='display_order, name')
        
        return screens.read([
            'id',
            'name',
            'sequence',
            'screen_code',
            'pos_categ_ids',
            'display_order',
            'description'
        ])
    
    @api.model
    def get_screen_by_code(self, screen_code):
        """
        ✅ NOUVELLE MÉTHODE: Récupérer un écran par son code
        Utile pour les URLs ou les références externes
        """
        screen = self.search([('screen_code', '=', screen_code)], limit=1)
        if screen:
            return screen.read([
                'id',
                'name',
                'pos_config_id',
                'pos_categ_ids',
                'is_preparation_complete'
            ])[0]
        return None
    
    # Ajoutez cette méthode dans kitchen_screen_multi.py
    @api.model
    def debug_screen_configuration(self, pos_config_id):
        """
        Méthode de diagnostic pour vérifier la configuration des écrans
        """
        screens = self.search([
            ('pos_config_id', '=', pos_config_id),
            ('active', '=', True)
        ])
        
        config_info = {
            'pos_config_id': pos_config_id,
            'total_screens': len(screens),
            'screens': []
        }
        
        for screen in screens:
            screen_info = {
                'id': screen.id,
                'name': screen.name,
                'categories': screen.pos_categ_ids.mapped('name'),
                'category_ids': screen.pos_categ_ids.ids,
                'active': screen.active
            }
            config_info['screens'].append(screen_info)
        
        _logger.info(f"[DEBUG] Screen configuration: {config_info}")
        return config_info
   

   
    @api.model
    def get_screen_for_categories(self, category_ids, pos_config_id):
        """
        ✅ CORRECTION CRITIQUE: Trouve TOUS les écrans correspondant aux catégories données
        """
        try:
            if not category_ids or not pos_config_id:
                _logger.warning(
                    f"[KITCHEN SCREEN] get_screen_for_categories called with invalid params: "
                    f"category_ids={category_ids}, pos_config_id={pos_config_id}"
                )
                return []

            _logger.info(
                f"[KITCHEN SCREEN] 🔍 Searching ALL screens for POS {pos_config_id} "
                f"with categories {category_ids}"
            )
            
            # ✅ CORRECTION: Récupérer TOUS les écrans actifs d'abord
            all_screens = self.search([
                ('pos_config_id', '=', pos_config_id),
                ('active', '=', True)
            ], order='display_order, id')

            if not all_screens:
                _logger.warning(f"[KITCHEN SCREEN] ⚠ No active screens found for POS {pos_config_id}")
                return []

            _logger.info(f"[KITCHEN SCREEN] Found {len(all_screens)} active screens to check")

            # ✅ FILTRAGE MANUEL: Vérifier chaque écran
            matching_screens = self.env['kitchen.screen']
            
            for screen in all_screens:
                screen_categ_ids = screen.pos_categ_ids.ids
                _logger.info(
                    f"[KITCHEN SCREEN] Checking screen '{screen.name}' (ID: {screen.id}) "
                    f"with categories {screen_categ_ids}"
                )
                
                # Vérifier l'intersection
                common_categories = set(category_ids) & set(screen_categ_ids)
                
                if common_categories:
                    matching_screens |= screen
                    _logger.info(
                        f"[KITCHEN SCREEN] ✅ Screen '{screen.name}' MATCHES "
                        f"(common categories: {list(common_categories)})"
                    )
                else:
                    _logger.info(
                        f"[KITCHEN SCREEN] ❌ Screen '{screen.name}' NO MATCH "
                        f"(looking for {category_ids}, has {screen_categ_ids})"
                    )

            screen_ids = matching_screens.ids
            
            if matching_screens:
                screen_names = matching_screens.mapped('name')
                _logger.info(
                    f"[KITCHEN SCREEN] ✅ Final result: {len(matching_screens)} screens matched: "
                    f"{screen_names} (IDs: {screen_ids})"
                )
            else:
                _logger.warning(
                    f"[KITCHEN SCREEN] ⚠ NO SCREENS MATCHED for categories {category_ids}"
                )
            
            return screen_ids
                
        except Exception as e:
            _logger.error(
                f"[KITCHEN SCREEN] Error in get_screen_for_categories: {str(e)}", 
                exc_info=True
            )
            return []
    
    
    def action_duplicate_screen(self):
        """
        ✅ NOUVELLE MÉTHODE: Dupliquer un écran facilement
        Bouton dans la vue formulaire
        """
        self.ensure_one()
        
        new_name = f"{self.name} (Copy)"
        copy_count = self.search_count([
            ('pos_config_id', '=', self.pos_config_id.id),
            ('name', 'like', f"{self.name} (Copy%)")
        ])
        
        if copy_count > 0:
            new_name = f"{self.name} (Copy {copy_count + 1})"
        
        new_screen = self.copy({
            'name': new_name,
            'sequence': 'New',
            'screen_code': False  # Sera généré automatiquement
        })
        
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'kitchen.screen',
            'res_id': new_screen.id,
            'view_mode': 'form',
            'target': 'current',
        }
    
    def action_view_orders(self):
        """
        ✅ NOUVELLE MÉTHODE: Voir les commandes assignées à cet écran
        """
        self.ensure_one()
        
        # Récupérer les commandes ayant des produits dans les catégories de cet écran
        order_lines = self.env['pos.order.line'].search([
            ('is_cooking', '=', True),
            ('order_id.config_id', '=', self.pos_config_id.id),
            ('product_id.pos_categ_ids', 'in', self.pos_categ_ids.ids)
        ])
        
        order_ids = order_lines.mapped('order_id').ids
        
        return {
            'name': f'Orders for {self.name}',
            'type': 'ir.actions.act_window',
            'res_model': 'pos.order',
            'view_mode': 'tree,form',
            'domain': [('id', 'in', order_ids)],
            'context': {'create': False}
        }
    
    def toggle_active(self):
        """
        ✅ NOUVELLE MÉTHODE: Basculer l'état actif/inactif rapidement
        """
        for record in self:
            record.active = not record.active
            
            status = "activated" if record.active else "deactivated"
            _logger.info(f"[KITCHEN SCREEN] Screen '{record.name}' {status}")
    
    @api.model
    def get_screen_statistics(self, screen_id):
        """
        ✅ NOUVELLE MÉTHODE: Statistiques en temps réel pour un écran
        Peut être appelé par le frontend pour afficher des métriques
        """
        screen = self.browse(screen_id)
        if not screen.exists():
            return {}
        
        # Commandes en cours pour cet écran
        order_lines = self.env['pos.order.line'].search([
            ('is_cooking', '=', True),
            ('order_id.config_id', '=', screen.pos_config_id.id),
            ('order_id.order_status', 'in', ['draft', 'waiting']),
            ('product_id.pos_categ_ids', 'in', screen.pos_categ_ids.ids)
        ])
        
        orders = order_lines.mapped('order_id')
        
        return {
            'screen_id': screen.id,
            'screen_name': screen.name,
            'total_orders': len(orders),
            'cooking_orders': len(orders.filtered(lambda o: o.order_status == 'draft')),
            'ready_orders': len(orders.filtered(lambda o: o.order_status == 'waiting')),
            'total_items': len(order_lines),
            'categories': screen.pos_categ_ids.mapped('name'),
        }


class PosConfig(models.Model):
    """Extension de pos.config pour afficher les écrans associés"""
    _inherit = 'pos.config'
    
    kitchen_screen_ids = fields.One2many(
        'kitchen.screen',
        'pos_config_id',
        string='Kitchen Screens',
        help='Kitchen screens configured for this POS'
    )
    
    kitchen_screen_count = fields.Integer(
        string='Number of Screens',
        compute='_compute_kitchen_screen_count'
    )
    
    @api.depends('kitchen_screen_ids')
    def _compute_kitchen_screen_count(self):
        """Compte le nombre d'écrans actifs"""
        for record in self:
            record.kitchen_screen_count = len(
                record.kitchen_screen_ids.filtered(lambda s: s.active)
            )
    
    def action_view_kitchen_screens(self):
        """Action pour voir tous les écrans de ce POS"""
        self.ensure_one()
        
        return {
            'name': f'Kitchen Screens - {self.name}',
            'type': 'ir.actions.act_window',
            'res_model': 'kitchen.screen',
            'view_mode': 'tree,form',
            'domain': [('pos_config_id', '=', self.id)],
            'context': {
                'default_pos_config_id': self.id,
                'search_default_active': 1
            }
        }
    
    @api.model
    def check_categories_have_screen(self, category_ids, pos_config_id):
        """
        ✅ NOUVELLE MÉTHODE: Vérifie que toutes les catégories ont un écran assigné
        Peut être appelée avant de valider une commande
        """
        if not category_ids:
            return {'valid': True, 'missing_categories': []}
        
        screens = self.env['kitchen.screen'].search([
            ('pos_config_id', '=', pos_config_id),
            ('active', '=', True)
        ])
        
        assigned_categs = set()
        for screen in screens:
            assigned_categs.update(screen.pos_categ_ids.ids)
        
        missing = set(category_ids) - assigned_categs
        
        result = {
            'valid': len(missing) == 0,
            'missing_categories': list(missing)
        }
        
        if missing:
            missing_names = self.env['pos.category'].browse(list(missing)).mapped('name')
            _logger.warning(
                f"[KITCHEN SCREEN] Categories without screen assignment: {missing_names}"
            )
        
        return result