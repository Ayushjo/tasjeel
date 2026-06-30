sap.ui.define(["sap/ui/core/Control"], function (Control) {
  "use strict";
  /** Ten-segment risk meter; colour follows the level (Low / Medium / High), the number is shown next to it. */
  return Control.extend("tasjeel.portal.control.RiskBar", {
    metadata: { properties: { value: { type: "int", defaultValue: 0 }, level: { type: "string", defaultValue: "Low" } } },
    renderer: {
      apiVersion: 2,
      render(rm, ctl) {
        const on = Math.round(Math.max(0, Math.min(100, ctl.getValue() || 0)) / 10);
        rm.openStart("div", ctl).class("tjRiskBar").attr("data-level", ctl.getLevel() || "Low").attr("aria-hidden", "true").openEnd();
        for (let i = 0; i < 10; i++) rm.openStart("i").class(i < on ? "on" : "off").openEnd().close("i");
        rm.close("div");
      }
    }
  });
});
