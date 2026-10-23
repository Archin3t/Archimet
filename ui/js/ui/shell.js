// SPDX-License-Identifier: GPL-2.0-or-later
/* Archimet shell: navigation, status strip, routing, toasts, dialogs. */

import { h, svg, clear, relTime } from "../lib/util.js";
import { paneGrip } from "./resize.js";
import { MARK, ICON } from "./art.js";
import { subscribe } from "../lib/hub.js";
import { rrdSeries, sparkline, recentRate } from "../lib/chart.js";
import { config } from "../api/archimet.js";
import { sourceStates, sourceSummary } from "../lib/sources.js";
import { prefsGet, prefsSet } from "../lib/store.js";

const NAV = [
    ["Monitor", [
        ["devices", "Devices", "devices"],
        ["history", "LE History", "history"],
        ["review", "Review", "review"],
        ["archive", "Archive", "archive"],
        ["alerts", "Alerts", "alerts"],
        ["ssids", "SSIDs", "ssids"],
    ]],
    ["Radio", [
        ["sources", "Sources", "sources"],
        ["channels", "Channels", "channels"],
    ]],
    ["Server", [
        ["messages", "Messages", "messages"],
        ["system", "System", "system"],
        ["settings", "Settings", "settings"],
    ]],
];
const PHONE_NAV = [["devices", "Devices"], ["history", "LE"], ["review", "Review"], ["alerts", "Alerts"]];

const routes = {};
let current = null;
let els = {};

export function route(name, def) { routes[name] = def; }

export function mountShell(root) {
    clear(root);
    const nav = h("nav", { class: "nav", "aria-label": "Archimet" });
    for (const [group, items] of NAV) {
        nav.append(h("div", { class: "eyebrow" }, group));
        for (const [id, label, icon] of items)
            nav.append(h("a", { href: `#/${id}`, "data-route": id, title: label, "aria-label": label, "data-label": label },
                svg(ICON[icon]), h("span", { class: "lbl" }, label), h("span", { class: "count", "data-count": id })));
    }
    const railBtn = h("button", { class: "rail-toggle", type: "button", onclick: toggleRail });
    const status = h("div", { class: "status" });
    const crumb = h("div", { class: "crumb" }, h("span", { class: "eyebrow" }), h("h1", { class: "h1" }, "Archimet"));
    const menuBtn = h("button", { class: "btn ghost iconbtn menu-btn", type: "button", "aria-label": "Open navigation", "aria-expanded": "false", "aria-controls": "rail", onclick: (e) => openDrawer(e.currentTarget) }, svg(ICON.menu));
    const bottom = h("nav", { class: "bottomnav", "aria-label": "Archimet quick links" },
        ...PHONE_NAV.map(([id, label]) => h("a", { href: `#/${id}`, "data-route": id }, svg(ICON[id]), label)),
        h("button", { type: "button", "aria-label": "More: all sections", "aria-expanded": "false", "aria-controls": "rail", onclick: (e) => openDrawer(e.currentTarget) }, svg(ICON.more), "More"));
    const drawerScrim = h("div", { class: "drawer-scrim", "aria-hidden": "true", onclick: () => closeDrawer() });
    const main = h("main", { class: "main", id: "main" });
    const app = h("div", { class: "app" },
        h("aside", { class: "rail", id: "rail" },
            h("div", { class: "brand" }, svg(MARK), h("b", {}, "ARCHIMET")),
            nav,
            h("div", { class: "rail-foot" }, h("div", {}, h("b", { "data-server": "" }, "—")), h("div", {}, "Built on Kismet · ", h("a", { href: "#/settings/about" }, "About"))),
            railBtn,
        ),
        h("header", { class: "top" }, menuBtn, crumb, status),
        main, bottom, drawerScrim,
        h("div", { class: "toasts", "aria-live": "polite" }));
    root.append(app);
    if (config().preview === "test") {
        document.body.classList.add("test-mode");
        document.body.append(h("div", { class: "test-ribbon", role: "note" }, "ISOLATED TEST INSTANCE · synthetic two-frame capture and copied logs · not the real Pi"));
    }
    els = { app, nav, status, crumb, main, bottom, railBtn, rail: app.querySelector(".rail") };
    els.rail.append(paneGrip("rail", app, "--rail-user", { label: "Resize the sidebar", def: 220, min: 180, max: 360 }));
    applyRail();
    window.matchMedia("(max-width: 1180px)").addEventListener("change", applyRail);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && els.app.classList.contains("drawer-open")) closeDrawer(); });
    buildStatus(status);
    window.addEventListener("hashchange", go);
    go();
}

