// SPDX-License-Identifier: GPL-2.0-or-later
/* Browser-only preferences (this browser). Server-wide settings live in Kismet / the logger
 * and are never stored here. Storage can be blocked; everything falls back to defaults. */

import { DEFAULT_TAG_PREFS, migrateColors } from "./tags.js";

const KEY = "archimet.prefs.v2";

export const DEFAULT_COLORS = {
    wifi: "#7d8b99",
    bluetooth: "#5a78ad",
    le: "#c84a3c",
    bodycam: "#9343cc",
    learned: "#b07d4f",
    review: "#a8995a",
    watch: "#d0a74a",
    other: "#6b7480",
};

/* Version 1 defaults; browsers that still hold exactly these get the quieter v2 palette. */
const OLD_DEFAULT_COLORS = { wifi: "#7fa58a", bluetooth: "#5b8def", le: "#c84a3c", bodycam: "#9343cc", learned: "#c98a4a", review: "#b8a64e", watch: "#e0b450", other: "#8b95a1" };

export const DEFAULTS = {
    tags: structuredClone(DEFAULT_TAG_PREFS),   // per tag: { show, color } (lib/tags.js)
    marker: "edge",            // edge | badge
    motion: "system",          // system | reduced | full
    intro: "load",             // load (every top-level load) | off; older "session" also means on
    density: "comfortable",    // comfortable | compact
    rail: "auto",              // auto | expanded | compact (desktop/tablet sidebar)
    timestamps: "relative",    // relative | absolute
    units: { distance: "metric", temperature: "c" },
    notify: { review: true, le: true },
    columns: { type: true, band: true, channel: true, signal: true, manuf: true, last: true, packets: false, crypt: false },
    bandFormat: "band",        // band | channel | mhz
    view: "all",               // Kismet scope: "all" or a source's seenby-<uuid> view
    cats: null,                // device categories shown (null = everything); see lib/filters.js
    noticeSeen: -1,
    layout: {},                // user-resized column widths and pane sizes (ui/resize.js)
};

let prefs = load();
const subs = new Set();

function load() {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
        if (raw.colors && Object.keys(OLD_DEFAULT_COLORS).every(k => raw.colors[k] === OLD_DEFAULT_COLORS[k])) delete raw.colors;
        // v2 category colours -> tag colours, keeping only what the viewer had changed. The old
        // "Possible body cam/Taser" colour has no successor (that category no longer exists).
        if (raw.colors && !raw.tags) raw.tags = migrateColors(raw.colors, DEFAULT_COLORS);
        delete raw.colors;
        delete raw.sort; delete raw.sortSchema;   // the Devices sort is no longer saved (devices.js)
        const out = merge(structuredClone(DEFAULTS), raw);
        // layout is an open map (table / pane key -> widths) that merge() would drop: kept as stored.
        out.layout = raw.layout && typeof raw.layout === "object" && !Array.isArray(raw.layout) ? raw.layout : {};
        return out;
    } catch (e) {
        return structuredClone(DEFAULTS);
    }
}

function merge(base, over) {
    for (const [k, v] of Object.entries(over || {})) {
        // Preferences may come from localStorage. Never traverse inherited properties or
        // the special keys that can change an object's prototype.
        if (k === "__proto__" || k === "constructor" || k === "prototype" || !Object.hasOwn(base, k)) continue;
        if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") merge(base[k], v);
        else base[k] = v;
    }
    return base;
}

export function prefsGet() { return prefs; }

export function prefsSet(patch) {
    prefs = merge(prefs, patch);
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* blocked */ }
    for (const fn of subs) fn(prefs);
}

/* Replace one top-level preference outright (prefsSet merges, so it cannot clear an object). */
export function prefsReplace(key, value) {
    prefs = { ...prefs, [key]: value };
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* blocked */ }
    for (const fn of subs) fn(prefs);
}

export function prefsReset() {
    prefs = structuredClone(DEFAULTS);
    try { localStorage.removeItem(KEY); } catch (e) { /* blocked */ }
    for (const fn of subs) fn(prefs);
}

export function onPrefs(fn) { subs.add(fn); return () => subs.delete(fn); }
