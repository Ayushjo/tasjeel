sap.ui.define(["sap/ui/core/Control", "sap/ui/events/KeyCodes"], function (Control, KeyCodes) {
  "use strict";

  /**
   * Large selectable card that behaves like a radio button (role="radio", Space/Enter to select).
   * Used for supplier type and payment currency: bigger targets than a radio group, with a description line.
   */
  return Control.extend("tasjeel.portal.control.ChoiceCard", {
    metadata: {
      properties: {
        key: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        icon: { type: "sap.ui.core.URI", defaultValue: "" },
        selected: { type: "boolean", defaultValue: false }
      },
      events: { select: { parameters: { key: { type: "string" } } } }
    },

    _choose() { if (!this.getSelected()) this.fireSelect({ key: this.getKey() }); },
    onclick() { this._choose(); },
    onkeydown(e) { if (e.which === KeyCodes.SPACE || e.which === KeyCodes.ENTER) { e.preventDefault(); this._choose(); } },

    renderer: {
      apiVersion: 2,
      render(rm, ctl) {
        rm.openStart("div", ctl).class("tjChoice");
        if (ctl.getSelected()) rm.class("tjChoiceOn");
        rm.attr("role", "radio").attr("aria-checked", String(ctl.getSelected())).attr("tabindex", "0").openEnd();
        rm.openStart("span").class("tjChoiceRadio").attr("aria-hidden", "true").openEnd().close("span");
        rm.openStart("span").class("tjChoiceBody").openEnd();
        rm.openStart("span").class("tjChoiceTitle").openEnd();
        if (ctl.getIcon()) rm.icon(ctl.getIcon(), ["tjChoiceIcon"], { "aria-hidden": "true" });
        rm.text(ctl.getTitle()).close("span");
        if (ctl.getDescription()) rm.openStart("span").class("tjChoiceDesc").openEnd().text(ctl.getDescription()).close("span");
        rm.close("span");
        rm.close("div");
      }
    }
  });
});
