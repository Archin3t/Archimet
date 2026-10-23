/* Apply browser preferences to the document (colours, density, motion, marker style). */

import { prefsGet } from "./store.js";
import { TAGS } from "./tags.js";

/* Older names still used by timelines and note blocks, mapped onto tag colours. */
let tagSheet = null;
const ALIASES = { le: "confirmed", learned: "learned", review: "review", watch: "watch", wifi: "wifi-client", bluetooth: "ble", other: "other", seen: "seen" };

export function reducedMotion() {
    const m = prefsGet().motion;
    if (m === "reduced") return true;
    if (m === "full") return false;
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function applyPrefs() {
    const p = prefsGet();
    const root = document.documentElement;
    // One rule per tag: badge colour, row-marker colour, and hidden when the viewer turned it off
    // (locked tags, such as LE log, always show).
    const css = [];
    for (const t of TAGS) {
        const pref = (p.tags && p.tags[t.id]) || {};
        const c = /^#[0-9a-f]{6}$/i.test(pref.color || "") ? pref.color : t.color;
        root.style.setProperty(`--t-${t.id}`, c);
        css.push(`.b-${t.id}{--c:var(--t-${t.id})}.m-${t.id}{--m:var(--t-${t.id})}`);
        if (!t.locked && pref.show === false) css.push(`.badge.b-${t.id}{display:none}`);
    }
    for (const [k, id] of Object.entries(ALIASES)) root.style.setProperty(`--c-${k}`, `var(--t-${id})`);
    // A constructed stylesheet (CSSOM): the page's CSP rightly refuses injected <style> elements.
    if (!tagSheet) { tagSheet = new CSSStyleSheet(); document.adoptedStyleSheets = [...document.adoptedStyleSheets, tagSheet]; }
    tagSheet.replaceSync(css.join("\n"));
    root.dataset.density = p.density;
    root.dataset.motion = reducedMotion() ? "reduced" : "full";
    root.dataset.marker = p.marker;
}
