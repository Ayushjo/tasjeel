sap.ui.define(["./BaseController"], function (BaseController) {
  "use strict";
  return BaseController.extend("tasjeel.portal.controller.Settings", {
    onLanguage(e) { this.getOwnerComponent().setLanguage(e.getParameter("item").getKey()); },
    onTheme(e) { this.getOwnerComponent().setTheme(e.getParameter("item").getKey()); }
  });
});
