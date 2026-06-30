sap.ui.define([
  "./BaseController", "sap/ui/model/json/JSONModel", "sap/m/MessageBox", "sap/m/MessageToast", "sap/ui/core/format/DateFormat", "../model/formatter"
], function (BaseController, JSONModel, MessageBox, MessageToast, DateFormat, formatter) {
  "use strict";

  const DAY = 86400000;
  const SOON_DAYS = 30;

  /** Registration stages shown in the tracker, and where each status sits on it. */
  const STAGES = ["draft", "submitted", "review", "approved", "registered"];
  const POSITION = { DRAFT: 0, SUBMITTED: 2, IN_REVIEW: 2, CHANGES_REQUESTED: 2, REJECTED: 2, APPROVED: 3, REGISTERED: 5 };
  /** History status that marks when each stage was reached. */
  const REACHED_BY = { submitted: "SUBMITTED", review: "IN_REVIEW", approved: "APPROVED", registered: "REGISTERED" };

  /** Wizard step for each field a reviewer can flag (keys match the reviewer's "Request changes" list). */
  const FIELD_STEP = {
    legalNameEn: "pre", legalNameAr: "pre", unifiedNo: "pre", establishedOn: "profile",
    city: "address", district: "address", postalCode: "address", buildingNo: "address", contacts: "address",
    vatNumber: "tax", zakatCertNo: "tax", gosiNo: "tax", chamberNo: "tax",
    iban: "banking", accountHolder: "banking", categories: "products", documents: "documents"
  };
  const FIELD_ICON = { documents: "file-text", contacts: "users", iban: "bank", accountHolder: "bank", categories: "squares-four" };
  const FIELD_LABEL = { categories: "f.categories", documents: "step.documents", contacts: "contacts.title" };

  return BaseController.extend("tasjeel.portal.controller.Home", {
    formatter,

    onInit() {
      this.getView().setModel(new JSONModel({ state: "loading" }), "home");
      this.getRouter().getRoute("home").attachPatternMatched(() => this._load());
      this._load(); // the view is created lazily, after the first patternMatched has fired
    },

    _home() { return this.getView().getModel("home"); },

    /** One request per source, in parallel; the page renders once everything is known. */
    _load() {
      if (this._loading) return this._loading;
      this._loading = this._doLoad().finally(() => { this._loading = null; });
      return this._loading;
    },

    async _doLoad() {
      const model = this.getModel();
      const home = this._home();
      if (!home.getProperty("/app")) home.setProperty("/state", "loading");
      try {
        const list = model.bindList("/Applications", null, null, null, {
          // the active version, or the draft of an application that was never submitted
          $filter: "IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null",
          $expand: "status,supplierType($select=name),legalForm($select=name),bankCode($select=name)," +
            "documents($select=ID,docType_code,fileName,expiryDate;$expand=docType($select=name))"
        });
        const [ctx] = await list.requestContexts(0, 1);
        if (!ctx) return home.setData({ state: "empty" });
        this._ctx = ctx;
        const app = ctx.getObject();

        const byApp = (path, extra = {}) => model.bindList(path, null, null, null, { $filter: `application_ID eq ${app.ID}`, ...extra })
          .requestContexts(0, 50).then((cs) => cs.map((c) => c.getObject())).catch(() => []);
        const [history, messages, flags, reqs] = await Promise.all([
          byApp("/StatusHistory", { $orderby: "createdAt" }),
          byApp("/Comments", { $orderby: "createdAt desc" }),
          app.status_code === "CHANGES_REQUESTED" ? byApp("/ReviewFlags") : [],
          app.status_code === "DRAFT" || !app.IsActiveEntity
            ? model.bindContext(ctx.getPath() + "/ApplicantService.requirements()").requestObject().catch(() => null) : null
        ]);

        home.setData({
          state: "ready",
          app,
          stages: this._stages(app, history),
          banner: this._banner(app, messages, flags, reqs),
          items: this._items(app, flags, reqs),
          company: this._company(app),
          reminders: this._reminders(app),
          messages: messages.slice(0, 3).map((m) => ({ text: m.text, when: formatter.relative(m.createdAt) })),
          locked: !["DRAFT", "CHANGES_REQUESTED"].includes(app.status_code),
          lockText: this.getText({ APPROVED: "home.lockedApproved", REGISTERED: "home.lockedApproved", REJECTED: "home.lockedClosed" }[app.status_code]
            || (["DRAFT", "CHANGES_REQUESTED"].includes(app.status_code) ? "home.editable" : "home.locked")),
          updated: formatter.relative(history.at(-1)?.createdAt || app.modifiedAt)
        });
      } catch (e) {
        home.setData({ state: "error", error: e.message });
      }
    },

    // ---------------------------------------------------------------- view data

    _stages(app, history) {
      const status = app.status_code;
      const at = POSITION[status] ?? 0;
      const last = (s) => [...history].reverse().find((h) => h.toStatus === s)?.createdAt;
      const day = (d) => (d ? DateFormat.getDateInstance({ format: "MMMd" }).format(new Date(d)) : "");
      return STAGES.map((key, i) => {
        const stage = { key, title: this.getText("home.stage." + key), state: i < at ? "done" : i === at ? "current" : "todo" };
        if (stage.state === "done") stage.meta = day(key === "draft" ? app.createdAt : last(REACHED_BY[key]));
        if (stage.state === "current") {
          if (key === "review") {
            stage.tone = { SUBMITTED: "info", IN_REVIEW: "review", CHANGES_REQUESTED: "warn", REJECTED: "danger" }[status];
            stage.title = app.status?.name || stage.title;
            stage.meta = this.getText("home.stage.reviewMeta." + status);
          } else stage.meta = this.getText("home.stage.now." + key);
        }
        if (stage.state === "todo") stage.meta = status === "REJECTED" ? "" : this.getText("home.stage.next." + key);
        return stage;
      });
    },

    /** The one thing to know (and do) right now, per status. */
    _banner(app, messages, flags, reqs) {
      const t = (k, a) => this.getText(k, a);
      const note = messages[0]?.text;
      switch (app.status_code) {
        case "CHANGES_REQUESTED":
          return { tone: "warn", icon: "chat-circle-text", title: t(flags.length === 1 ? "home.b.changes1" : "home.b.changesN", [flags.length || ""]),
            text: note ? `“${note}”` : t("home.b.changesText"), action: t("home.b.fix"), go: "fix" };
        case "SUBMITTED":
          return { tone: "info", icon: "hourglass-medium", title: t("home.b.submitted"), text: t("home.b.submittedText"), secondary: t("home.b.withdraw"), go: "withdraw" };
        case "IN_REVIEW":
          return { tone: "review", icon: "eye", title: t("home.b.review"), text: t("home.b.reviewText") };
        case "APPROVED":
          return { tone: "ok", icon: "seal-check", title: t("home.b.approved"), text: t("home.b.approvedText") };
        case "REGISTERED":
          return { tone: "ok", icon: "seal-check", title: t("home.b.registered"), text: t("home.b.registeredText", [app.s4BusinessPartner || "—"]) };
        case "REJECTED":
          return { tone: "danger", icon: "x-circle", title: t("home.b.rejected"), text: note ? `“${note}”` : t("home.b.rejectedText") };
        default: {
          const open = (reqs?.items || []).filter((i) => i.severity === "error").length;
          return { tone: "accent", icon: open ? "note-pencil" : "paper-plane-tilt", title: t(open ? "home.b.draft" : "home.b.draftDone"),
            text: t(open ? "home.b.draftText" : "home.b.draftReady", [reqs?.percent ?? 0, open]),
            action: t(open ? "home.b.continue" : "home.b.reviewSubmit"), go: open ? "continue" : "review" };
        }
      }
    },

    /** Rows under the banner: flagged fields (changes requested) or the first open items (draft). */
    _items(app, flags, reqs) {
      if (app.status_code === "CHANGES_REQUESTED") {
        return flags.map((f) => {
          const title = this.getText(FIELD_LABEL[f.field] || "f." + f.field);
          const step = this.getText("step." + (FIELD_STEP[f.field] || "pre"));
          return {
          title,
          meta: [f.note, step !== title && step].filter(Boolean).join(" · ") || this.getText("home.flagged"),
          icon: "sap-icon://phosphor/" + (FIELD_ICON[f.field] || "pencil-simple-line"),
          step: FIELD_STEP[f.field] || "pre",
          action: this.getText(f.field === "documents" ? "home.upload" : "home.edit"),
          kind: "flag"
          };
        });
      }
      if (reqs) {
        return (reqs.items || []).filter((i) => i.severity === "error").slice(0, 3).map((i) => ({
          title: i.message, meta: this.getText("step." + i.step), icon: "sap-icon://phosphor/circle-dashed", step: i.step, action: this.getText("home.open"), kind: "todo"
        }));
      }
      return [];
    },

    _company(app) {
      const ar = this.getUi().getProperty("/lang") === "ar";
      const rows = [
        { k: "home.k.name", v: (ar ? app.legalNameAr : app.legalNameEn) || app.legalNameEn },
        { k: "f.unifiedNo", v: app.unifiedNo, mono: true },
        { k: "f.vatNumber", v: app.vatNumber, mono: true },
        { k: "home.k.type", v: [app.supplierType?.name, app.legalForm?.name].filter(Boolean).join(" · ") },
        { k: "home.k.bank", v: [app.bankCode?.name, app.iban && "•••• " + app.iban.replace(/\s/g, "").slice(-4)].filter(Boolean).join(" · ") }
      ];
      if (app.s4BusinessPartner) rows.push({ k: "home.k.sap", v: app.s4BusinessPartner, mono: true });
      return rows.filter((r) => r.v).map((r) => ({ ...r, k: this.getText(r.k) }));
    },

    /** Documents (and the Zakat certificate) with an expiry date, soonest first. */
    _reminders(app) {
      const today = new Date(new Date().toDateString()).getTime();
      const items = (app.documents || []).filter((d) => d.expiryDate && d.fileName)
        .map((d) => ({ name: d.docType?.name || d.fileName, expiry: d.expiryDate }));
      if (app.zakatCertExpiry && !items.some((i) => i.expiry === app.zakatCertExpiry)) items.push({ name: this.getText("home.zakat"), expiry: app.zakatCertExpiry });
      return items.map((i) => {
        const days = Math.round((new Date(i.expiry).getTime() - today) / DAY);
        const state = days < 0 ? "danger" : days <= SOON_DAYS ? "warn" : "ok";
        const meta = days < 0 ? this.getText("home.r.expired", [formatter.date(i.expiry)])
          : days <= SOON_DAYS ? this.getText(days === 1 ? "home.r.soon1" : "home.r.soon", [days])
            : this.getText("home.r.valid", [formatter.date(i.expiry)]);
        return { name: i.name, meta, state, days, icon: "sap-icon://phosphor/" + (state === "ok" ? "check-circle" : state === "warn" ? "clock" : "warning-circle") };
      }).sort((a, b) => a.days - b.days);
    },

    // ---------------------------------------------------------------- actions

    onBannerAction() {
      const go = this._home().getProperty("/banner/go");
      if (go === "withdraw") return this._withdraw();
      if (go === "review") return this.navTo("wizard", { step: "review" });
      if (go === "fix") return this.navTo("wizard", { step: this._home().getProperty("/items/0/step") });
      this.navTo("wizard");
    },

    onItem(e) { this.navTo("wizard", { step: e.getSource().getBindingContext("home").getProperty("step") }); },

    onStart() { this.navTo("wizard"); },

    _withdraw() {
      MessageBox.confirm(this.getText("home.withdrawConfirm"), {
        title: this.getText("home.b.withdraw"),
        emphasizedAction: MessageBox.Action.OK,
        onClose: async (action) => {
          if (action !== MessageBox.Action.OK) return;
          try {
            await this.getModel().bindContext("ApplicantService.withdraw(...)", this._ctx).invoke();
            MessageToast.show(this.getText("home.withdrawn"));
            this.getModel().refresh();
            this.navTo("wizard");
          } catch (e) { MessageBox.error(e.message); }
        }
      });
    }
  });
});
