// SPDX-License-Identifier: GPL-2.0-or-later
/* User-resizable layout: table columns (drag a header's right edge), the sidebar, and split panes.
 * Widths are saved per browser (prefs.layout); Settings › Appearance › Reset layout clears them.
 * Every handle is a focusable separator: Left / Right move 16 px, Home restores the default.
 * Handles are hidden on phone / tablet layouts (CSS), where the layouts are fixed. */

import { h } from "../lib/util.js";
import { prefsGet, prefsReplace } from "../lib/store.js";

const STEP = 16;
const saved = (key) => ((prefsGet().layout || {})[key]) || {};
// prefsSet merges only keys the defaults already have, so it would drop every new layout key:
// layout is written whole.
const prefsReplaceLayout = (key, value) => prefsReplace("layout", { ...(prefsGet().layout || {}), [key]: value });
const save = prefsReplaceLayout;

/* A separator that reports horizontal moves (px) and saves on release. */
function grip({ label, now, set, reset, commit, cls = "grip" }) {
    const g = h("span", { class: cls, role: "separator", tabindex: "0", "aria-orientation": "vertical", "aria-label": label, title: label });
    const sync = () => g.setAttribute("aria-valuenow", String(Math.round(now())));
    g.addEventListener("click", (e) => e.stopPropagation());            // never sorts / opens the row under it
    g.addEventListener("focus", sync);                                   // the rendered width is known only once placed
    g.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const x0 = e.clientX, w0 = now();
        g.setPointerCapture(e.pointerId);
        document.body.classList.add("resizing");
        const move = (ev) => { set(w0 + ev.clientX - x0); sync(); };
        const up = () => { g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up);
            g.removeEventListener("pointercancel", up); document.body.classList.remove("resizing"); commit(); };
        g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
    });
    g.addEventListener("dblclick", (e) => { e.stopPropagation(); reset(); sync(); commit(); });
    g.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowLeft" ? -STEP : e.key === "ArrowRight" ? STEP : 0;
        if (d) { e.preventDefault(); e.stopPropagation(); set(now() + d); sync(); commit(); }
        else if (e.key === "Home") { e.preventDefault(); e.stopPropagation(); reset(); sync(); commit(); }
    });
    sync();
    return g;
}

/* Resizable columns for a CSS-grid table (header + rows share `--cols` on `container`).
 * cols: [{ id, label, w, min, flex }] in display order; `flex` columns also grow (minmax(w, 1fr)). */
export function gridColumns(key, cols, container, onApply = null) {
    const s = saved(key);
    const widths = Object.fromEntries(cols.map(c => [c.id, Math.max(c.min, Number(s[c.id]) || c.w)]));
    // A flexible column stays flexible until the user sizes it; from then on it has exactly that width
    // (otherwise a drag would only move its minimum, invisible on a wide screen). Reset makes it flexible again.
    const sized = new Set(cols.filter(c => Number(s[c.id])).map(c => c.id));
    const template = () => cols.map(c => c.flex && !sized.has(c.id) ? `minmax(${widths[c.id]}px, ${c.flex}fr)` : `${widths[c.id]}px`).join(" ");
    // onApply(widths): for an HTML <table> (column elements) instead of a CSS grid.
    const apply = () => (onApply ? onApply(widths) : container.style.setProperty("--cols", template()));
    apply();
    return {
        template,
        /* The grip for one header cell. */
        grip: (id) => {
            const c = cols.find(x => x.id === id);
            let el = null;
            // The width the user sees: a flexible column is usually wider than its stored minimum.
            const shown = () => (!sized.has(id) && el && el.parentElement ? Math.round(el.parentElement.getBoundingClientRect().width) : 0) || widths[id];
            el = grip({ label: `Resize the ${c.label} column`, now: shown,
                set: (w) => { sized.add(id); widths[id] = Math.max(c.min, Math.min(1200, Math.round(w))); apply(); },
                reset: () => { sized.delete(id); widths[id] = c.w; apply(); },
                commit: () => {
                    const next = { ...saved(key) };
                    if (sized.has(id)) next[id] = widths[id]; else delete next[id];
                    prefsReplaceLayout(key, next);
                } });
            return el;
        },
    };
}

/* A pane edge: the element's CSS variable `prop` (px) between min and max. */
export function paneGrip(key, el, prop, { label, def, min, max }) {
    let w = Math.max(min, Math.min(max, Number(saved("panes")[key]) || def));
    const apply = () => el.style.setProperty(prop, `${w}px`);
    apply();
    return grip({ label, cls: "grip pane-grip", now: () => w,
        set: (v) => { w = Math.max(min, Math.min(max, Math.round(v))); apply(); },
        reset: () => { w = def; apply(); },
        commit: () => save("panes", { ...saved("panes"), [key]: w }) });
}
