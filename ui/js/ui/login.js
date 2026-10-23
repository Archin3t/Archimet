/* Archimet sign-in and first setup. The account is the Pi's single Archimet account (stored by the
 * Kismet engine, which keeps one login). The password is sent once to the sign-in check and is not
 * kept anywhere by Archimet; the session cookie is HttpOnly and only archimet-gateway can end it. */

import { h, svg } from "../lib/util.js";
import { MARK } from "./art.js";
import { session } from "../api/kismet.js";
import { reducedMotion } from "../lib/theme.js";

/* What the sign-in screen says. `preview` comes from the local preview's config only:
 * "" on the Pi, "test" against the isolated test instance, anything else against the Pi. */
export function loginCopy({ expired = false, preview = "", firstSetup = false, defaultUser = "" } = {}) {
    const test = preview === "test";
    if (firstSetup) return {
        intro: `First setup. Sign in with the default account ${defaultUser || "archimet"} / ${defaultUser || "archimet"}. Next you choose your own password; until then Archimet shows no data and is closed to the network.`,
        note: "", test };
    const intro = test
        ? (expired ? "The test session ended. Sign in again to continue." : "Sign in to the isolated test instance.")
        : expired ? "Your session ended. Sign in again to continue where you were."
            : "Sign in with your Archimet account. The password is not stored in this browser.";
    const note = test
        ? "Isolated test instance: the Pi's own account does not work here. Use the temporary test login that tools/pi_testenv.py created on this computer (local/testenv/)."
        : preview ? "Local preview: sign-in is checked by the Pi, with its Archimet account." : "";
    return { intro, note, test };
}

/* The message for a failed sign-in. A 401 never says which of the two was wrong. */
export function loginError(status) {
    return status === 401 ? "Invalid username or password."
        : status ? `Sign-in failed (HTTP ${status}).` : "The Pi is not reachable.";
}

export const DEFAULT_PASSWORD = "archimet";

/* Why a new user name / password cannot be used, or "" when it can. The same rules are enforced by
 * archimet-gateway; this only explains them before the request is sent. */
export function accountProblem(user, pass, confirm) {
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(user || "")) return "User name: 1-32 letters, digits, dots, dashes or underscores.";
    if (String(pass || "").length < 10) return "Password: at least 10 characters.";
    if (pass === DEFAULT_PASSWORD) return "Choose a password other than the default.";
    if (String(pass).toLowerCase() === String(user).toLowerCase()) return "The password must differ from the user name.";
    if (pass !== confirm) return "The two passwords differ.";
    return "";
}
export const setupProblem = accountProblem;      // older name, kept for callers and tests

/* A refused change: the gateway's policy (422) or a missing session. */
export function changeRefusal(err) {
    if (err && err.status === 422 && err.body && err.body.detail) return err.body.detail;
    if (err && (err.status === 401 || err.status === 403)) return "Not allowed: sign in again and retry.";
    return `Not changed (${err && err.status ? "HTTP " + err.status : "no answer"}).`;
}

export const SETUP_COPY = "This Pi has no account yet. Create the owner account. This is only possible from the Pi itself or through an SSH tunnel; other devices cannot claim it.";

/* The sign-in user name, kept in memory only for this page (Settings pre-fills it). Never stored. */
let lastUser = "";
export const signedInUser = () => lastUser;

function frame({ eyebrow, copy, form, test }) {
    const canvas = h("canvas", { class: "login-water", "aria-hidden": "true" });
    const root = h("div", { class: "login" + (test ? " test" : "") },
        canvas,
        h("div", { class: "frame", role: "dialog", "aria-modal": "true", "aria-label": eyebrow },
            h("div", { class: "frame-head" },
                h("span", { class: "eyebrow" }, eyebrow),
                test ? h("span", { class: "preview-tag test" }, "test instance") : null,
                h("span", { class: "faint mono" }, location.host)),
            h("div", { class: "frame-body" },
                h("div", { class: "brandline" }, svg(MARK), h("b", {}, "ARCHIMET")),
                h("p", { class: "why" }, copy.intro),
                copy.note ? h("p", { class: "why note" + (test ? " test" : "") }, copy.note) : null,
                form)));
    document.body.append(root);
    const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    let water = null;
    try { water = startWater(canvas, { target: root, reduced: reducedMotion() || lowPower(), coarse }); } catch (e) { /* the CSS gradient stays */ }
    return { root, close: () => { if (water) water.stop(); root.remove(); } };
}

