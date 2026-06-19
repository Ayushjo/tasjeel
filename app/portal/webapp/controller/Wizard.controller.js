sap.ui.define([
  "./BaseController",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Messaging",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "../model/formatter"
], function (BaseController, JSONModel, Messaging, MessageToast, MessageBox, formatter) {
  "use strict";

  /** Wizard steps; `no` is the label in the rail (pre-registration is step 0, review has an eye icon). */
  const STEPS = ["pre", "profile", "address", "tax", "banking", "products", "documents", "declarations", "review"];
  const EDITABLE = ["DRAFT", "CHANGES_REQUESTED"];
  /** Server-derived fields re-read after a PATCH (OData V4 side effects). */
  const SIDE_EFFECTS = ["iban", "bankCode_code", "swift", "unifiedNo", "vatNumber", "legacyCrNo", "gosiNo", "postalCode", "buildingNo", "additionalNo", "shortAddress"];
  /** "Something is missing" findings: shown only after the user tries to leave the step. Format errors show immediately. */
  const MISSING = new Set(["REQUIRED", "DECLARATION_REQUIRED", "CONTACT_REQUIRED", "SIGNATORY_REQUIRED", "ONE_PRIMARY_CONTACT", "CATEGORY_REQUIRED", "DOCUMENT_MISSING", "VAT_OR_REASON"]);
  const MAX_BYTES = 5 * 1024 * 1024;
  const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg"];

  return BaseController.extend("tasjeel.portal.controller.Wizard", {
    formatter,

    onInit() {
      this.getView().setModel(new JSONModel({
        state: "loading", step: "pre", stepIndex: 0, steps: [], errors: {}, open: [], openCount: 0, percent: 0,
        saving: "saved", bank: {}, docs: [], categoryKeys: [], attempted: {}, submitting: false
      }), "wiz");
      this.getRouter().getRoute("wizard").attachPatternMatched(this._onMatched, this);
    },

    _wiz() { return this.getView().getModel("wiz"); },

    // ---------------------------------------------------------------- draft lifecycle

    async _onMatched(e) {
      const step = STEPS.includes(e.getParameter("arguments").step) ? e.getParameter("arguments").step : null;
      if (!this._ctx) await this._openDraft();
      if (this._wiz().getProperty("/state") !== "edit") return;
      this._showStep(step || this._firstOpenStep() || "pre");
    },

    /** Finds the supplier's draft, or creates one, or turns an editable active application into a draft. */
    async _openDraft() {
      const model = this.getModel();
      this._wiz().setProperty("/state", "loading");
      try {
        const list = model.bindList("/Applications", null, null, null, {
          $filter: "IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null",
          $select: "ID,IsActiveEntity,status_code,applicationNo,HasDraftEntity",
          $expand: "status($select=name)"
        });
        let [ctx] = await list.requestContexts(0, 1);

        if (!ctx) {
          ctx = model.bindList("/Applications").create({});
          await ctx.created();
        } else if (ctx.getProperty("IsActiveEntity")) {
          const status = ctx.getProperty("status_code");
          if (!EDITABLE.includes(status)) {
            this._wiz().setProperty("/appNo", ctx.getProperty("applicationNo"));
            this._wiz().setProperty("/statusName", ctx.getProperty("status/name"));
            this._wiz().setProperty("/state", "locked");
            return;
          }
          const edit = model.bindContext("ApplicantService.draftEdit(...)", ctx, { $$inheritExpandSelect: true });
          edit.setParameter("PreserveChanges", true);
          ctx = await edit.invoke();
        }
        this._bindDraft(ctx.getPath());
        this._wiz().setProperty("/state", "edit");
        await Promise.all([this._loadChildren(), this._refreshRequirements(), this._loadReviewerNote().catch(() => {})]);
      } catch (err) {
        this._wiz().setProperty("/state", "locked");
        MessageBox.error(err.message);
      }
    },

    _bindDraft(path) {
      this.getView().bindElement({ path, parameters: { $$updateGroupId: "$auto" } });
      const binding = this.getView().getElementBinding();
      this._ctx = binding.getBoundContext();
      // Autosave feedback: every field change is a PATCH on the draft.
      binding.attachPatchSent(() => this._wiz().setProperty("/saving", "saving"));
      binding.attachPatchCompleted((ev) => {
        const ok = ev.getParameter("success");
        this._wiz().setProperty("/saving", ok ? "saved" : "error");
        if (ok) this._afterSave();
      });
      binding.attachDataReceived(() => this._ctx = binding.getBoundContext());
    },

    _afterSave() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(async () => {
        const ctx = this.getView().getBindingContext();
        // Normalized identifiers + bank code/SWIFT are computed on the server: read them back.
        await ctx.requestSideEffects(SIDE_EFFECTS).catch(() => {});
        this._refreshRequirements();
      }, 350);
    },

    // ---------------------------------------------------------------- requirements panel

    /** One rule engine on the server feeds this panel, the step badges, field errors and activation. */
    async _refreshRequirements() {
      const ctx = this.getView().getBindingContext();
      if (!ctx) return;
      const fn = this.getModel().bindContext(ctx.getPath() + "/ApplicantService.requirements()");
      const res = await fn.requestObject().catch(() => null);
      if (!res) return;
      this._findings = res.items || [];
      const attempted = this._wiz().getProperty("/attempted");
      const errors = {};
      this._findings.forEach((f) => {
        // Show "required" only after the user tried to leave the step; format errors immediately.
        if (!MISSING.has(f.code) || attempted[f.step]) errors[f.field] = errors[f.field] || f.message;
      });
      const open = this._findings.filter((f) => f.severity === "error").map((f) => ({
        ...f, stepTitle: this.getText("step." + f.step), bad: !MISSING.has(f.code)
      }));
      this._wiz().setProperty("/errors", errors);
      this._wiz().setProperty("/open", open.slice(0, 8));
      this._wiz().setProperty("/openCount", open.length);
      this._wiz().setProperty("/percent", res.percent);
      this._renderRail();
    },

    _firstOpenStep() {
      const f = (this._findings || []).find((x) => x.severity === "error");
      return f ? f.step : "review";
    },

    _renderRail() {
      const current = this._wiz().getProperty("/step");
      const attempted = this._wiz().getProperty("/attempted");
      const count = (s) => (this._findings || []).filter((f) => f.step === s && f.severity === "error").length;
      this._wiz().setProperty("/steps", STEPS.map((key, i) => ({
        key, title: this.getText("step." + key), no: String(i).padStart(2, "0"),
        errors: count(key), shown: !!attempted[key],
        state: key === current ? "current" : (key !== "review" && count(key) === 0 && i < STEPS.indexOf(current) ? "done" : "todo")
      })));
    },

    _showStep(step) {
      const i = STEPS.indexOf(step);
      const next = STEPS[i + 1];
      Object.entries({
        step, stepIndex: i, stepNo: i,
        stepTitle: this.getText("step." + step), h1: this.getText("h1." + step), lead: this.getText("lead." + step),
        eyebrow: i > 0 && i < 8 ? `${this.getText("wiz.stepOf", [i])} · ${this.getText("step." + step)}` : this.getText("step." + step),
        nextText: next === "review" ? this.getText("wiz.toReview") : next ? this.getText("wiz.next", [this.getText("step." + next)]) : ""
      }).forEach(([k, v]) => this._wiz().setProperty("/" + k, v));
      this._renderRail();
      if (step === "documents") this._loadChildren();
      if (step === "banking") {
        const ctx = this.getView().getBindingContext();
        ctx?.requestProperty("iban").then((iban) => iban && this._lookupIban(iban));
      }
      this.byId("formScroll")?.scrollTo(0, 0, 0);
    },

    // ---------------------------------------------------------------- navigation

    onStepPress(e) { this.navTo("wizard", { step: e.getSource().getBindingContext("wiz").getProperty("key") }, true); },
    onNeedPress(e) { this.navTo("wizard", { step: e.getSource().getBindingContext("wiz").getProperty("step") }, true); },
    onChangeStep(e) { this.navTo("wizard", { step: e.getSource().data("step") }, true); },
    onBack() { const i = this._wiz().getProperty("/stepIndex"); if (i > 0) this.navTo("wizard", { step: STEPS[i - 1] }, true); },

    async onNext() {
      const step = this._wiz().getProperty("/step");
      await this.getModel().submitBatch("$auto");
      this._wiz().setProperty("/attempted/" + step, true);
      await this._refreshRequirements();
      const blocking = (this._findings || []).filter((f) => f.step === step && f.severity === "error");
      if (blocking.length) { MessageToast.show(this.getText("wiz.fixStep")); return; }
      this.navTo("wizard", { step: STEPS[STEPS.indexOf(step) + 1] }, true);
    },

    async onExit() {
      await this.getModel().submitBatch("$auto");
      this.navTo("home");
    },

    // ---------------------------------------------------------------- field helpers

    onSupplierType(e) {
      this._wiz().setProperty("/supplierType", e.getParameter("key"));
      this.getView().getBindingContext().setProperty("supplierType_code", e.getParameter("key"));
    },
    onCurrency(e) {
      this._wiz().setProperty("/currency", e.getParameter("key"));
      this.getView().getBindingContext().setProperty("paymentCurrency_code", e.getParameter("key"));
    },

    /**
     * IBAN: live bank lookup while typing; save + group into blocks of 4 when the field is left.
     * (Never setValue() while typing: it resets Input's "last value", so `change` would not fire.)
     */
    onIbanLive(e) {
      const compact = (e.getParameter("value") || "").replace(/[\s-]/g, "").toUpperCase();
      clearTimeout(this._ibanTimer);
      this._ibanTimer = setTimeout(() => this._lookupIban(compact), 250);
    },
    onIbanChange(e) {
      const compact = (e.getParameter("value") || "").replace(/[\s-]/g, "").toUpperCase();
      this.getView().getBindingContext().setProperty("iban", compact);
      e.getSource().setValue(formatter.iban(compact));
    },
    async _lookupIban(iban) {
      if (iban.length < 6) { this._wiz().setProperty("/bank", {}); return; }
      const fn = this.getModel().bindContext("/lookupIban(...)");
      fn.setParameter("iban", iban);
      const res = await fn.invoke().then(() => fn.getBoundContext().getObject()).catch(() => null);
      this._wiz().setProperty("/bank", res && res.bankName ? { name: res.bankName, code: res.bankCode, swift: res.swift } : {});
    },

    // ---------------------------------------------------------------- compositions: contacts, categories, documents

    async _loadChildren() {
      const ctx = this.getView().getBindingContext();
      if (!ctx) return;
      const model = this.getModel();
      this._cats = model.bindList("categories", ctx, null, null, { $$updateGroupId: "$auto" });
      this._docs = model.bindList("documents", ctx, null, null, {
        $select: "ID,docType_code,fileName,mediaType,size,expiryDate", $$updateGroupId: "$auto"
      });
      const typeFilter = await ctx.requestProperty("supplierType_code");
      this._wiz().setProperty("/supplierType", typeFilter || "");
      this._wiz().setProperty("/currency", (await ctx.requestProperty("paymentCurrency_code")) || "SAR");
      const [cats, docs, types] = await Promise.all([
        this._cats.requestContexts(0, 100),
        this._docs.requestContexts(0, 100),
        model.bindList("/DocumentTypes").requestContexts(0, 50)
      ]);
      this._wiz().setProperty("/categoryKeys", cats.map((c) => c.getProperty("category_code")));
      const byType = Object.fromEntries(docs.map((d) => [d.getProperty("docType_code"), d]));
      const rows = types.map((t) => t.getObject())
        .filter((t) => (t.requiredFor || "").split(",").includes(typeFilter) || byType[t.code] || ["ISO_CERT", "OTHER"].includes(t.code))
        .map((t) => {
          const d = byType[t.code];
          return {
            code: t.code, name: t.name, hasExpiry: t.hasExpiry,
            required: (t.requiredFor || "").split(",").includes(typeFilter),
            fileName: d?.getProperty("fileName") || "", sizeText: formatter.bytes(d?.getProperty("size")),
            expiryDate: d?.getProperty("expiryDate") || null, ctxPath: d?.getPath() || null, uploading: false
          };
        })
        .sort((a, b) => Number(b.required) - Number(a.required));
      this._wiz().setProperty("/docs", rows);
      const uploaded = rows.filter((r) => r.fileName).length;
      this._wiz().setProperty("/docsUploaded", `${uploaded} / ${rows.filter((r) => r.required).length}`);
    },

    async onAddContact() {
      const binding = this.byId("contacts").getBinding("items");
      const first = binding.getLength() === 0;
      binding.create({ isPrimary: first, isSignatory: first }, true);
    },
    onDeleteContact(e) { e.getSource().getBindingContext().delete("$auto"); },
    /** Exactly one primary contact: ticking one clears the others. */
    onPrimary(e) {
      if (!e.getParameter("selected")) return;
      const me = e.getSource().getBindingContext();
      this.byId("contacts").getItems().map((i) => i.getBindingContext()).filter((c) => c !== me && c.getProperty("isPrimary"))
        .forEach((c) => c.setProperty("isPrimary", false));
    },

    async onCategories(e) {
      const wanted = new Set(e.getSource().getSelectedKeys());
      const current = this._cats.getCurrentContexts();
      const have = new Set(current.map((c) => c.getProperty("category_code")));
      current.filter((c) => !wanted.has(c.getProperty("category_code"))).forEach((c) => c.delete("$auto"));
      [...wanted].filter((k) => !have.has(k)).forEach((k) => this._cats.create({ category_code: k }, true));
      await this.getModel().submitBatch("$auto");
      this._refreshRequirements();
    },

    /** Upload = create the Documents row in the draft, then PUT the binary to its media property. */
    onUploadPress(e) {
      const row = e.getSource().getBindingContext("wiz");
      const input = Object.assign(document.createElement("input"), { type: "file", accept: FILE_TYPES.join(",") });
      input.onchange = () => input.files[0] && this._upload(row, input.files[0]);
      input.click();
    },

    async _upload(row, file) {
      if (!FILE_TYPES.includes(file.type)) return MessageBox.error(this.getText("docs.hint"));
      if (file.size > MAX_BYTES) return MessageBox.error(this.getText("docs.hint"));
      const path = row.getPath();
      this._wiz().setProperty(path + "/uploading", true);
      try {
        let docPath = row.getProperty("ctxPath");
        if (!docPath) {
          const created = this._docs.create({ docType_code: row.getProperty("code"), fileName: file.name, mediaType: file.type, size: file.size }, true);
          await created.created();
          docPath = created.getPath();
        } else {
          const ctx = this._docs.getCurrentContexts().find((c) => c.getPath() === docPath);
          ctx.setProperty("fileName", file.name); ctx.setProperty("mediaType", file.type); ctx.setProperty("size", file.size);
          await this.getModel().submitBatch("$auto");
        }
        const url = this.getModel().getServiceUrl() + docPath.slice(1) + "/content";
        const res = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type, ...(await this.getOwnerComponent().getWriteHeaders()) } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || res.statusText);
        MessageToast.show(file.name);
      } catch (err) {
        MessageBox.error(err.message);
      }
      await this._loadChildren();
      this._refreshRequirements();
    },

    async onDeleteDoc(e) {
      const docPath = e.getSource().getBindingContext("wiz").getProperty("ctxPath");
      const ctx = this._docs.getCurrentContexts().find((c) => c.getPath() === docPath);
      if (ctx) await ctx.delete("$auto");
      await this._loadChildren();
      this._refreshRequirements();
    },

    async onDocExpiry(e) {
      const row = e.getSource().getBindingContext("wiz");
      const ctx = this._docs.getCurrentContexts().find((c) => c.getPath() === row.getProperty("ctxPath"));
      if (ctx) { ctx.setProperty("expiryDate", e.getParameter("value") || null); await this.getModel().submitBatch("$auto"); }
      this._refreshRequirements();
    },

    // ---------------------------------------------------------------- reviewer feedback

    /** The reviewer's latest shared message, shown only while their requested changes are open. */
    async _loadReviewerNote() {
      const ctx = this.getView().getBindingContext();
      const id = ctx && (ctx.getProperty("ID") || (await ctx.requestProperty("ID")));
      const status = ctx && (await ctx.requestProperty("status_code"));
      if (!id || status !== "CHANGES_REQUESTED") return this._wiz().setProperty("/reviewerNote", "");
      const list = this.getModel().bindList("/Comments", null, null, null, { $filter: `application_ID eq ${id}`, $orderby: "createdAt desc" });
      const [last] = await list.requestContexts(0, 1).catch(() => []);
      this._wiz().setProperty("/reviewerNote", last ? last.getProperty("text") : "");
    },

    // ---------------------------------------------------------------- submit

    /** draftActivate (server validates everything) → submit() (number, risk, history). */
    async onSubmit() {
      const model = this.getModel();
      this._wiz().setProperty("/submitting", true);
      await model.submitBatch("$auto");
      Messaging.removeAllMessages();
      try {
        const draft = this.getView().getBindingContext();
        const activate = model.bindContext("ApplicantService.draftActivate(...)", draft, { $$inheritExpandSelect: true });
        const active = await activate.invoke();
        const submit = model.bindContext("ApplicantService.submit(...)", active);
        await submit.invoke();
        const result = submit.getBoundContext().getObject();
        this._wiz().setProperty("/appNo", result.applicationNo);
        this._wiz().setProperty("/state", "done");
        this.getView().unbindElement();
        this._ctx = null;
      } catch (err) {
        // The server returned one message per field: show them where they belong.
        STEPS.forEach((s) => this._wiz().setProperty("/attempted/" + s, true));
        await this._refreshRequirements();
        Messaging.removeAllMessages();
        MessageToast.show(this.getText("wiz.fixStep"));
        this.navTo("wizard", { step: this._firstOpenStep() }, true);
      } finally {
        this._wiz().setProperty("/submitting", false);
      }
    }
  });
});
