sap.ui.define(["sap/ui/core/format/DateFormat"], function (DateFormat) {
  "use strict";
  let rel; // cached formatter (in UI5 formatters, `this` is the control, not this module)
  const fill = (tpl, args) => String(tpl || "").replace(/\{(\d)\}/g, (_, i) => args[i] ?? "");
  return {
    /** "Welcome back, {0}" + value → text (keeps i18n placeholders in the bundle). */
    text(tpl, ...args) { return fill(tpl, args); },
    /** "AB" from "Al Bayan Co." */
    initials(name) { return (name || "").split(/\s+/).filter((w) => /^[\p{L}]/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join(""); },
    /** Reject button: "Undo · 4" while the countdown runs. */
    undo(n, tpl, label) { return n > 0 ? fill(tpl, [n]) : label; },
    docMeta(file, size, expiry) {
      const parts = [file, size && (size < 1024 ? "< 1 KB" : size < 1048576 ? Math.round(size / 1024) + " KB" : (size / 1048576).toFixed(1) + " MB"), expiry];
      return parts.filter(Boolean).join(" · ");
    },
    /** "{0} items left…" or the all-done text when nothing is open. */
    itemsLeft(tpl, n, done) { return n > 0 ? fill(tpl, [n]) : done; },
    /** Byte size → "412 KB" */
    bytes(n) { if (!n) return ""; if (n < 1024) return "< 1 KB"; return n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB"; },
    /** "SA0380000000608010167519" → "SA03 8000 0000 6080 1016 7519" */
    /** "2 hours ago" / "منذ ساعتين" (locale-aware, from UI5's CLDR data) */
    relative(v) {
      if (!v) return "";
      rel = rel || DateFormat.getDateTimeInstance({ relative: true, relativeScale: "auto", relativeStyle: "short" });
      return rel.format(new Date(v));
    },
    /** "Saturday, 10 October" / "السبت، 10 أكتوبر" (the argument only makes the binding re-evaluate on language change) */
    today() { return DateFormat.getDateInstance({ format: "MMMMEEEEd" }).format(new Date()); },
    date(v) { return v ? DateFormat.getDateInstance({ style: "medium" }).format(new Date(v)) : ""; },
    iban(v) { return (v || "").replace(/(.{4})/g, "$1 ").trim(); },
    /** Review page: only the first 8 and last 4 characters are shown. */
    ibanMasked(v) {
      if (!v) return "";
      const s = v.replace(/\s/g, "");
      return (s.slice(0, 4) + " " + s.slice(4, 8) + " •••• •••• •••• " + s.slice(-4)).trim();
    }
  };
});
