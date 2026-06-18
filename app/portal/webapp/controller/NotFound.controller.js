sap.ui.define(["./BaseController"], function (BaseController) {
  "use strict";
  return BaseController.extend("tasjeel.portal.controller.NotFound", { onBack() { this.navTo("welcome", {}, true); } });
});
