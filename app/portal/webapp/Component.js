sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/core/IconPool",
  "sap/ui/core/Theming",
  "sap/base/i18n/Localization",
  "sap/ui/model/json/JSONModel",
  "sap/ui/Device"
], function (UIComponent, IconPool, Theming, Localization, JSONModel, Device) {
  "use strict";

  const STORE = {
    get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  /** Mock users served by CAP's "mocked" auth in development (package.json → cds.requires.auth). */
  const DEMO_USERS = {
    vendor1: { name: "Najd Facilities", initials: "NF", role: "Applicant", home: "home" },
    vendor2: { name: "Ofuq Engineering", initials: "OE", role: "Applicant", home: "home" },
    reviewer: { name: "Sara Al-Otaibi", initials: "SA", role: "Reviewer", home: "inbox" },
    admin: { name: "Admin", initials: "AD", role: "Reviewer", home: "dashboard" }
  };

  return UIComponent.extend("tasjeel.portal.Component", {
    metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },

    init() {
      UIComponent.prototype.init.apply(this, arguments);

      // Phosphor icons → sap-icon://phosphor/<name>, used like SAP's own icon font.
      IconPool.registerFont({
        collectionName: "phosphor",
        fontFamily: "Phosphor",
        fontURI: sap.ui.require.toUrl("tasjeel/portal/fonts"),
        lazy: false
      });

      const lang = Localization.getLanguage().startsWith("ar") ? "ar" : "en";
      const theme = Theming.getTheme() === "sap_horizon_dark" ? "dark" : "light";
      this.setModel(new JSONModel({
        lang, theme,
        rtl: Localization.getRTL(),
        area: "public", // public | applicant | staff → which shell chrome is shown
        user: null,
        demo: true,     // true: local CAP mock users; false: real identity from XSUAA via the approuter
        noRole: null,   // signed in for real, but no Tasjeel role collection assigned (shows who, so they can ask)
        vendorsUrl: this._vendorsUrl(),
        sideExpanded: !Device.system.tablet && window.innerWidth >= 1200
      }), "ui");
      this.setModel(new JSONModel(Device), "device");
      document.documentElement.classList.toggle("tjDark", theme === "dark");

      // Routing starts once we know who the user is, so the route guards never see a half-loaded identity.
      this._identity = this._loadIdentity().finally(() => this.getRouter().initialize());
    },

    /**
     * Asks the server who is signed in. Behind the approuter that is the XSUAA user (session cookie, JWT forwarded);
     * on the local CAP server it is "anonymous" with auth "mocked", and the demo user picker is used instead.
     * Roles here only shape the UI. Each service enforces its own @requires / @restrict.
     */
    async _loadIdentity() {
      const ui = this.getModel("ui");
      let me = null;
      try {
        const res = await fetch(this.backendUrl("rest/user/me"), { headers: { Accept: "application/json" }, credentials: "same-origin" });
        if (res.ok) me = await res.json();
      } catch (e) { /* offline: fall back to demo mode */ }

      if (!me || me.auth === "mocked") {
        ui.setProperty("/demo", true);
        const saved = STORE.get("tj-user", null);
        if (saved && DEMO_USERS[saved]) this.signIn(saved, { navigate: false });
        return;
      }

      ui.setProperty("/demo", false);
      const roles = me.roles || [];
      const role = roles.includes("Reviewer") ? "Reviewer" : roles.includes("Applicant") ? "Applicant" : null;
      if (!role) { ui.setProperty("/noRole", me.email || me.id); return; }
      ui.setProperty("/user", {
        id: me.id, name: me.name, email: me.email, roles, role, initials: this._initials(me.name || me.id),
        home: role === "Applicant" ? "home" : roles.includes("Admin") ? "dashboard" : "inbox"
      });
    },

    _initials(name) {
      const parts = String(name).replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
      return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
    },

    /**
     * Backend URL relative to this app, e.g. "rest/stats/summary". Works the same on the local CAP server,
     * behind the approuter (HTML5 repository) and inside SAP Build Work Zone.
     */
    backendUrl(path) { return sap.ui.require.toUrl("tasjeel/portal/" + path); },

    /**
     * Where the Fiori Elements vendor list lives: a launchpad intent inside Work Zone, the sibling app in the
     * HTML5 repository behind the approuter, or the neighbouring folder on the local CAP server.
     */
    _vendorsUrl() {
      if (sap.ui.require("sap/ushell/Container")) return "#TasjeelVendor-display";
      return /\/webapp\//.test(location.pathname) ? "../../vendors/webapp/index.html" : "../tasjeelvendors/index.html";
    },

    /** Resolves when the signed-in identity is known (used by views that load data on init). */
    identityLoaded() { return this._identity; },

    /** Development sign-in: sets the Basic auth header CAP's mocked auth expects. */
    signIn(userId, { navigate = true } = {}) {
      const user = DEMO_USERS[userId];
      if (!user) return;
      const headers = { Authorization: "Basic " + btoa(userId + ":") };
      this._setAuth(headers);
      STORE.set("tj-user", userId);
      this.getModel("ui").setProperty("/user", { id: userId, ...user });
      if (navigate) this.getRouter().navTo(user.home);
    },

    signOut() {
      if (!this.getModel("ui").getProperty("/demo")) {
        // Inside Work Zone the launchpad owns the session; standalone, the approuter's logout endpoint ends it.
        const shell = sap.ui.require("sap/ushell/Container");
        if (shell) shell.logout(); else location.href = "/logout";
        return;
      }
      STORE.set("tj-user", "");
      this.getModel("ui").setProperty("/user", null);
      this._setAuth({ Authorization: undefined }); // undefined removes the header
      this.getRouter().navTo("welcome");
    },

    /**
     * OData V4 refuses header changes while requests are open, so each model is reset first.
     * A user switch also invalidates cached data from the previous user.
     */
    _setAuth(headers) {
      for (const name of [undefined, "review"]) {
        const model = this.getModel(name);
        model.resetChanges();
        model.changeHttpHeaders(headers);
        model.refresh();
      }
      this._authHeaders = headers.Authorization ? headers : {};
    },

    /** Auth headers for plain fetch() calls (REST stats). Empty behind the approuter: the session cookie is enough. */
    getAuthHeaders() { return this._authHeaders || {}; },

    /**
     * Headers for a modifying fetch() (document upload). The approuter enforces CSRF protection on /odata,
     * so a token is fetched first; the local CAP server ignores it.
     */
    async getWriteHeaders() {
      const headers = { ...this.getAuthHeaders() };
      if (this.getModel("ui").getProperty("/demo")) return headers;
      const res = await fetch(this.getModel().getServiceUrl(), { method: "HEAD", headers: { "X-CSRF-Token": "Fetch" }, credentials: "same-origin" });
      const token = res.headers.get("X-CSRF-Token");
      return token ? { ...headers, "X-CSRF-Token": token } : headers;
    },

    /** RTL is decided at boot, so a language switch reloads with the new setting. */
    setLanguage(lang) {
      STORE.set("tj-lang", lang);
      const url = new URL(location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.delete("lang");
        location.replace(url.toString());
      } else {
        location.reload(); // replace() to the same URL with a #hash would only jump, not reload
      }
    },

    setTheme(theme) {
      STORE.set("tj-theme", theme);
      Theming.setTheme(theme === "dark" ? "sap_horizon_dark" : "sap_horizon");
      document.documentElement.classList.toggle("tjDark", theme === "dark");
      this.getModel("ui").setProperty("/theme", theme);
    }
  });
});
