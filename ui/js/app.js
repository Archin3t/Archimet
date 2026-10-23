// SPDX-License-Identifier: GPL-2.0-or-later
/* Archimet boot: the intro (on every top-level load: new tab or refresh) runs alongside the
 * session check and first data load; then sign-in only if Kismet's session is missing or
 * expired; then the shell. In-app navigation is hash routing and never reloads the page. */

import { h } from "./lib/util.js";
import { session } from "./api/kismet.js";
import { loadConfig, archimet } from "./api/archimet.js";
import { onAuthLost } from "./api/http.js";
import { prefsGet, prefsSet } from "./lib/store.js";
import { applyPrefs, reducedMotion } from "./lib/theme.js";
import { subscribe } from "./lib/hub.js";
import { runIntro } from "./ui/intro.js";
import { showLogin, showSetup } from "./ui/login.js";
import { mountShell, toast, navigate } from "./ui/shell.js";
import { resetDevicesSort } from "./views/devices.js";
import "./views/le.js";
import "./views/archive.js";
import "./views/server.js";
import "./views/radio.js";
import "./views/settings.js";

const root = document.getElementById("root");
let cfg = { preview: "", setup: "" };
let loginOpen = null;

async function checkSession() {
    try { await session.check(); return true; } catch (e) { return false; }
}

async function ensureLogin(expired, focusAfter) {
    if (loginOpen) return loginOpen;
    loginOpen = showLogin({ expired, preview: cfg.preview, focusAfter, setup: cfg.setup === "default" ? "default" : "", defaultUser: cfg.defaultUser })
        .then((v) => { resetDevicesSort(); return v; })        // a fresh sign-in starts at Last heard
        .finally(() => { loginOpen = null; });
    return loginOpen;
}

/* The Pi's own interface addresses, from authenticated server data only (logger metrics). */
function piAddresses(sessionP) {
    return sessionP.then(ok => ok ? Promise.race([archimet.metrics(), new Promise(r => setTimeout(() => r(null), 3500))]) : null)
        .then(m => (m && Array.isArray(m.addresses) ? m.addresses : null)).catch(() => null);
}

export function replayIntro() {
    const sessionP = checkSession();
    return runIntro({ sessionP, reduced: reducedMotion(), preview: cfg.preview, piAddresses: piAddresses(sessionP) });
}

function watchNotices() {
    let first = true;
    subscribe("state", (st) => {
        if (!st || !Array.isArray(st.notices)) return;
        const p = prefsGet();
        const seen = p.noticeSeen;
        const fresh = st.notices.filter(n => n.id > seen).sort((a, b) => a.id - b.id);
        if (!fresh.length) { first = false; return; }
        prefsSet({ noticeSeen: fresh[fresh.length - 1].id });
        if (seen < 0 && first) { first = false; return; }   // first visit in this browser: no backlog
        first = false;
        const shown = fresh.filter(n => n.action === "seen-again" || p.notify.review);
        if (!shown.length) return;
        const names = shown.slice(-3).map(n => { let d = {}; try { d = JSON.parse(n.detail || "{}"); } catch (e) { /* */ } return `${d.name || ""} ${n.mac}`.trim(); });
        toast(shown.some(n => n.action === "seen-again") ? "Watched device heard again" : "Review device seen again",
            names.join(" · ") + (shown.length > 3 ? ` (+${shown.length - 3})` : ""),
            { color: "var(--c-watch)", onClick: () => navigate(`#/review/${shown[shown.length - 1].mac}`) });
    });
    let known = null;
    subscribe("state", (st) => {
        if (!st || !st.index) return;
        const now = new Set(st.index.official.keys());
        if (known && prefsGet().notify.le) {
            for (const m of now) if (!known.has(m)) {
                const r = st.index.official.get(m);
                if (r.kind !== "operator") toast(`Added to the LE log · ${r.kind === "hardware" ? "vendor match" : r.kind === "learned" ? "associated" : r.kind}`, `${r.name || ""} ${m}`, { color: "var(--t-confirmed)", onClick: () => navigate("#/history") });
            }
        }
        known = now;
    });
}

async function main() {
    applyPrefs();
    cfg = await loadConfig();
    const sessionP = checkSession();
    /* The intro plays on each top-level load while the session is checked; whatever comes
     * next (Devices, or sign-in) is mounted underneath so the intro fades into it. */
    let readyFn;
    const ready = new Promise(r => { readyFn = r; });
    let introP = Promise.resolve();
    if (prefsGet().intro !== "off")
        introP = runIntro({ sessionP, ready, reduced: reducedMotion(), preview: cfg.preview, piAddresses: piAddresses(sessionP) });
    let mounted = false;
    if (cfg.setup === "unconfigured") {
        // No account at all (only reachable from the Pi itself): create it; the stock setup page is never served.
        const signedIn = showLogin({ setup: "unconfigured", preview: cfg.preview, focusAfter: introP });
        readyFn();
        await signedIn;
    } else if (cfg.setup === "default") {
        // Fresh install: sign in with the default account, then the forced change. The gateway serves
        // no data until it is done, so the shell is not mounted before.
        if (!(await sessionP)) { const s = ensureLogin(false, introP); readyFn(); await s; } else readyFn();
        await showSetup({ defaultUser: cfg.defaultUser, preview: cfg.preview });
        cfg = await loadConfig();
    } else if (await sessionP) {
        mountShell(root);              // mounted under the intro, which fades into it
        mounted = true;
        readyFn();
    } else {
        const signedIn = ensureLogin(false, introP);
        readyFn();
        await signedIn;
    }
    if (!mounted) mountShell(root);
    onAuthLost(() => ensureLogin(true));
    watchNotices();
}

main().catch((e) => {
    root.append(h("div", { class: "err" }, "Archimet could not start: " + (e && e.message ? e.message : e)));
});
