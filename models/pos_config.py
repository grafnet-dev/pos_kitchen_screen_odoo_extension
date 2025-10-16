from odoo import models, fields, api
from odoo.exceptions import UserError
import logging
import os

_logger = logging.getLogger(__name__)

class PosConfig(models.Model):
    _inherit = 'pos.config'

    # Champs pour la configuration des sons
    pos_sound_enabled = fields.Boolean(
        string="Activer Sons POS",
        default=False,
        help="Active les notifications sonores pour les serveurs"
    )
    
    pos_sound_file = fields.Selection([
        ('pos_ready', 'Son Standard (pos_ready.mp3)'),
        ('pos_ding', 'Son Ding (pos_ding.mp3)'),
        ('pos_notification', 'Notification (pos_notification.mp3)'),
        ('custom', 'Fichier Personnalisé')
    ], string="Fichier Son", default='pos_ready')
    
    pos_custom_sound = fields.Char(
        string="Fichier Son Personnalisé",
        help="URL ou chemin vers votre fichier audio personnalisé"
    )
    
    pos_volume = fields.Integer(
        string="Volume",
        default=50,
        help="Volume en pourcentage (0-100)"
    )
    
    # Champs pour le masquage automatique
    auto_hide_completed = fields.Boolean(
        string="Masquage Auto",
        default=False,
        help="Masquer automatiquement les commandes terminées"
    )
    
    hide_delay = fields.Integer(
        string="Délai Masquage",
        default=10,
        help="Délai en secondes avant masquage automatique"
    )

    @api.constrains('pos_volume')
    def _check_volume(self):
        """Valide que le volume est entre 0 et 100"""
        for record in self:
            if record.pos_volume < 0 or record.pos_volume > 100:
                raise UserError("Le volume doit être entre 0 et 100%")

    @api.constrains('hide_delay')
    def _check_hide_delay(self):
        """Valide que le délai est positif"""
        for record in self:
            if record.hide_delay < 1:
                raise UserError("Le délai doit être au moins de 1 seconde")

    def test_pos_sound(self):
        """Test du son configuré pour le POS avec exécution JavaScript"""
        self.ensure_one()
        
        if not self.pos_sound_enabled:
            raise UserError("Les sons POS ne sont pas activés")
        
        # Détermine le fichier son à tester
        if self.pos_sound_file == 'custom':
            if not self.pos_custom_sound:
                raise UserError("Veuillez spécifier un fichier son personnalisé")
            sound_file = self.pos_custom_sound
        else:
            sound_file = self.pos_sound_file + '.mp3'
        
        _logger.info(f"Test du son POS: {sound_file} à volume {self.pos_volume}%")
        
        # Configuration pour le JavaScript
        sound_config = {
            'file': self.pos_sound_file,
            'custom_sound': self.pos_custom_sound if self.pos_sound_file == 'custom' else None,
            'volume': self.pos_volume / 100.0
        }
        
        # Retourne une action client avec JavaScript pour jouer le son
        return {
            'type': 'ir.actions.client',
            'tag': 'pos_sound_test',
            'params': {
                'title': 'Test Son POS',
                'message': f'Lecture de: {sound_file} (Volume: {self.pos_volume}%)',
                'sound_config': sound_config
            }
        }

    def test_all_sounds(self):
        """Test de tous les sons disponibles avec exécution JavaScript"""
        self.ensure_one()
        
        if not self.pos_sound_enabled:
            raise UserError("Les sons POS ne sont pas activés")
        
        # Liste des sons à tester
        sounds = [
            ('pos_ready', 'Son Standard'),
            ('pos_ding', 'Son Ding'), 
            ('pos_notification', 'Notification')
        ]
        
        if self.pos_sound_file == 'custom' and self.pos_custom_sound:
            sounds.append(('custom', 'Son Personnalisé'))
        
        _logger.info(f"Test de tous les sons POS à volume {self.pos_volume}%")
        
        # Configuration pour tester tous les sons
        test_config = {
            'sounds': sounds,
            'volume': self.pos_volume / 100.0,
            'custom_sound': self.pos_custom_sound,
            'delay': 2000  # 2 secondes entre chaque son
        }
        
        return {
            'type': 'ir.actions.client',
            'tag': 'pos_sound_test_all',
            'params': {
                'title': 'Test Tous les Sons',
                'test_config': test_config
            }
        }

    def get_sound_config(self):
        """Retourne la configuration son pour le JavaScript"""
        self.ensure_one()
        
        if not self.pos_sound_enabled:
            return {}
        
        config = {
            'enabled': True,
            'volume': self.pos_volume / 100.0,
            'file': self.pos_sound_file,
            'auto_hide_completed': self.auto_hide_completed,
            'hide_delay': self.hide_delay * 1000  # Conversion en millisecondes
        }
        
        if self.pos_sound_file == 'custom':
            config['custom_sound'] = self.pos_custom_sound
        
        return config

    @api.model
    def get_pos_sound_settings(self, config_id):
        """API pour récupérer les paramètres son depuis le POS"""
        config = self.browse(config_id)
        return config.get_sound_config() if config.exists() else {}