/* Sidebar: full or compact icon rail on desktop/tablet (remembered in this browser);
 * a modal drawer with the same links on phone. */
const isPhone = () => window.matchMedia("(max-width: 720px)").matches;
function railCompact() {
    const p = prefsGet().rail;
    return p === "compact" || (p === "auto" && window.matchMedia("(max-width: 1180px)").matches);
}
function applyRail() {
    const compact = railCompact();
    els.app.classList.toggle("rail-compact", compact);
    els.app.classList.toggle("rail-full", !compact);
    const label = compact ? "Expand sidebar" : "Collapse sidebar to icons";
    els.railBtn.replaceChildren(svg(compact ? ICON.railExpand : ICON.railCollapse), h("span", { class: "lbl" }, compact ? "Expand" : "Collapse"));
    els.railBtn.setAttribute("aria-label", label);
    els.railBtn.setAttribute("aria-expanded", String(!compact));
    els.railBtn.title = label;
}
function toggleRail() {
    prefsSet({ rail: railCompact() ? "expanded" : "compact" });
    applyRail();
    els.railBtn.focus();
}
let drawerOpener = null;
function openDrawer(opener) {
    drawerOpener = opener;
    els.app.classList.add("drawer-open");
    els.rail.setAttribute("role", "dialog");
    els.rail.setAttribute("aria-modal", "true");
    els.rail.setAttribute("aria-label", "Navigation");
    document.querySelectorAll('[aria-controls="rail"]').forEach(b => b.setAttribute("aria-expanded", "true"));
    (els.nav.querySelector('[aria-current="page"]') || els.nav.querySelector("a")).focus();
}
function closeDrawer() {
    if (!els.app.classList.contains("drawer-open")) return;
    els.app.classList.remove("drawer-open");
    ["role", "aria-modal", "aria-label"].forEach(a => els.rail.removeAttribute(a));
    document.querySelectorAll('[aria-controls="rail"]').forEach(b => b.setAttribute("aria-expanded", "false"));
    if (drawerOpener && isPhone()) drawerOpener.focus();
    drawerOpener = null;
}

export function setTitle(eyebrow, title) {
    els.crumb.querySelector(".eyebrow").textContent = eyebrow || "";
    els.crumb.querySelector(".h1").textContent = title;
    document.title = (config().preview === "test" ? "[TEST] " : "") + (title === "Archimet" ? "Archimet" : `${title} · Archimet`);
}

