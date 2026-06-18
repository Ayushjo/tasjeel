sap.ui.define(["sap/ui/core/Control", "sap/ui/core/IconPool"], function (Control, IconPool) {
  "use strict";

  /**
   * Phone navigation: a fixed bottom tab bar (shown ≤ 760px via CSS). Items: tasjeel.portal.control.TabBarItem.
   * Fires "select" with the item's key; the App controller maps keys to routes.
   */
  return Control.extend("tasjeel.portal.control.TabBar", {
    metadata: {
      properties: { selectedKey: { type: "string", defaultValue: "" } },
      aggregations: { items: { type: "tasjeel.portal.control.TabBarItem", multiple: true } },
      defaultAggregation: "items",
      events: { select: { parameters: { key: { type: "string" } } } }
    },

    onclick(e) {
      const btn = e.target.closest("[data-key]");
      if (btn) this.fireSelect({ key: btn.dataset.key });
    },

    renderer: {
      apiVersion: 2,
      render(rm, ctl) {
        rm.openStart("nav", ctl).class("tjTabBar").attr("aria-label", "Main").openEnd();
        ctl.getItems().filter((i) => i.getVisible()).forEach((item) => {
          const on = item.getKey() === ctl.getSelectedKey();
          rm.openStart("button").class("tjTabBarItem").attr("type", "button").attr("data-key", item.getKey());
          if (on) rm.class("tjTabBarItemOn").attr("aria-current", "page");
          rm.openEnd();
          rm.icon(item.getIcon(), ["tjTabBarIcon"], { "aria-hidden": "true" });
          rm.openStart("span").class("tjTabBarText").openEnd().text(item.getText()).close("span");
          if (item.getCount()) rm.openStart("span").class("tjTabBarCount").openEnd().text(item.getCount()).close("span");
          rm.close("button");
        });
        rm.close("nav");
      }
    }
  });
});