/* Low-power clients get the still frame: few cores, little memory, or data saver. */
function lowPower() {
    const n = navigator || {};
    return (n.hardwareConcurrency && n.hardwareConcurrency <= 2) || (n.deviceMemory && n.deviceMemory <= 1)
        || !!(n.connection && n.connection.saveData);
}

/* setup: "" (sign in) | "unconfigured" (create the first account) | "default" (sign in with the default). */
export function showLogin({ expired = false, preview = "", focusAfter = null, setup = "", defaultUser = "" } = {}) {
    if (setup === true) setup = "unconfigured";            // older callers
    return new Promise((resolve) => {
        const create = setup === "unconfigured";
        const copy = create ? { intro: SETUP_COPY, note: "", test: preview === "test" }
            : loginCopy({ expired, preview, firstSetup: setup === "default", defaultUser });
        const user = h("input", { class: "field", name: "username", autocomplete: "username", required: true, spellcheck: "false", autocapitalize: "none" });
        if (setup === "default") user.value = defaultUser || "archimet";
        const pass = h("input", { class: "field", name: "password", type: "password", autocomplete: create ? "new-password" : "current-password", required: true });
        const confirm = create ? h("input", { class: "field", name: "confirm", type: "password", autocomplete: "new-password", required: true }) : null;
        const msg = h("div", { class: "msg", role: "alert" });
        const go = h("button", { class: "btn primary", type: "submit" }, create ? "Create account" : "Sign in");
        const form = h("form", { novalidate: true },
            h("label", {}, "User name", user),
            h("label", {}, "Password", pass),
            create ? h("label", {}, "Password again", confirm) : null,
            msg, go);
        const ui = frame({ eyebrow: create ? "first-run setup" : setup === "default" ? "first setup" : expired ? "session expired" : "sign in",
                           copy, form, test: copy.test });
        // Under the intro the form waits for it to finish before taking focus.
        Promise.resolve(focusAfter).then(() => setTimeout(() => (user.value ? pass : user).focus(), 30));

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!user.value || !pass.value) { msg.textContent = "Enter user name and password."; return; }
            if (create) { const p = accountProblem(user.value, pass.value, confirm.value); if (p) { msg.textContent = p; return; } }
            go.disabled = true;
            msg.textContent = "";
            try {
                if (create) {
                    try { await session.firstAccount(user.value, pass.value); }
                    catch (err) {
                        msg.textContent = err.status === 422 ? changeRefusal(err) : "An account already exists, or this device may not create it. Reload to sign in.";
                        go.disabled = false; return;
                    }
                    confirm.value = "";
                }
                await session.login(user.value, pass.value);
                await session.check();          // the cookie is set and accepted
                lastUser = user.value;
                pass.value = "";
                ui.close();
                resolve(true);
            } catch (err) {
                pass.value = "";
                msg.textContent = loginError(err.status);
                go.disabled = false;
                pass.focus();
            }
        });
    });
}

/* The forced first change after signing in with the default account: a new password is required,
 * a new user name optional. Enforced by archimet-gateway (no data until it is done); this screen
 * only cannot be skipped in the interface either. Resolves once signed in with the new account. */
export function showSetup({ defaultUser = "archimet", preview = "" } = {}) {
    return new Promise((resolve) => {
        const user = h("input", { class: "field", name: "username", autocomplete: "username", spellcheck: "false", autocapitalize: "none" });
        user.value = lastUser || defaultUser;
        const p1 = h("input", { class: "field", name: "new-password", type: "password", autocomplete: "new-password", required: true });
        const p2 = h("input", { class: "field", name: "confirm", type: "password", autocomplete: "new-password", required: true });
        const msg = h("div", { class: "msg", role: "alert" });
        const go = h("button", { class: "btn primary", type: "submit" }, "Save and continue");
        const form = h("form", { novalidate: true },
            h("label", {}, "User name (you may keep it)", user),
            h("label", {}, "New password", p1),
            h("label", {}, "New password again", p2),
            h("p", { class: "hint" }, "At least 10 characters, not the default and not the user name."),
            msg, go);
        const ui = frame({ eyebrow: "choose your password", copy: {
            intro: "Replace the default password before Archimet opens. The new account replaces the default one everywhere; every other session is signed out.",
            note: "" }, form, test: preview === "test" });
        setTimeout(() => p1.focus(), 30);
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const p = accountProblem(user.value, p1.value, p2.value);
            if (p) { msg.textContent = p; return; }
            go.disabled = true;
            msg.textContent = "";
            try {
                await session.setPassword(user.value, p1.value);
                await session.login(user.value, p1.value);       // the change ended the old session
                await session.check();
                lastUser = user.value;
                p1.value = p2.value = "";
                ui.close();
                resolve(true);
            } catch (err) {
                msg.textContent = changeRefusal(err);
                go.disabled = false;
            }
        });
    });
}

