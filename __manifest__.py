# -*- coding: utf-8 -*-
{
    'name': "pos_kitchen_extension",

    'summary': "Short (1 phrase/line) summary of the module's purpose",

    'description': """
Long description of module's purpose
    """,

    'author': "My Company",
    'website': "https://www.yourcompany.com",

    # Categories can be used to filter modules in modules listing
    # Check https://github.com/odoo/odoo/blob/15.0/odoo/addons/base/data/ir_module_category_data.xml
    # for the full list
    'category': 'Uncategorized',
    'version': '0.1',

    # any module necessary for this one to work correctly
    'depends': ['point_of_sale','pos_restaurant','pos_kitchen_screen_odoo', 'bus', 'web'],

    # always loaded
    'data': [
        # 'security/ir.model.access.csv',
        'views/kitchen_screen_views.xml',
        'views/pos_config_views.xml',
        
        
        
       
   
    ],
    'assets': {
        'web.assets_frontend': [
            'pos_kitchen_screen_odoo_extension/static/src/js/kitchen_notification_service.js',
            'pos_kitchen_screen_odoo_extension/static/src/js/kitchen_integration.js',
            'pos_kitchen_screen_odoo_extension/static/src/xml/kitchen_screen_template.xml',
            
            
        ],
        'web.assets_backend': [
             'pos_kitchen_screen_odoo_extension/static/src/js/kitchen_notification_service.js',
             'pos_kitchen_screen_odoo_extension/static/src/js/kitchen_integration.js',
             'pos_kitchen_screen_odoo/static/src/js/kitchen_screen.js',
             'pos_kitchen_screen_odoo/static/src/xml/kitchen_screen_templates.xml',
             
             
             
             
        ],
    },
    
    # only loaded in demonstration mode
    'demo': [
        'demo/demo.xml',
    ],
}

