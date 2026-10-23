// SPDX-License-Identifier: GPL-2.0-or-later
/* Archimet opening: full-screen, about five seconds, on every top-level load of Archimet
 * (new tab or refresh; never on in-app navigation, which does not reload the page).
 * The title is real text (ANSI Shadow block characters, see ascii.js). The session check runs
 * underneath and the intro fades into whatever the app mounted beneath it (Devices or sign-in).
 * Skip: Escape, or the Skip button. Reduced motion: the finished frame, no animation. */

import { h } from "../lib/util.js";
import { lettering, width, byCells } from "./ascii.js";

export const SOCIAL = [
    ["Instagram", "https://www.instagram.com/archin3t/"],
    ["GitHub", "https://github.com/archin3t"],
    ["YouTube", "https://www.youtube.com/@Archin3t"],
    ["TikTok", "https://www.tiktok.com/@archin3t"],
];

export function socialLinks(cls = "") {
    return h("span", { class: cls }, ...SOCIAL.flatMap(([name, url], i) => [
        i ? h("span", { class: "faint" }, " · ") : null,
        h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, name),
    ]));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const WELCOME = "welcome · thank you for running archimet";
const TOTAL_MS = 5000;           // intended length, fade included

/* One <pre> of cells; cells are [col, row, span, kind]. */
function block(word, cls, opts) {
    const grid = lettering(word, opts);
    const cells = [];
    const pre = h("pre", { class: `ascii ${cls}`, "aria-hidden": "true" },
        ...grid.map((row) => h("span", { class: "arow" }, ...row.map((c, col) => {
            if (c.kind === "space") return " ";
            const s = h("span", { class: `k-${c.kind} r${c.row} off` }, c.ch);
            cells.push([col, c.row, s, c.kind]);
            return s;
        }))),
        h("span", { class: "acursor" }));
    return { pre, cells, cols: width(word), rows: grid.length };
}

/* Narrow portrait screens get ARCHI / MET on two lines, so the letters stay readable. */
function titleBlocks(narrow) {
    if (!narrow) return [block("ARCHIMET", "title", { distress: true })];
    return [block("ARCHI", "title", { distress: true, offset: 0 }), block("MET", "title", { distress: true, offset: 35 })];
}

function fit(root, titles, sub) {
    const probe = h("span", { class: "ascii-probe" }, "█".repeat(20));
    root.append(probe);
    const ratio = probe.getBoundingClientRect().width / 20 / 100 || 0.6;
    probe.remove();
    const pad = Math.max(16, Math.min(64, innerWidth * 0.05));
    const cols = Math.max(...titles.map(t => t.cols));
    const rows = titles.reduce((n, t) => n + t.rows, 0);
    const fs = Math.max(4, Math.min((innerWidth - pad * 2) / (cols * ratio), (innerHeight * 0.4) / rows, 40));
    const subFs = Math.max(4, Math.min(fs * 0.46, (innerWidth - pad * 2) / (sub.cols * ratio), 18));
    root.style.setProperty("--fs-title", fs.toFixed(2) + "px");
    root.style.setProperty("--fs-sub", subFs.toFixed(2) + "px");
}

/* Reveal cells column by column (slight diagonal) with a moving block cursor. */
async function type(b, { colMs, rowMs, isDone }) {
    const cursor = b.pre.querySelector(".acursor");
    cursor.classList.add("on");
    const start = performance.now();
    const pending = b.cells.map(([col, row, el, kind]) => ({ el, at: col * colMs + row * rowMs + (kind === "drip" ? 120 + (row - 6) * 40 : 0) }))
        .sort((a, z) => a.at - z.at);
    const end = pending.length ? pending[pending.length - 1].at : 0;
    let i = 0;
    await new Promise((done) => {
        const step = () => {
            const t = isDone() ? Infinity : performance.now() - start;
            while (i < pending.length && pending[i].at <= t) {
                const el = pending[i++].el;
                el.classList.remove("off");
                el.classList.add("hot");
                setTimeout(() => el.classList.remove("hot"), 90);
            }
            cursor.style.setProperty("--col", String(Math.min(b.cols, Math.floor(t / colMs))));
            if (i >= pending.length && t >= end) { cursor.classList.remove("on"); return done(); }
            setTimeout(step, 16);            // timers, not rAF: keeps going in background tabs
        };
        step();
    });
}

/* What the address on screen means. `preview` comes from the local preview's config only. */
export function addressLine(preview, host = location.host) {
    if (preview) return { label: "local preview on this computer", value: host };
    return { label: "connected via", value: host };
}

/* sessionP resolves true/false; ready resolves when the app has mounted what comes next;
 * piAddresses (optional) resolves to the Pi's own interface addresses from authenticated
 * server data, or null. Resolves after the intro is gone. */