/* Settings: change the user name, the password, or both. The current password is checked against
 * the account first. Afterwards this browser signs in again; every other session has ended. */
export async function changeAccount({ currentUser, currentPassword, newUser, newPassword }) {
    try { await session.login(currentUser, currentPassword); }
    catch (err) { return { ok: false, message: err.status === 401 ? "Invalid username or password." : loginError(err.status) }; }
    const user = newUser || currentUser, pass = newPassword || currentPassword;
    const problem = accountProblem(user, pass, pass);
    if (problem) return { ok: false, message: newPassword ? problem : `${problem} Set a new password as well.` };
    try { await session.setPassword(user, pass); }
    catch (err) { return { ok: false, message: changeRefusal(err) }; }
    try { await session.login(user, pass); lastUser = user; }
    catch (err) { return { ok: true, relogin: true, message: "Changed. Sign in again with the new details." }; }
    return { ok: true, message: "Account updated. Every other session was signed out." };
}

/* ---------- backdrop: a slow black/navy/blue gradient on a small water height-field.
 * Pointer moves drop ripples and leave short-lived swirls; fast moves flick a few hex
 * pairs. Everything is bounded (grid cells, swirls, glyphs), stops while the tab is
 * hidden, draws one still frame under reduced motion, and on touch reacts to taps only. */

const HEX = "0123456789ABCDEF";
// Restrained on purpose (2026-10-23): slow drift, small ripples, few faint glyphs, at most ~30 frames/s.
const LIMIT = { cellsFine: 16000, cellsCoarse: 7000, swirls: 3, glyphs: 12, dropsPerMove: 4, frameMs: 33 };
// black -> navy -> beaver blue -> light blue; the curve keeps most of the screen dark.
const STOPS = [[5, 6, 8], [4, 16, 36], [6, 30, 66], [30, 64, 124], [92, 128, 196]];

/* Two hex digits, never one that reads as binary (00, 01, 10, 11). */
export function hexGlyph(rand = Math.random) {
    const a = HEX[(rand() * 16) | 0];
    return a + (a === "0" || a === "1" ? HEX[2 + ((rand() * 14) | 0)] : HEX[(rand() * 16) | 0]);
}

function shade(f, out) {
    const x = Math.min(0.9999, Math.max(0, f)) * (STOPS.length - 1);
    const i = x | 0, k = x - i, a = STOPS[i], b = STOPS[i + 1];
    out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = a[2] + (b[2] - a[2]) * k;
}

const browserEnv = () => ({
    win: window, doc: document,
    raf: (fn) => requestAnimationFrame(fn), caf: (id) => cancelAnimationFrame(id),
    now: () => performance.now(), rand: Math.random,
});

