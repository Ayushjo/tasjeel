sap.ui.define(["sap/ui/core/Control"], function (Control) {
  "use strict";

  /**
   * Square status tag: colour marker + text, never colour alone (accessibility).
   * status = ApplicationStatus code (DRAFT, SUBMITTED, IN_REVIEW, CHANGES_REQUESTED, APPROVED, REGISTERED, REJECTED).
   */
  const TONE = {
    DRAFT: "draft", SUBMITTED: "submitted", IN_REVIEW: "review", CHANGES_REQUESTED: "changes",
    APPROVED: "approved", REGISTERED: "approved", REJECTED: "rejected"
  };

  return Control.extend("tasjeel.portal.control.StatusTag", {
    metadata: {
      properties: {
        status: { type: "string", defaultValue: "DRAFT" },
        text: { type: "string", defaultValue: "" },
        /** Marker only (queue rows); the text stays available to screen readers. */
        dotOnly: { type: "boolean", defaultValue: false }
      }
    },
    renderer: {
      apiVersion: 2,
      render(rm, ctl) {
        rm.openStart("span", ctl).class("tjTag").class("tjTag-" + (TONE[ctl.getStatus()] || "draft"));
        if (ctl.getDotOnly()) rm.class("tjTagDot").attr("role", "img").attr("aria-label", ctl.getText() || ctl.getStatus());
        rm.openEnd();
        rm.openStart("span").class("tjTagMarker").attr("aria-hidden", "true").openEnd().close("span");
        if (!ctl.getDotOnly()) rm.text(ctl.getText() || ctl.getStatus());
        rm.close("span");
      }
    }
  });
});
