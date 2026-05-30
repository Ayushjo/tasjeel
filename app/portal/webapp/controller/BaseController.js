sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/core/UIComponent"], function (Controller, UIComponent) {
  "use strict";
  return Controller.extend("tasjeel.portal.controller.BaseController", {
    getRouter() { return UIComponent.getRouterFor(this); },
    getModel(name) { return this.getView().getModel(name); },
    getUi() { return this.getOwnerComponent().getModel("ui"); },
    getText(key, args) { return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args); },
    navTo(route, params, replace) { this.getRouter().navTo(route, params || {}, undefined, replace); }
  });
});