export function runIntro({ sessionP, ready = Promise.resolve(), reduced, preview = "", piAddresses = null }) {
    return new Promise((resolve) => {
        const began = performance.now();
        let done = false, finishing = false;
        const narrow = innerWidth < 600 && innerHeight > innerWidth;
        const titles = titleBlocks(narrow);
        const sub = block("ARCHINET", "sub", { distress: false });
        const cmd = h("span", { class: "cmd" });
        const welcome = h("div", { class: "intro-welcome" });
        const status = h("div", { class: "intro-status", role: "status", "aria-live": "polite" });
        const skip = h("button", { class: "intro-skip", type: "button", "aria-label": "Skip introduction (Escape)" }, "skip", h("kbd", {}, "esc"));
        // "by" in 3D-ASCII (real text); same slot and fade as before, so the timeline is unchanged.
        const by = h("div", { class: "intro-by off" }, h("pre", { class: "ascii by3d", "aria-hidden": "true" },
            ...byCells().map(row => h("span", { class: "arow" }, ...row.map(c => c.kind === "space" ? " " : h("span", { class: `k-${c.kind}` }, c.ch))))));
        const addr = addressLine(preview);
        const pi = h("span", { class: "intro-pi" });
        const root = h("div", { class: "intro2" + (reduced ? " reduced" : "") + (narrow ? " narrow" : ""), role: "dialog", "aria-modal": "true", "aria-label": "Archimet, by Archinet" },
            h("div", { class: "intro-prompt" }, h("span", { class: "sig" }, "$ "), cmd, h("span", { class: "caret" })),
            h("div", { class: "intro-stage" },
                h("h1", { class: "sr-only" }, "Archimet, by Archinet"),
                ...titles.map(t => t.pre), by, sub.pre, welcome, status),
            h("div", { class: "intro-foot" },
                h("span", { class: "intro-addr" }, h("span", { class: "faint" }, addr.label + " "), h("span", { class: "mono" }, addr.value), pi),
                h("span", { class: "intro-mid" }, h("span", { class: "kismet" }, "built on kismet"), socialLinks("intro-social")),
                skip));
        document.body.append(root);
        fit(root, titles, sub);
        const onResize = () => fit(root, titles, sub);
        addEventListener("resize", onResize);

        const finish = async () => {
            if (finishing) return;
            finishing = done = true;
            document.removeEventListener("keydown", onKey, true);
            removeEventListener("resize", onResize);
            await ready;                                   // fade into the real screen, never into nothing
            root.classList.add("out");
            setTimeout(() => { root.remove(); resolve(); }, reduced ? 0 : 480);
        };
        /* Only Escape skips (the screen says "esc"); Tab moves to Skip and the social links,
         * whose own Enter/Space work as usual. Other keys never reach the sign-in form below. */
        const onKey = (e) => {
            // The Escape that skips the intro must not also reach the page underneath
            // (it would close an inspector or clear a search there).
            if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish(); return; }
            if (e.key === "Tab") return;
            if ((e.key === "Enter" || e.key === " ") && e.target && root.contains(e.target) && e.target.matches("button, a")) return;
            e.preventDefault();
            e.stopPropagation();
        };
        document.addEventListener("keydown", onKey, true);
        skip.addEventListener("click", finish);
        skip.focus({ preventScroll: true });

        if (piAddresses) piAddresses.then((list) => {
            if (!list || !list.length || done) return;
            pi.textContent = "";
            pi.append(h("span", { class: "faint" }, " · pi reports "), h("span", { class: "mono" }, list.map(a => `${a.iface} ${a.ipv4}`).join(", ")));
        }).catch(() => {});

        const sessionText = (ok) => ok === null ? ["kismet is slow to answer · continuing", "warn"]
            : ok ? ["session valid · opening devices", "ok"] : ["no active session · sign in to continue", "warn"];
        const typeText = async (el, text, ms = 14) => {
            for (let i = 1; i <= text.length && !done; i += 2) { el.textContent = text.slice(0, i); await sleep(ms); }
            el.textContent = text;
        };

        (async () => {
            if (reduced) {
                cmd.textContent = "archimet";
                for (const b of [...titles, sub]) b.cells.forEach(([, , el]) => el.classList.remove("off"));
                by.classList.remove("off");
                welcome.textContent = WELCOME;
                status.textContent = "checking kismet session";
                const ok = await Promise.race([sessionP, sleep(6000).then(() => null)]);
                if (done) return;
                const [text, cls] = sessionText(ok);
                status.className = "intro-status " + cls;
                status.textContent = text;
                await sleep(Math.max(1200, 3200 - (performance.now() - began)));   // time to read, no motion
                return finish();
            }
            for (const ch of "archimet") { if (done) break; cmd.textContent += ch; await sleep(40); }
            await sleep(done ? 0 : 100);
            for (const t of titles) await type(t, { colMs: narrow ? 20 : 15, rowMs: 9, isDone: () => done });
            by.classList.remove("off");
            await sleep(done ? 0 : 120);
            await type(sub, { colMs: 7, rowMs: 6, isDone: () => done });
            if (done) return;
            await typeText(welcome, WELCOME, 12);
            status.className = "intro-status wait";
            status.textContent = "checking kismet session";
            const ok = await Promise.race([sessionP, sleep(6000).then(() => null)]);
            if (done) return;
            const [text, cls] = sessionText(ok);
            status.className = "intro-status " + cls;
            await typeText(status, text, 10);
            await sleep(Math.max(250, TOTAL_MS - 480 - (performance.now() - began)));
            finish();
        })();
    });
}
