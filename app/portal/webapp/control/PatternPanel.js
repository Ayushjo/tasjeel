sap.ui.define(["sap/ui/core/Control"], function (Control) {
  "use strict";

  /**
   * Deep-teal brand panel with a fine-line eight-point-star lattice (Gulf geometric motif),
   * drawn as SVG so it stays crisp and themable. Hosts arbitrary content.
   */
  const LATTICE =
    '<svg class="tjLattice" viewBox="0 0 400 600" preserveAspectRatio="xMaxYMid slice" aria-hidden="true"><defs>' +
    '<pattern id="tjStar" width="80" height="80" patternUnits="userSpaceOnUse"><g fill="none" stroke="currentColor" stroke-width="1">' +
    '<path d="M40 8 L48 32 L72 40 L48 48 L40 72 L32 48 L8 40 L32 32 Z"/>' +
    '<path d="M17 17 L40 26 L63 17 L54 40 L63 63 L40 54 L17 63 L26 40 Z"/>' +
    '<path d="M0 0 L8 40 L0 80 M80 0 L72 40 L80 80 M0 0 L40 8 L80 0 M0 80 L40 72 L80 80"/></g></pattern>' +
    '<linearGradient id="tjFade" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".55" stop-color="#fff" stop-opacity="1"/></linearGradient>' +
    '<mask id="tjMask"><rect width="400" height="600" fill="url(#tjFade)"/></mask></defs>' +
    '<rect width="400" height="600" fill="url(#tjStar)" mask="url(#tjMask)"/></svg>';

  return Control.extend("tasjeel.portal.control.PatternPanel", {
    metadata: {
      aggregations: { content: { type: "sap.ui.core.Control", multiple: true } },
      defaultAggregation: "content"
    },
    renderer: {
      apiVersion: 2,
      render(rm, ctl) {
        rm.openStart("section", ctl).class("tjPatternPanel").openEnd();
        rm.unsafeHtml(LATTICE);
        rm.openStart("div").class("tjPatternPanelContent").openEnd();
        ctl.getContent().forEach((c) => rm.renderControl(c));
        rm.close("div");
        rm.close("section");
      }
    }
  });
});
