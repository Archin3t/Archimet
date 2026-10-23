/* Tiny SVG charts and Kismet RRD handling. No libraries. */

/* Kismet RRD vectors are ring buffers indexed by time; return them oldest → newest. */
export function rrdSeries(rrd, which = "minute") {
    if (!rrd || typeof rrd !== "object") return [];
    const vec = rrd[`kismet.common.rrd.${which}_vec`] || [];
    const n = vec.length;
    if (!n) return [];
    const last = Number(rrd["kismet.common.rrd.last_time"] || 0);
    const step = which === "minute" ? 1 : which === "hour" ? 60 : 3600;
    const slot = Math.floor(last / step) % n;
    const out = [];
    for (let i = 1; i <= n; i++) out.push(Number(vec[(slot + i) % n]) || 0);
    return out;
}

const NS = "http://www.w3.org/2000/svg";
function el(name, attrs) {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
}

export function sparkline(values, { width = 120, height = 28, cls = "spark", fill = true } = {}) {
    const s = el("svg", { viewBox: `0 0 ${width} ${height}`, class: cls, "aria-hidden": "true", preserveAspectRatio: "none" });
    if (!values.length) return s;
    const max = Math.max(...values, 1);
    const dx = width / Math.max(1, values.length - 1);
    const pts = values.map((v, i) => [i * dx, height - 1 - (v / max) * (height - 3)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    if (fill) s.append(el("path", { d: `${d} L${width} ${height} L0 ${height} Z`, class: "spark-fill" }));
    s.append(el("path", { d, class: "spark-line" }));
    return s;
}

/* Rate over the last `n` complete seconds (the newest slot is still filling). */
export function recentRate(series, n = 10) {
    const done = series.slice(0, -1).slice(-n);
    return done.length ? Math.round(done.reduce((a, b) => a + b, 0) / done.length) : 0;
}

/* Vertical bars with labels underneath, drawn at natural size (never scaled up past it). */
export function bars(items, { height = 180, cls = "bars", valueLabel = (v) => String(v) } = {}) {
    const w = Math.max(120, items.length * 40);
    const s = el("svg", { viewBox: `0 0 ${w} ${height + 28}`, width: w, height: height + 28, class: cls, role: "img" });
    const max = Math.max(...items.map(i => i.value), 1);
    const bw = w / Math.max(1, items.length);
    for (let g = 1; g <= 4; g++) {
        const y = height - (g / 4) * (height - 14);
        s.append(el("line", { x1: 0, x2: w, y1: y, y2: y, class: "bars-grid" }));
    }
    items.forEach((it, i) => {
        const bh = (it.value / max) * (height - 14);
        const x = i * bw + bw * 0.18;
        const r = el("rect", { x, y: height - bh, width: bw * 0.64, height: Math.max(bh, it.value ? 1 : 0), class: "bars-bar" + (it.cls ? " " + it.cls : "") });
        const t = el("title", {});
        t.textContent = `${it.label}: ${valueLabel(it.value)}`;
        r.append(t);
        s.append(r);
        const lab = el("text", { x: i * bw + bw / 2, y: height + 14, class: "bars-label", "text-anchor": "middle" });
        lab.textContent = it.label;
        s.append(lab);
        if (it.value) {
            const v = el("text", { x: i * bw + bw / 2, y: height - bh - 4, class: "bars-value", "text-anchor": "middle" });
            v.textContent = valueLabel(it.value);
            s.append(v);
        }
    });
    return s;
}
