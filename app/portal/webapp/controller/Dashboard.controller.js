sap.ui.define(["./BaseController", "sap/ui/model/json/JSONModel", "../model/formatter"], function (BaseController, JSONModel, formatter) {
  "use strict";

  const COLORS = { APPROVED: "var(--tjApproved)", REGISTERED: "var(--tjApproved)", SUBMITTED: "var(--tjSubmitted)", IN_REVIEW: "var(--tjReview)",
    CHANGES_REQUESTED: "var(--tjChanges)", REJECTED: "var(--tjRejected)", DRAFT: "var(--tjDraft)" };
  const DAY = 86400000;

  return BaseController.extend("tasjeel.portal.controller.Dashboard", {
    formatter,

    onInit() {
      this.getView().setModel(new JSONModel({ weeks: "8", summary: {}, weekly: [], byStatus: [], byCategory: [], sla: [], total: 0 }), "stats");
      // Views are created lazily on first navigation, after that route match already fired: load now + on later visits.
      this.getRouter().getRoute("dashboard").attachPatternMatched(this._load, this);
      this._load();
    },

    onRange() { this._load(); },

    /** Dashboard numbers come from CAP's REST endpoints (plain JSON), the SLA list from OData. */
    async _load() {
      const m = this.getView().getModel("stats");
      const headers = { ...this.getOwnerComponent().getAuthHeaders(), "Accept-Language": this.getUi().getProperty("/lang") };
      const get = (p) => fetch("/rest/stats/" + p, { headers }).then((r) => (r.ok ? r.json() : null));
      const weeks = Number(m.getProperty("/weeks"));
      const [summary, weekly, byStatus, byCategory] = await Promise.all([get("summary"), get("weekly?weeks=" + weeks), get("byStatus"), get("byCategory")]);
      if (summary) m.setProperty("/summary", summary);
      if (weekly) m.setProperty("/weekly", weekly.map((w, i) => ({ label: this.getUi().getProperty("/lang") === "ar" ? String(i + 1) : this.getText("dash.weekShort", [i + 1]), value: w.submitted })));
      if (byStatus) {
        const order = ["APPROVED", "REGISTERED", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "REJECTED", "DRAFT"];
        const rows = byStatus.filter((s) => s.status !== "DRAFT").sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
        m.setProperty("/byStatus", rows.map((s) => ({ label: s.name, value: s.count, color: COLORS[s.status] })));
        m.setProperty("/total", rows.reduce((n, s) => n + s.count, 0));
      }
      if (byCategory) m.setProperty("/byCategory", byCategory.slice(0, 6).map((c) => ({ label: c.name, value: c.count })));
      this._loadSla();
    },

    async _loadSla() {
      const since = new Date(Date.now() - 3 * DAY).toISOString();
      const list = this.getModel("review").bindList("/Applications", null, null, null, {
        $filter: `(status_code eq 'SUBMITTED' or status_code eq 'IN_REVIEW') and submittedAt lt ${since}`,
        $orderby: "submittedAt asc", $select: "ID,applicationNo,legalNameEn,legalNameAr,status_code,submittedAt", $expand: "status($select=name)"
      });
      const rows = await list.requestContexts(0, 10).catch(() => []);
      const ar = this.getUi().getProperty("/lang") === "ar";
      this.getView().getModel("stats").setProperty("/sla", rows.map((c) => {
        const o = c.getObject();
        return {
          id: o.ID, no: o.applicationNo, name: ar && o.legalNameAr ? o.legalNameAr : o.legalNameEn, status: o.status_code,
          statusName: o.status?.name, waiting: this.getText("dash.daysWaiting", [Math.floor((Date.now() - new Date(o.submittedAt)) / DAY)])
        };
      }));
    },

    onOpen(e) { this.navTo("inbox", { id: e.getSource().getBindingContext("stats").getProperty("id") }); }
  });
});