function go() {
    closeDrawer();
    let parts = (location.hash.replace(/^#\/?/, "") || "devices").split("/");
    // An unknown route opens plain Devices; its arguments are dropped (never read as a device key).
    if (!routes[parts[0]]) parts = ["devices"];
    const name = parts[0];
    for (const a of document.querySelectorAll("[data-route]"))
        a.setAttribute("aria-current", a.dataset.route === name ? "page" : "false");
    if (current && current.name === name && current.def.update) {
        current.def.update(parts.slice(1));
        return;
    }
    if (current && current.cleanup) current.cleanup();
    clear(els.main);
    const def = routes[name];
    setTitle(def.eyebrow || "", def.title);
    const cleanup = def.mount(els.main, parts.slice(1));
    current = { name, def, cleanup };
}

export function navigate(hash) { if (location.hash !== hash) location.hash = hash; else go(); }

/* ---- status strip (always visible) */

let lastSrc = null, lastUsb = null;
const srcMemory = new Map();      // packet-count watch per source (lib/sources.js)

function buildStatus(box) {
    const cfg = config();
    if (cfg.preview === "test") box.append(h("span", { class: "preview-tag test", title: "Local preview against the isolated test instance on the Pi (test Kismet, copies of the logs). Actions are enabled and change only the test copies." }, "test instance · writes on"));
    else if (cfg.preview) box.append(h("span", { class: "preview-tag", title: "Local preview against the Pi. Read-only: actions that change Kismet or the LE log are disabled." }, "preview · read-only"));
    const src = h("a", { class: "st", href: "#/sources", title: "Data sources" }, h("span", { class: "dot" }), h("span", {}, "sources"));
    const pps = h("span", { class: "st hide-md", title: "Packets per second (last minute)" });
    const gps = h("span", { class: "st hide-md", title: "GPS" }, svg(ICON.gps), h("span", {}, "—"));
    const alerts = h("a", { class: "st", href: "#/alerts", title: "Alerts" }, svg(ICON.alerts), h("span", {}, "0"));
    const le = h("a", { class: "st keep le-pill", href: "#/history", title: "Rows in the LE log (all time). LE History shows which were heard in the last 2 minutes by Kismet's clock." }, "LE —");
    box.append(src, pps, gps, alerts, le);

    subscribe("sources", (list, err) => {
        if (err || !Array.isArray(list)) { src.querySelector(".dot").style.setProperty("--c", "var(--bad)"); src.lastChild.textContent = "sources ?"; src.title = "Kismet did not report its sources"; return; }
        // "Capturing" needs a rising packet count, not just Kismet's "open" flag (lib/sources.js).
        const states = sourceStates(srcMemory, list, Date.now());
        const sum = sourceSummary(list, states);
        const st = (s) => (states.get(s["kismet.datasource.uuid"]) || {}).state || "unknown";
        src.querySelector(".dot").style.setProperty("--c", `var(--${sum.level})`);
        src.lastChild.textContent = sum.text;
        src.title = sum.title;
        // Tell the operator when a source changes state or disappears (once per change).
        const now = new Map(list.map(s => [s["kismet.datasource.uuid"], [s["kismet.datasource.name"], st(s)]]));
        if (lastSrc) {
            for (const [u, [name, state]] of now) {
                const was = lastSrc.get(u);
                if (!was) toast("Source added", `${name} (${state})`);
                else if (was[1] !== state && state !== "checking" && !(was[1] === "checking" && state === "capturing"))
                    toast(`Source ${state === "capturing" ? "capturing again" : state}`, name, { color: state === "capturing" ? "var(--ok)" : state === "error" || state === "stalled" ? "var(--bad)" : "var(--warn)", onClick: () => navigate("#/sources") });
            }
            for (const [u, [name]] of lastSrc) if (!now.has(u)) toast("Source removed", `${name} is no longer a Kismet source.`, { color: "var(--warn)", onClick: () => navigate("#/sources") });
        }
        lastSrc = now;
    });
    // New USB hardware (from the Pi's own readings): say it was detected, never that it is a source.
    subscribe("metrics", (m) => {
        if (!m || !Array.isArray(m.usb)) return;
        const ports = new Map(m.usb.map(u => [u.port, u]));
        if (lastUsb) for (const [port, u] of ports) if (!lastUsb.has(port) || lastUsb.get(port).id !== u.id)
            toast("USB device detected", `${[u.manufacturer, u.product].filter(Boolean).join(" ") || u.id} on port ${port}. Open Sources to add it as a capture source.`, { onClick: () => navigate("#/sources") });
        lastUsb = ports;
    });
    subscribe("packets", (ps) => {
        if (!ps) return;
        const s = rrdSeries(ps["kismet.packetchain.packets_rrd"], "minute");
        clear(pps).append(sparkline(s.slice(-40), { width: 64, height: 18 }), h("span", { title: "Average over the last 10 seconds" }, `${recentRate(s)} pkt/s`));
    });
    subscribe("gps", (g) => {
        const p = g && g["kismet.common.location.geopoint"];
        const fix = g && (g["kismet.common.location.fix"] || 0);
        gps.lastChild.textContent = p && fix >= 2 ? `${p[1].toFixed(4)}, ${p[0].toFixed(4)}` : "no fix";
    });
    subscribe("status", (st) => {
        if (!st) return;
        const name = st["kismet.system.server_name"] || location.hostname;
        const srv = document.querySelector("[data-server]");
        if (srv) srv.textContent = name;
    });
    let lastAlerts = 0;
    import("../api/kismet.js").then(({ kismet }) => {
        const poll = async () => {
            try {
                const a = await kismet.alerts(0);
                lastAlerts = Array.isArray(a) ? a.length : 0;
                alerts.lastChild.textContent = String(lastAlerts);
                const c = document.querySelector('[data-count="alerts"]');
                if (c) c.textContent = lastAlerts || "";
            } catch (e) { /* status only */ }
            setTimeout(poll, 15000);
        };
        poll();
    });
    subscribe("state", (st) => {
        if (!st || !st.index) { le.textContent = "LE ?"; return; }
        le.textContent = `LE ${st.official ? st.official.length : 0}`;
        const c1 = document.querySelector('[data-count="history"]');
        if (c1) c1.textContent = st.official ? st.official.length : "";
        const c2 = document.querySelector('[data-count="review"]');
        if (c2) {
            // Only rows that need a person; low-priority rows are counted in the Review screen itself.
            const all = st.review || [], active = all.filter(r => !r.resolution || r.resolution.state === "active").length;
            c2.textContent = st.review ? active : "";
            c2.title = st.review ? `${active} need review · ${all.length - active} low priority · ${(st.review_dismissed || []).length} dismissed` : "";
        }
    });
}

/* ---- toasts */

export function toast(title, text, { color = "", onClick = null, ms = 9000 } = {}) {
    const box = document.querySelector(".toasts");
    if (!box) return;
    const t = h("div", { class: "toast", role: "status" }, h("b", {}, title), h("span", {}, text));
    if (color) t.style.setProperty("--c", color);
    t.addEventListener("click", () => { t.remove(); if (onClick) onClick(); });
    box.append(t);
    setTimeout(() => t.remove(), ms);
}

/* ---- dialogs */

export function dialog(title, body, { actions = [], closeOnNav = false } = {}) {
    return new Promise((resolve) => {
        const close = (v) => { scrim.remove(); window.removeEventListener("hashchange", navClose); document.removeEventListener("keydown", esc); resolve(v); };
        const navClose = () => { if (closeOnNav) close(null); };
        const esc = (e) => { if (e.key === "Escape") close(null); };
        const scrim = h("div", { class: "scrim", onclick: (e) => { if (e.target === scrim) close(null); } },
            h("div", { class: "dialog frame", role: "dialog", "aria-modal": "true", "aria-label": title },
                h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, title),
                    h("button", { class: "btn ghost iconbtn", type: "button", "aria-label": "Close", onclick: () => close(null) }, svg(ICON.close))),
                body,
                actions.length ? h("div", { class: "frame-body actions" }, ...actions.map(([label, value, cls]) =>
                    h("button", { class: "btn " + (cls || ""), type: "button", onclick: () => close(typeof value === "function" ? value() : value) }, label))) : null));
        document.body.append(scrim);
        window.addEventListener("hashchange", navClose);
        document.addEventListener("keydown", esc);
        const f = scrim.querySelector("input, textarea, button.primary");
        if (f) setTimeout(() => f.focus(), 30);
    });
}

export async function askNote(title, explain, { required = true, placeholder = "" } = {}) {
    const ta = h("textarea", { class: "field", maxlength: "500", placeholder });
    const body = h("div", { class: "frame-body" }, h("p", { class: "dim", style: { margin: 0, lineHeight: "1.55" } }, explain), ta);
    const v = await dialog(title, body, { actions: [["Cancel", null, "ghost"], ["Confirm", () => ta.value.trim(), "primary"]] });
    if (v == null) return null;
    if (required && v.length < 3) return askNote(title, explain + " (A note of at least 3 characters is required.)", { required, placeholder });
    return v;
}

export function ago(epoch) { return relTime(epoch); }
