sap.ui.define([
  "./BaseController",
  "sap/m/Menu",
  "sap/m/MenuItem",
  "sap/ui/Device"
], function (BaseController, Menu, MenuItem, Device) {
  "use strict";

  /** Which shell chrome each route uses. */
  const AREA = { welcome: "public", home: "applicant", wizard: "applicant", inbox: "staff", dashboard: "staff", settings: "any" };
  const ROLE_AREA = { Applicant: "applicant", Reviewer: "staff" };

  return BaseController.extend("tasjeel.portal.controller.App", {
    onInit() {
      this.getView().addStyleClass(this.getOwnerComponent().getContentDensityClass?.() || "sapUiSizeCozy");
      this.getRouter().attachRouteMatched(this._onRouteMatched, this);
      this.getRouter().attachBypassed(() => this._setArea("public"));
      this._watchWidth();
    },

    _onRouteMatched(e) {
      const route = e.getParameter("name");
      const ui = this.getUi();
      const user = ui.getProperty("/user");
      let area = AREA[route] || "public";

      // Guards: signed-out users see Welcome; each role stays in its own area.
      if (area !== "public" && !user) return this.navTo("welcome", {}, true);
      if (route === "welcome" && user && !ui.getProperty("/demo")) return this.navTo(user.home, {}, true); // already signed in via XSUAA
      if (area === "any") area = ROLE_AREA[user.role];
      else if (area !== "public" && ROLE_AREA[user.role] !== area) return this.navTo(user.home, {}, true);

      ui.setProperty("/route", route);
      document.documentElement.dataset.route = route;
      this._setArea(area);
      if (area === "staff") this._loadCounts();
    },

    _setArea(area) {
      this.getUi().setProperty("/area", area);
      const page = this.byId("toolPage");
      ["public", "applicant", "staff"].forEach((a) => page.toggleStyleClass("tjArea-" + a, a === area));
    },

    _loadCounts() {
      // Inbox badge = applications waiting for a decision.
      const binding = this.getModel("review").bindList("/Applications", null, null, null, {
        $count: true, $filter: "status_code eq 'SUBMITTED' or status_code eq 'IN_REVIEW'", $select: "ID"
      });
      binding.requestContexts(0, 1).then(() => this.getUi().setProperty("/counts/inbox", String(binding.getCount() ?? "")))
        .catch(() => { /* not signed in as staff */ });
    },

    _watchWidth() {
      // Below 1200px the side navigation collapses to an icon rail (matches the mockups' tablet layout).
      const apply = () => { if (this.getUi().getProperty("/area") === "staff" && !Device.system.phone) this.getUi().setProperty("/sideExpanded", window.innerWidth >= 1200); };
      Device.resize.attachHandler(apply);
      apply();
    },

    onSideToggle() { this.getUi().setProperty("/sideExpanded", !this.getUi().getProperty("/sideExpanded")); },
    onSideSelect(e) { const key = e.getParameter("item").getKey(); if (key !== "vendors") this.navTo(key); },
    onTabSelect(e) { this.navTo(e.getParameter("key")); },
    onTopNav(e) { this.navTo(e.getSource().data("route")); },

    onToggleLanguage() { this.getOwnerComponent().setLanguage(this.getUi().getProperty("/lang") === "ar" ? "en" : "ar"); },
    onToggleTheme() { this.getOwnerComponent().setTheme(this.getUi().getProperty("/theme") === "dark" ? "light" : "dark"); },

    onUserMenu(e) {
      if (!this._menu) {
        const ui = this.getUi(), user = ui.getProperty("/user");
        this._menu = new Menu({
          items: [
            // Real identity: show who is signed in. Demo mode: switch between the CAP mock users.
            ...(ui.getProperty("/demo")
              ? [new MenuItem({ text: this.getText("shell.switchUser"), icon: "sap-icon://phosphor/users", press: () => this.getOwnerComponent().signOut() })]
              : [new MenuItem({ text: user.email || user.id, icon: "sap-icon://phosphor/user-circle", enabled: false })]),
            new MenuItem({ text: this.getText("shell.signOut"), icon: "sap-icon://phosphor/sign-out", press: () => this.getOwnerComponent().signOut() })
          ]
        });
        this.getView().addDependent(this._menu);
      }
      this._menu.openBy(e.getSource());
    }
  });
});
