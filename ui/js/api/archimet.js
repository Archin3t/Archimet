/* Archimet logger API (LE log, Review, sightings, operator actions). */

import { request } from "./http.js";

/* archimet-gateway serves the logger under /archimet/ on the same origin. */
let BASE = `${location.origin}/archimet/`;
let READONLY = false;
let PREVIEW = "";
let SETUP = "";            // "" (finished) | "default" (default password still active) | "unconfigured" | "unknown"
let DEFAULT_USER = "";
let TLS = false;

/* /archimet-config.json comes from archimet-gateway (or the local preview). */
export async function loadConfig() {
    try {
        const c = await request("/archimet-config.json", { auth: false, timeout: 4000 });
        if (c && typeof c === "object") {
            if (typeof c.apiBase === "string") BASE = c.apiBase;
            READONLY = !!c.readonly;
            PREVIEW = c.preview || "";
            SETUP = typeof c.setup === "string" ? c.setup : "";
            DEFAULT_USER = c.defaultUser || "";
            TLS = !!c.tls;
        }
    } catch (e) { /* production: defaults */ }
    return config();
}

export const config = () => ({ base: BASE, readonly: READONLY, preview: PREVIEW, setup: SETUP, defaultUser: DEFAULT_USER, tls: TLS });

export const archimet = {
    health: () => request(BASE + "health", { auth: false }),
    state: (rev = "") => request(BASE + "state.json" + (rev ? "?rev=" + encodeURIComponent(rev) : "")),
    history: () => request(BASE + "le_history.json"),
    metrics: () => request(BASE + "metrics.json"),
    /* Read-only Archive of everything stored, across capture runs (logger 5.2). */
    archive: ({ table = "ap", q = "", page = 0, length = 50, sort = "", dir = "desc" } = {}) =>
        request(BASE + "archive.json?" + new URLSearchParams({ table, q, page: String(page), length: String(length), sort, dir })),
    known: (macs) => request(BASE + "known.json", { json: { macs } }),
    mark: (mac, note) => request(BASE + "mark", { json: { mac, note } }),
    unmark: (mac, note) => request(BASE + "unmark", { json: { mac, note } }),
    /* Operator decision on a Review row: "keep" (active) or "dismiss", locked against the automatic
     * policy; "release" hands it back to the policy (logger 5.2). */
    resolveReview: (mac, action, note = "") => request(BASE + "review", { json: { mac, action, note } }),
};