/* Returns { stop, stats }. `env` exists so tests can drive frames and visibility by hand. */
export function startWater(canvas, { target, reduced = false, coarse = false, env = browserEnv() } = {}) {
    const { win, doc, raf, caf, now, rand } = env;
    const ctx = canvas.getContext("2d");
    const off = doc.createElement("canvas");
    const octx = off.getContext("2d");
    if (!ctx || !octx) return { stop() {}, stats: () => ({ running: false, swirls: 0, glyphs: [], cells: 0, listeners: 0 }) };

    let W = 0, H = 0, dpr = 1, cell = 1, cols = 0, rows = 0, cur, prev, img;
    const swirls = [], glyphs = [], rgb = [0, 0, 0];
    let lastPaint = -1e9;
    let frame = 0, last = 0, acc = 0, stopped = false, last_p = null, lastSwirl = -1e9, lastSplash = -1e9, nextAmbient = 0;
    const listeners = [];
    const on = (el, type, fn, opt) => { el.addEventListener(type, fn, opt); listeners.push([el, type, fn, opt]); };

    function size() {
        W = Math.max(1, win.innerWidth | 0); H = Math.max(1, win.innerHeight | 0);
        dpr = Math.min(2, win.devicePixelRatio || 1);
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        const cap = coarse ? LIMIT.cellsCoarse : LIMIT.cellsFine;
        cell = Math.max(coarse ? 9 : 6, Math.sqrt((W * H) / cap));
        cols = Math.max(8, Math.ceil(W / cell)); rows = Math.max(8, Math.ceil(H / cell));
        off.width = cols; off.height = rows;
        cur = new Float32Array(cols * rows); prev = new Float32Array(cols * rows);
        img = octx.createImageData(cols, rows);
    }

    function drop(px, py, amp, r = 1) {
        const cx = Math.round(px / cell), cy = Math.round(py / cell);
        for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
            if (x < 1 || y < 1 || x >= cols - 1 || y >= rows - 1) continue;
            const i = y * cols + x;
            cur[i] = Math.max(-4, Math.min(4, cur[i] + amp));
        }
    }

    function swirl(px, py, spin, t) {
        if (swirls.length >= LIMIT.swirls) swirls.shift();
        swirls.push({ x: px / cell, y: py / cell, spin: Math.max(-1.6, Math.min(1.6, spin)), r: (coarse ? 70 : 110) / cell, born: t });
    }

    function splash(px, py, vx, vy, t) {
        const n = Math.min(2, LIMIT.glyphs - glyphs.length);
        for (let k = 0; k < n; k++) {
            const a = Math.atan2(vy, vx) + (rand() - 0.5) * 2.2, s = 0.05 + rand() * 0.12;
            glyphs.push({ x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.04, born: t, life: 650 + rand() * 450, ch: hexGlyph(rand) });
        }
    }

    function step() {
        // Classic two-buffer ripple: each cell moves toward its neighbours' mean; damping keeps it bounded.
        const damp = 0.955;            // ripples settle quickly
        for (let y = 1; y < rows - 1; y++) {
            let i = y * cols + 1;
            for (let x = 1; x < cols - 1; x++, i++) {
                prev[i] = ((cur[i - 1] + cur[i + 1] + cur[i - cols] + cur[i + cols]) * 0.5 - prev[i]) * damp;
            }
        }
        const t = cur; cur = prev; prev = t;
    }

    function paint(t) {
        const s = t / 2600, d = img.data, aspect = 1 / rows;     // slow idle drift
        const live = [];
        for (const w of swirls) {
            const age = (t - w.born) / 1000, k = w.spin * Math.exp(-age * 1.6);
            if (Math.abs(k) > 0.01) live.push({ x: w.x, y: w.y, k, r2: w.r * w.r, age });
        }
        for (let y = 0, i = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++, i++) {
                let gx = x, gy = y, spiral = 0;
                for (const w of live) {
                    const dx = gx - w.x, dy = gy - w.y, d2 = dx * dx + dy * dy;
                    if (d2 > w.r2 * 4) continue;
                    const fall = Math.exp(-d2 / w.r2), a = w.k * fall * 2.4, c = Math.cos(a), sn = Math.sin(a);
                    gx = w.x + dx * c - dy * sn; gy = w.y + dx * sn + dy * c;
                    spiral += Math.abs(w.k) * fall * Math.sin(Math.atan2(dy, dx) * 2 + Math.sqrt(d2) * 0.9 - w.age * 5);
                }
                const u = gx * aspect, v = gy * aspect;
                const f = 0.5
                    + 0.22 * Math.sin(u * 2.6 + s * 0.11 + Math.sin(v * 2.1 - s * 0.07) * 1.5)
                    + 0.18 * Math.sin(v * 3.3 - s * 0.09 + Math.sin(u * 1.7 + s * 0.05) * 1.3)
                    + 0.12 * (u - v * 0.6) - 0.12;
                shade(f * f + spiral * 0.07, rgb);
                let light = 0;
                if (x > 0 && y > 0 && x < cols - 1 && y < rows - 1) light = (cur[i - 1] - cur[i + 1] + cur[i - cols] - cur[i + cols]) * 0.35;
                light = Math.max(-0.25, Math.min(0.45, light));
                const p = i * 4;
                d[p] = rgb[0] + light * 80; d[p + 1] = rgb[1] + light * 95; d[p + 2] = rgb[2] + light * 120; d[p + 3] = 255;
            }
        }
        octx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
        if (glyphs.length) {
            ctx.font = `500 ${Math.round(12 * dpr)}px ui-monospace, Menlo, Consolas, monospace`;
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            for (const g of glyphs) {
                const k = (t - g.born) / g.life;
                ctx.fillStyle = `rgba(206, 222, 255, ${(0.4 * (1 - k) * (1 - k)).toFixed(3)})`;
                ctx.fillText(g.ch, g.x * dpr, g.y * dpr);
            }
        }
    }

    function tick() {
        frame = 0;
        if (stopped || doc.hidden) return;
        const t = now();
        acc = Math.min(acc + (last ? t - last : 16.7), 50);   // at most 3 steps after a stall
        last = t;
        while (acc >= 16.7) { step(); acc -= 16.7; }
        if (t > nextAmbient) {                                  // the surface never goes quite flat
            drop(rand() * W, rand() * H, 0.25 + rand() * 0.15, 1);
            nextAmbient = t + 4500 + rand() * 4500;
        }
        for (let k = glyphs.length - 1; k >= 0; k--) {
            const g = glyphs[k];
            if (t - g.born > g.life) { glyphs.splice(k, 1); continue; }
            g.x += g.vx * 16.7; g.y += g.vy * 16.7; g.vy += 0.0025;
        }
        while (swirls.length && t - swirls[0].born > 2500) swirls.shift();
        if (t - lastPaint >= LIMIT.frameMs) { paint(t); lastPaint = t; }
        frame = raf(tick);
    }

    function wake() { if (!frame && !stopped && !reduced && !doc.hidden) { last = 0; frame = raf(tick); } }

    function onMove(e) {
        const t = now(), x = e.clientX, y = e.clientY;
        if (!last_p || t - last_p.t > 120) { last_p = { x, y, t, vx: 0, vy: 0 }; drop(x, y, 0.5); return; }
        const dt = Math.max(1, t - last_p.t), vx = (x - last_p.x) / dt, vy = (y - last_p.y) / dt, speed = Math.hypot(vx, vy);
        const n = Math.min(LIMIT.dropsPerMove, Math.max(1, Math.round(Math.hypot(x - last_p.x, y - last_p.y) / (cell * 2))));
        for (let k = 1; k <= n; k++) drop(last_p.x + (x - last_p.x) * k / n, last_p.y + (y - last_p.y) * k / n, Math.min(0.8, 0.2 + speed * 0.3));
        if (speed > 0.8 && t - lastSwirl > 320) {
            const turn = last_p.vx * vy - last_p.vy * vx;        // which way the pointer is curving
            swirl(x, y, (turn >= 0 ? 1 : -1) * Math.min(0.7, 0.2 + speed * 0.2), t);
            lastSwirl = t;
        }
        if (speed > 3.0 && t - lastSplash > 600) { splash(x, y, vx, vy, t); lastSplash = t; }
        last_p = { x, y, t, vx, vy };
        wake();
    }

    function onTap(e) {
        drop(e.clientX, e.clientY, 0.9, 2);
        swirl(e.clientX, e.clientY, 0.35, now());
        wake();
    }

    function onVisibility() {
        if (doc.hidden) { if (frame) caf(frame); frame = 0; }
        else wake();
    }

    let resizeQueued = false;
    function onResize() {
        if (resizeQueued) return;
        resizeQueued = true;
        // Batched to one resize per frame; without a frame loop (reduced motion) it repaints at once.
        const apply = () => { resizeQueued = false; if (stopped) return; size(); if (reduced) paint(now()); };
        if (reduced) apply(); else raf(apply);
    }

    size();
    on(win, "resize", onResize);
    if (reduced) {
        paint(0);                                               // one still frame, no loop, no pointer effects
    } else {
        on(doc, "visibilitychange", onVisibility);
        if (coarse) on(target, "pointerdown", onTap, { passive: true });
        else on(target, "pointermove", onMove, { passive: true });
        nextAmbient = now() + 600;
        wake();
    }

    return {
        stop() {
            if (stopped) return;
            stopped = true;
            if (frame) caf(frame);
            frame = 0;
            for (const [el, type, fn, opt] of listeners) el.removeEventListener(type, fn, opt);
            listeners.length = 0; glyphs.length = 0; swirls.length = 0;
        },
        stats: () => ({ running: !!frame, swirls: swirls.length, glyphs: glyphs.map(g => g.ch), cells: cols * rows, listeners: listeners.length }),
    };
}
