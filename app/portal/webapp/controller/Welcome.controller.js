sap.ui.define(["./BaseController", "../model/formatter"], function (BaseController, formatter) {
  "use strict";
  return BaseController.extend("tasjeel.portal.controller.Welcome", {
    formatter,

    // Demo mode (local CAP server): both entry points sign in as CAP mock users.
    // Behind the approuter the user is already signed in; Welcome only shows when no role is assigned.
    onContinue() { this.getOwnerComponent().signIn("vendor1"); },
    onStaff() { this.getOwnerComponent().signIn("reviewer"); },
    onDemo(e) { this.getOwnerComponent().signIn(e.getSource().data("user")); },
    onSignOut() { this.getOwnerComponent().signOut(); },
    onToggleLanguage() { this.getOwnerComponent().setLanguage(this.getUi().getProperty("/lang") === "ar" ? "en" : "ar"); }
  });
});
