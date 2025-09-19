# -*- coding: utf-8 -*-
# from odoo import http


# class PosKitchenExtension(http.Controller):
#     @http.route('/pos_kitchen_extension/pos_kitchen_extension', auth='public')
#     def index(self, **kw):
#         return "Hello, world"

#     @http.route('/pos_kitchen_extension/pos_kitchen_extension/objects', auth='public')
#     def list(self, **kw):
#         return http.request.render('pos_kitchen_extension.listing', {
#             'root': '/pos_kitchen_extension/pos_kitchen_extension',
#             'objects': http.request.env['pos_kitchen_extension.pos_kitchen_extension'].search([]),
#         })

#     @http.route('/pos_kitchen_extension/pos_kitchen_extension/objects/<model("pos_kitchen_extension.pos_kitchen_extension"):obj>', auth='public')
#     def object(self, obj, **kw):
#         return http.request.render('pos_kitchen_extension.object', {
#             'object': obj
#         })

