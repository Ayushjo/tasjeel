sap.ui.define(["sap/ui/core/Control"], function (Control) {
  "use strict";

  /**
   * Minimal, on-brand charts drawn as SVG/HTML:
   *  - "bars":  vertical bars (weekly volume), latest bar labelled
   *  - "hbars": horizontal bars with labels + values (top categories)
   *  - "stack": one stacked bar + legend (status breakdown; colour + text, never colour alone)
   * Charts stay left-to-right in Arabic (numbers/time axes are not mirrored).
   * data: [{ label, value, color?, key? }]
   */
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  return Control.extend("tasjeel.portal.control.Chart", {
    metadata: {
      properties: {
        type: { type: "string", defaultValue: "bars" },
        data: { type: "object", defaultValue: [] },
        height: { type: "sap.ui.core.CSSSize", defaultValue: "13rem" },
        ariaLabel: { type: "string", defaultValue: "" }
      }
    },

    renderer: {
      apiVersion: 2,
      render(rm, ctl) {
        const data = ctl.getData() || [];
        rm.openStart("div", ctl).class("tjChart").class("tjChart-" + ctl.getType()).attr("dir", "ltr")
          .attr("role", "img").attr("aria-label", ctl.getAriaLabel() + ": " + data.map((d) => `${d.label} ${d.value}`).join(", "));
        if (ctl.getType() === "bars") rm.style("height", ctl.getHeight());
        rm.openEnd();
        const html = { bars: barsHtml, hbars: hbarsHtml, stack: stackHtml }[ctl.getType()] || barsHtml;
        rm.unsafeHtml(html(data));
        rm.close("div");
      }
    }
  });

  function barsHtml(data) {
    if (!data.length) return "";
    const W = 600, H = 200, padB = 22, padL = 26;
    const max = Math.max(5, ...data.map((d) => d.value));
    const top = Math.ceil(max / 5) * 5;
    const step = (W - padL) / data.length, bw = Math.min(34, step * 0.55);
    const y = (v) => (H - padB) * (1 - v / top);
    let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="100%">`;
    [0, top / 2, top].forEach((v) => {
      s += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="tjGrid"/>`;
      s += `<text x="0" y="${y(v) + 4}" class="tjAxis">${v}</text>`;
    });
    data.forEach((d, i) => {
      const x = padL + step * i + (step - bw) / 2, h = (H - padB) - y(d.value), r = 2;
      const last = i === data.length - 1;
      s += `<g class="tjBar${last ? " tjBarLast" : ""}"><title>${esc(d.label)}: ${d.value}</title>` +
        `<rect x="${x - (step - bw) / 2}" y="0" width="${step}" height="${H - padB}" class="tjHit"/>` +
        (h > 0 ? `<path d="M${x},${H - padB} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + bw - r} Q${x + bw},${y(d.value)} ${x + bw},${y(d.value) + r} V${H - padB} Z"/>` : "") +
        `<text x="${x + bw / 2}" y="${H - 6}" class="tjAxis" text-anchor="middle">${esc(d.label)}</text>` +
        (last ? `<text x="${x + bw / 2}" y="${y(d.value) - 6}" class="tjBarValue" text-anchor="middle">${d.value}</text>` : "") + `</g>`;
    });
    return s + "</svg>";
  }

  function hbarsHtml(data) {
    const max = Math.max(1, ...data.map((d) => d.value));
    return data.map((d) => `<div class="tjHbar" title="${esc(d.label)}: ${d.value}"><span class="tjHbarLabel">${esc(d.label)}</span>` +
      `<span class="tjHbarTrack"><i style="width:${(d.value / max) * 100}%"></i></span><span class="tjHbarValue">${d.value}</span></div>`).join("");
  }

  function stackHtml(data) {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const bar = `<div class="tjStack">${data.filter((d) => d.value).map((d) =>
      `<i style="width:${(d.value / total) * 100}%;background:${d.color}" title="${esc(d.label)}: ${d.value}"></i>`).join("")}</div>`;
    const legend = `<div class="tjLegend">${data.map((d) =>
      `<div><span class="tjSwatch" style="background:${d.color}"></span><span class="tjLegendLabel">${esc(d.label)}</span><b>${d.value}</b></div>`).join("")}</div>`;
    return bar + legend;
  }
});
