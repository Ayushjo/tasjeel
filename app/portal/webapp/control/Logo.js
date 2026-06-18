sap.ui.define(["sap/ui/core/Control"], function (Control) {
  "use strict";

  /**
   * Tasjeel mark: a Latin "T" whose bar carries the two dots of Arabic "ت", so it reads in both scripts.
   * Colours come from CSS custom properties, so it follows light/dark themes and can be inverted.
   */
  return Control.extend("tasjeel.portal.control.Logo", {
    metadata: {
      properties: {
        size: { type: "sap.ui.core.CSSSize", defaultValue: "1.5rem" },
        inverted: { type: "boolean", defaultValue: false }
      }
    },
    renderer: {
      apiVersion: 2,
      render(rm, ctl) {
        rm.openStart("span", ctl).class("tjLogo");
        if (ctl.getInverted()) rm.class("tjLogoInverted");
        rm.style("width", ctl.getSize()).style("height", ctl.getSize());
        rm.attr("role", "img").attr("aria-label", "Tasjeel");
        rm.openEnd();
        rm.unsafeHtml(
          '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
          '<rect width="24" height="24" rx="3" class="tjLogoBg"/>' +
          '<g class="tjLogoFg"><rect x="6" y="10" width="12" height="2.6"/><rect x="10.7" y="10" width="2.6" height="8.5"/>' +
          '<rect x="8.6" y="5.4" width="2.4" height="2.4"/><rect x="13" y="5.4" width="2.4" height="2.4"/></g></svg>'
        );
        rm.close("span");
      }
    }
  });
});
