/** @odoo-module */

import { registry } from "@web/core/registry";
import { KitchenScreenDashboard } from "pos_kitchen_screen/static/src/js/kitchen_screen"; 

const originalSetup = KitchenScreenDashboard.prototype.setup;

// On étend le setup
KitchenScreenDashboard.prototype.setup = function () {
    // Appelle le setup d'origine
    originalSetup.call(this);

    // Ajout de la gestion du screen_id
    this.getCurrentScreenId = () => {
        let session_screen_id;
        if (this.props.action?.context?.default_screen_id) {
            sessionStorage.setItem('screen_id', this.props.action.context.default_screen_id);
            session_screen_id = this.props.action.context.default_screen_id;
        } else {
            session_screen_id = sessionStorage.getItem('screen_id');
        }
        return parseInt(session_screen_id, 10) || 0;
    };

    this.currentScreenId = this.getCurrentScreenId();

    // On modifie dynamiquement la méthode loadOrders
    const originalLoadOrders = this.loadOrders;
    this.loadOrders = async () => {
        if (this.state.isLoading) return;
        try {
            this.state.isLoading = true;
            const result = await this.orm.call("pos.order", "get_details", [this.currentShopId, this.currentScreenId]);
            this.state.order_details = result.orders || [];
            this.state.lines = result.order_lines || [];
        } catch (error) {
            console.error("Error loading orders:", error);
        } finally {
            this.state.isLoading = false;
        }
    };
};

console.log("KitchenScreenDashboard étendu avec gestion du screen_id");

