// SPDX-License-Identifier: GPL-2.0-or-later
/* Small, dependency-free helpers. All text goes in through textContent; no innerHTML with data. */

export function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "style" && typeof v === "object") {
            for (const [p, val] of Object.entries(v)) {
                if (p.startsWith("--")) el.style.setProperty(p, val);
                else el.style[p] = val;
            }
        }
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "html") el.innerHTML = v;          // only for our own static SVG/markup
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, String(v));
    }
    for (const kid of kids.flat(Infinity)) {
        if (kid == null || kid === false) continue;
        el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function svg(markup) {
    const t = document.createElement("template");
    t.innerHTML = markup.trim();
    return t.content.firstElementChild;
}

/* ---- MACs */

export function macHex(s) { return String(s == null ? "" : s).toUpperCase().replace(/[^0-9A-F]/g, ""); }

export function macColon(s) {
    const h = macHex(s);
    return h.length === 12 ? h.match(/../g).join(":") : "";
}

/* A search term that looks like a MAC (any separator / case) -> the colon form Kismet matches. */
export function macSearch(term) {
    const t = String(term == null ? "" : term).trim();
    if (!t || /^[0-9a-f]+$/i.test(t)) return t;
    if (!/^[0-9a-f]{1,4}([-.: ][0-9a-f]{1,4})+$/i.test(t)) return t;
    const parts = t.split(/[-.: ]/);
    const hx = macHex(t);
    if (parts.every(p => p.length === 2)) return parts.join(":").toUpperCase();
    if (hx.length % 2 === 0 && hx.length <= 12) return hx.match(/../g).join(":");
    return t;
}

export function isRandomized(mac) {
    const first = parseInt(macHex(mac).slice(0, 2), 16);
    return !Number.isNaN(first) && (first & 0x02) !== 0;
}

/* ---- time */

/* Ages are measured on Kismet's clock (the times being compared come from Kismet), so every
 * screen agrees. The hub sets the offset from each Kismet status reply; 0 until then. */
let clockOffset = 0;
export function setClockOffset(sec) { if (Number.isFinite(sec)) clockOffset = sec; }
export function serverNow() { return Date.now() / 1000 + clockOffset; }

export function relTime(epoch, now = serverNow()) {
    if (!epoch) return "—";
    const s = Math.max(0, Math.round(now - epoch));
    if (s < 5) return "now";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

export function absTime(epoch) {
    if (!epoch) return "—";
    const d = new Date(epoch * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function duration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${hh}h`;
    if (hh) return `${hh}h ${m}m`;
    return `${m}m ${sec % 60}s`;
}

/* Logger timestamps are local "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD". */
export function parseLocal(s) {
    const m = /^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d):(\d\d))?$/.exec(String(s || ""));
    if (!m) return 0;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime() / 1000;
}

/* ---- numbers */

export function bytes(n) {
    n = Number(n) || 0;
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

export function num(n) { return (Number(n) || 0).toLocaleString(); }

/* 802.11 channel from a frequency in kHz (Kismet's unit). */
export function channelOf(khz) {
    const mhz = Math.round((Number(khz) || 0) / 1000);
    if (mhz === 2484) return "14";
    if (mhz >= 2412 && mhz <= 2472) return String((mhz - 2407) / 5);
    if (mhz >= 5000 && mhz <= 5900) return String((mhz - 5000) / 5);
    if (mhz >= 5955 && mhz <= 7115) return "6G " + String((mhz - 5950) / 5);
    return "";
}

export function debounce(fn, ms) {
    let t = 0;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* Request order: responses can arrive out of order (a slow search for "ab" after the one for
 * "abc"). Each request takes gate.next(); only gate.current(token) may change the screen. */
export function requestGate() {
    let n = 0;
    return { next: () => ++n, current: (t) => t === n };
}

export function get(obj, path, dflt) {
    let cur = obj;
    for (const k of path) {
        if (cur == null || typeof cur !== "object") return dflt;
        cur = cur[k];
    }
    return cur == null ? dflt : cur;
}
