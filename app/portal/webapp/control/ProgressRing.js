sap.ui.define(["sap/ui/core/Control"], function (Control) {
  "use strict";

  /** Small completion ring (0–100). Exposed to assistive tech as a progressbar. */
  return Control.extend("tasjeel.portal.control.ProgressRing", {
    metadata: {
      properties: {
        value: { type: "int", defaultValue: 0 },
        size: { type: "sap.ui.core.CSSSize", defaultValue: "2.75rem" }
      }
    },
    renderer: {
      apiVersion: 2,
      render(rm, ctl) {
        const v = Math.max(0, Math.min(100, ctl.getValue() || 0));
        const r = 18, c = 2 * Math.PI * r;
        rm.openStart("span", ctl).class("tjRing").style("width", ctl.getSize()).style("height", ctl.getSize())
          .attr("role", "progressbar").attr("aria-valuemin", "0").attr("aria-valuemax", "100").attr("aria-valuenow", String(v)).openEnd();
        rm.unsafeHtml(
          `<svg viewBox="0 0 44 44" width="100%" height="100%" aria-hidden="true">` +
          `<circle cx="22" cy="22" r="${r}" fill="none" class="tjRingTrack" stroke-width="4"/>` +
          `<circle cx="22" cy="22" r="${r}" fill="none" class="tjRingValue" stroke-width="4" stroke-linecap="butt"` +
          ` stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - v / 100)).toFixed(1)}" transform="rotate(-90 22 22)"/></svg>`
        );
        rm.close("span");
      }
    }
  });
});
