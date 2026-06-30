sap.ui.define([
  "./BaseController", "sap/ui/model/json/JSONModel", "sap/ui/model/Filter", "sap/ui/model/FilterOperator",
  "sap/ui/Device", "sap/ui/core/EventBus", "../model/formatter"
], function (BaseController, JSONModel, Filter, FilterOperator, Device, EventBus, formatter) {
  "use strict";

  /** Queue filters → OData $filter, built on the server (never filter client-side on a growing list). */
  const STATUS = { pending: ["SUBMITTED", "IN_REVIEW"], changes: ["CHANGES_REQUESTED"], all: null };

  return BaseController.extend("tasjeel.portal.controller.Inbox", {
    formatter,

    onInit() {
      this.getView().setModel(new JSONModel({ layout: "OneColumn" }), "det");
      this.getRouter().getRoute("inbox").attachPatternMatched(this._onMatched, this);
      EventBus.getInstance().subscribe("tj", "queueChanged", () => this.byId("queue").getBinding("items")?.refresh());
      this._keys = this._onKey.bind(this);
    },

    _onMatched(e) {
      const id = e.getParameter("arguments").id;
      const layout = !id ? "OneColumn" : Device.system.phone || window.innerWidth < 960 ? "MidColumnFullScreen" : "TwoColumnsMidExpanded";
      this.getView().getModel("det").setProperty("/layout", layout);
      this._currentId = id || null;
      this.byId("detail").getController().show(id);
      if (!id) this.byId("queue").removeSelections(true);
      else this._highlight();
      document.addEventListener("keydown", this._keys);
    },

    onExit() { document.removeEventListener("keydown", this._keys); },

    onUpdateFinished(e) {
      const n = e.getParameter("total");
      this.byId("count").setText(this.getText(n === 1 ? "inbox.count1" : "inbox.count", [n]));
      this._highlight();
    },

    _highlight() {
      const list = this.byId("queue");
      const item = list.getItems().find((i) => i.data("id") === this._currentId);
      if (item && !item.getSelected()) list.setSelectedItem(item, true);
    },

    onSelect(e) { this.navTo("inbox", { id: e.getParameter("listItem").data("id") }, true); },

    onFilter() { this._applyFilters(); },
    onSearch() { clearTimeout(this._t); this._t = setTimeout(() => this._applyFilters(), 250); },

    _applyFilters() {
      const key = this.byId("filter").getSelectedKey();
      const q = (this.byId("search").getValue() || "").trim();
      const filters = [];
      if (key === "mine") filters.push(new Filter("assignedTo", FilterOperator.EQ, this.getUi().getProperty("/user/id")));
      else if (STATUS[key]) filters.push(new Filter({ filters: STATUS[key].map((s) => new Filter("status_code", FilterOperator.EQ, s)), and: false }));
      if (q) filters.push(new Filter({
        filters: ["legalNameEn", "legalNameAr", "applicationNo"].map((p) => new Filter(p, FilterOperator.Contains, q))
          .concat(new Filter("unifiedNo", FilterOperator.EQ, q)),
        and: false
      }));
      this.byId("queue").getBinding("items").filter(filters.length ? new Filter({ filters, and: true }) : []);
    },

    /** Keyboard triage: J / K move through the queue, Esc closes the detail. */
    _onKey(e) {
      if (!this.getView().getDomRef() || !this.getView().getDomRef().offsetParent) return;
      if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey) return;
      const items = this.byId("queue").getItems();
      const i = items.findIndex((it) => it.data("id") === this._currentId);
      if (e.key === "j" || e.key === "k") {
        const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "j" ? 1 : -1)))];
        if (next) this.navTo("inbox", { id: next.data("id") }, true);
      } else if (e.key === "Escape" && this._currentId) {
        this.navTo("inbox", {}, true);
      }
    }
  });
});
