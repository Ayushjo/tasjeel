sap.ui.define(["sap/ui/core/Element"], function (Element) {
  "use strict";
  return Element.extend("tasjeel.portal.control.TabBarItem", {
    metadata: {
      properties: {
        key: { type: "string" },
        text: { type: "string" },
        icon: { type: "sap.ui.core.URI" },
        count: { type: "string", defaultValue: "" },
        visible: { type: "boolean", defaultValue: true }
      }
    }
  });
});
