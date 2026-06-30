sap.ui.define([
  "./BaseController", "sap/ui/model/json/JSONModel", "sap/m/Dialog", "sap/m/Button", "sap/m/TextArea", "sap/m/Text",
  "sap/m/Label", "sap/m/MultiComboBox", "sap/ui/core/Item", "sap/m/VBox", "sap/m/MessageToast", "sap/m/MessageBox",
  "sap/m/PDFViewer", "sap/ui/core/EventBus", "../model/formatter"
], function (BaseController, JSONModel, Dialog, Button, TextArea, Text, Label, MultiComboBox, Item, VBox, MessageToast, MessageBox,
  PDFViewer, EventBus, formatter) {
  "use strict";

  const UNDO_SECONDS = 5;
  const MIN_REASON = 10;
  /** Fields a reviewer can flag in "Request changes" (keys = wizard field names). */
  const FLAGGABLE = ["legalNameEn", "legalNameAr", "unifiedNo", "establishedOn", "city", "district", "postalCode", "buildingNo",
    "vatNumber", "zakatCertNo", "gosiNo", "chamberNo", "iban", "accountHolder", "categories", "documents", "contacts"];

  return BaseController.extend("tasjeel.portal.controller.InboxDetail", {
    formatter,

    onInit() {
      this.getView().setModel(new JSONModel({ id: null, dups: [], risk: {}, activity: [], countdown: 0, docCount: "", s4: { loading: false, systems: [] }, retrying: false }), "det");
    },

    _det() { return this.getView().getModel("det"); },

    /** Called by the Inbox controller whenever the URL's application id changes. */
    show(id) {
      this._cancelCountdown();
      this._det().setProperty("/id", id || null);
      if (!id) return;
      this.getView().bindElement({
        path: `/Applications(${id})`,
        model: "review",
        parameters: { $expand: "status,supplierType,legalForm,bankCode,categories($expand=category),contacts,documents($expand=docType)" },
        events: { dataReceived: () => this._afterLoad(id) }
      });
      this.byId("tabs").setSelectedKey("overview");
      this._afterLoad(id);
    },

    async _afterLoad(id) {
      const model = this.getModel("review");
      const base = `/Applications(${id})`;
      const call = (path) => model.bindContext(path).requestObject().catch(() => null);
      const [risk, dups, docs] = await Promise.all([
        call(`${base}/ReviewService.riskBreakdown()`),
        call(`${base}/ReviewService.duplicates()`),
        model.bindList(`${base}/documents`, null, null, null, { $select: "ID" }).requestContexts(0, 50).catch(() => [])
      ]);
      if (this._det().getProperty("/id") !== id) return; // user moved on
      this._det().setProperty("/risk", risk || { score: 0, level: "Low", factors: [] });
      this._det().setProperty("/dups", dups?.value || []);
      this._det().setProperty("/docCount", String(docs.length));
      this._loadActivity(id);
      this._loadS4(id);
    },

    /** Duplicate check in the target S/4 and the S/4HANA Cloud sandbox. Slow or down systems never block the page. */
    async _loadS4(id, fresh = false) {
      if (!fresh && this._s4For === id) return; // dataReceived + show() both call _afterLoad
      this._s4For = id;
      this._det().setProperty("/s4", { loading: true, systems: [] });
      const res = await this.getModel("review").bindContext(`/Applications(${id})/ReviewService.s4Check(fresh=${fresh})`)
        .requestObject().catch((e) => ({ error: e.message, systems: [] }));
      if (this._det().getProperty("/id") !== id) return;
      const t = (k, a) => this.getText(k, a);
      const systems = (res.systems || []).map((s) => {
        const n = s.matches.length;
        return {
          ...s,
          label: t(s.system === "S4_SANDBOX" ? "s4.sys.sandbox" : "s4.sys.target"),
          state: !s.reachable ? "down" : n ? "match" : "ok",
          meta: s.reachable ? `${s.latencyMs} ms` : t("s4.down"),
          summary: !s.reachable ? t("s4.unreachable") : n ? t(n === 1 ? "s4.match1" : "s4.matchN", [n, s.query]) : t("s4.noMatch", [s.query || "—"]),
          matches: s.matches.map((m) => ({ ...m, name: m.name || "—", matchedOnText: t("s4.on." + m.matchedOn) }))
        };
      });
      this._det().setProperty("/s4", { loading: false, systems });
    },

    onS4Refresh() { this._loadS4(this._det().getProperty("/id"), true); },

    async onRetrySync() {
      this._det().setProperty("/retrying", true);
      try {
        await this._invoke("retrySync");
        this._toastSync();
      } catch (e) { MessageBox.error(e.message); }
      finally { this._det().setProperty("/retrying", false); this.byId("s4Refresh").focus(); } // the retry button just disappeared
    },

    /** Toast after approve/retry, telling the reviewer what happened in S/4. */
    _toastSync() {
      const ctx = this.getView().getBindingContext("review");
      const no = ctx.getProperty("applicationNo");
      if (ctx.getProperty("s4SyncStatus") === "SYNCED") MessageToast.show(this.getText("toast.registered", [no, ctx.getProperty("s4BusinessPartner")]));
      else MessageToast.show(this.getText("toast.syncFailed", [no]), { duration: 5000 });
    },

    /** Timeline = status history + comments, newest first. */
    async _loadActivity(id) {
      const model = this.getModel("review");
      const list = (path) => model.bindList(path, null, null, null, { $filter: `application_ID eq ${id}`, $orderby: "createdAt desc" })
        .requestContexts(0, 100).then((cs) => cs.map((c) => c.getObject())).catch(() => []);
      const [history, comments] = await Promise.all([list("/StatusHistory"), list("/Comments")]);
      const events = [
        ...history.map((h) => ({
          at: h.createdAt, who: h.createdBy, what: this.getText("det.history." + h.toStatus), text: h.note || "",
          icon: { SUBMITTED: "sap-icon://phosphor/paper-plane-tilt", IN_REVIEW: "sap-icon://phosphor/eye", APPROVED: "sap-icon://phosphor/seal-check", REGISTERED: "sap-icon://phosphor/plugs-connected",
            REJECTED: "sap-icon://phosphor/x-circle", CHANGES_REQUESTED: "sap-icon://phosphor/arrow-u-up-left" }[h.toStatus] || "sap-icon://phosphor/circle"
        })),
        ...comments.map((c) => ({
          at: c.createdAt, who: c.createdBy, what: this.getText("det.commented"), text: c.text, icon: "sap-icon://phosphor/chat-circle-text",
          scope: this.getText(c.visibility === "APPLICANT" ? "det.shared" : "det.internal")
        }))
      ].sort((a, b) => (a.at < b.at ? 1 : -1))
        .map((e) => ({ ...e, meta: [formatter.relative(e.at), e.scope].filter(Boolean).join(" · "),
          // isolate the (Latin) user id so the sentence takes the UI language's direction, not the user id's
          line: `\u2068${e.who}\u2069 ${e.what}` }));
      this._det().setProperty("/activity", events);
    },

    onClose() { this.navTo("inbox", {}, true); },

    // ---------------------------------------------------------------- actions

    async _invoke(action, params = {}) {
      const ctx = this.getView().getBindingContext("review");
      const op = this.getModel("review").bindContext(`ReviewService.${action}(...)`, ctx);
      Object.entries(params).forEach(([k, v]) => op.setParameter(k, v));
      await op.invoke();
      await ctx.requestSideEffects(["status_code", "status", "decidedAt", "assignedTo", "s4SyncStatus", "s4BusinessPartner", "s4SyncMessage",
        "s4SyncAttempts", "s4SyncedAt"]).catch(() => ctx.refresh());
      EventBus.getInstance().publish("tj", "queueChanged");
      this._loadActivity(this._det().getProperty("/id"));
      return ctx.getProperty("applicationNo");
    },

    async onStartReview() {
      try { await this._invoke("startReview"); MessageToast.show(this.getText("toast.started")); }
      catch (e) { MessageBox.error(e.message); }
    },

    onApprove() {
      this._confirm({
        title: "dlg.approve.title", text: "dlg.approve.text", inputLabel: "dlg.note", confirmType: "Emphasized",
        onConfirm: async (note) => {
          await this._invoke("approve", { note });
          this._toastSync();
        }
      });
    },

    /** Reject: ask for the reason, then a 5-second countdown with Undo before anything is sent. */
    onReject() {
      if (this._det().getProperty("/countdown") > 0) return this._cancelCountdown();
      this._confirm({
        title: "dlg.reject.title", text: "dlg.reject.text", inputLabel: "dlg.reason", required: true, confirmType: "Reject",
        onConfirm: (reason) => this._startCountdown(reason)
      });
    },

    _startCountdown(reason) {
      this._det().setProperty("/countdown", UNDO_SECONDS);
      this._timer = setInterval(async () => {
        const left = this._det().getProperty("/countdown") - 1;
        this._det().setProperty("/countdown", left);
        if (left > 0) return;
        clearInterval(this._timer);
        try {
          const no = await this._invoke("rejectApplication", { reason });
          MessageToast.show(this.getText("toast.rejected", [no]));
        } catch (e) { MessageBox.error(e.message); }
      }, 1000);
    },

    _cancelCountdown() { clearInterval(this._timer); this._det().setProperty("/countdown", 0); },

    onRequestChanges() {
      const fields = new MultiComboBox({
        width: "100%",
        items: FLAGGABLE.map((f) => new Item({ key: f, text: this._fieldLabel(f) }))
      });
      this._confirm({
        title: "dlg.changes.title", text: "dlg.changes.text", inputLabel: "dlg.message", required: true, confirmType: "Emphasized",
        extra: [new Label({ text: this.getText("dlg.fields") }), fields],
        onConfirm: async (note) => {
          const no = await this._invoke("requestChanges", { note, fields: fields.getSelectedKeys() });
          MessageToast.show(this.getText("toast.changes", [no]));
        }
      });
    },

    _fieldLabel(f) {
      const map = { categories: "f.categories", documents: "step.documents", contacts: "contacts.title" };
      return this.getText(map[f] || "f." + f);
    },

    /** Small reusable confirm dialog with one text input (optionally required, min. 10 chars). */
    _confirm({ title, text, inputLabel, required = false, confirmType, extra = [], onConfirm }) {
      const input = new TextArea({ width: "100%", rows: 3, growing: true, placeholder: required ? this.getText("dlg.min") : "" });
      const ok = new Button({
        text: this.getText("dlg.confirm"), type: confirmType, enabled: !required,
        press: async () => {
          ok.setEnabled(false);
          try { await onConfirm(input.getValue().trim()); dialog.close(); }
          catch (e) { MessageBox.error(e.message); ok.setEnabled(true); }
        }
      });
      input.attachLiveChange(() => ok.setEnabled(!required || input.getValue().trim().length >= MIN_REASON));
      const dialog = new Dialog({
        title: this.getText(title), contentWidth: "28rem",
        content: [new VBox({ items: [new Text({ text: this.getText(text) }).addStyleClass("tjMuted"), ...extra,
          new Label({ text: this.getText(inputLabel), required }), input], renderType: "Bare" }).addStyleClass("tjDialogBody")],
        beginButton: ok,
        endButton: new Button({ text: this.getText("dlg.cancel"), press: () => dialog.close() }),
        afterClose: () => dialog.destroy()
      });
      dialog.addStyleClass("tjDialog");
      this.getView().addDependent(dialog);
      dialog.open();
    },

    // ---------------------------------------------------------------- comments & documents

    async onPostComment() {
      const box = this.byId("comment");
      const text = box.getValue().trim();
      if (!text) return;
      await this._invoke("addComment", { text, visibility: this.byId("share").getSelected() ? "APPLICANT" : "INTERNAL" });
      box.setValue("");
      this.byId("share").setSelected(false);
    },

    /** Documents are protected: fetch with the user's auth, then show the blob in UI5's PDF viewer. */
    async onViewDoc(e) {
      const ctx = e.getSource().getBindingContext("review");
      const url = this.getModel("review").getServiceUrl() + `Documents(${ctx.getProperty("ID")})/content`;
      const res = await fetch(url, { headers: this.getOwnerComponent().getAuthHeaders() });
      if (!res.ok) return MessageBox.error(res.statusText);
      const blobUrl = URL.createObjectURL(await res.blob());
      if (!this._pdf) { this._pdf = new PDFViewer({ width: "auto", isTrustedSource: true }); this.getView().addDependent(this._pdf); }
      this._pdf.setSource(blobUrl);
      this._pdf.setTitle(ctx.getProperty("docType/name") + " · " + ctx.getProperty("fileName"));
      this._pdf.open();
    },

    onOpenDuplicate(e) { this.navTo("inbox", { id: e.getSource().getBindingContext("det").getProperty("ID") }, true); }
  });
});
