// SPDX-License-Identifier: GPL-2.0-or-later
/* Settings, grouped. Each control says whether it changes this browser or the Kismet server. */

import { h, svg, clear } from "../lib/util.js";
import { ICON, MARK } from "../ui/art.js";
import { kismet, session } from "../api/kismet.js";
import { config } from "../api/archimet.js";
import { current } from "../lib/hub.js";
import { run as runCompat } from "../api/compat.js";
import { prefsGet, prefsSet, prefsReset, prefsReplace } from "../lib/store.js";
import { TAGS, TAG, GROUPS as TAG_GROUPS, DEFAULT_TAG_PREFS, tagContrast, readable } from "../lib/tags.js";
import { applyPrefs } from "../lib/theme.js";
import { socialLinks } from "../ui/intro.js";
import { changeAccount, signedInUser } from "../ui/login.js";
import { route, dialog, toast } from "../ui/shell.js";

const GROUPS = [
    ["appearance", "Appearance"],
    ["categories", "Tags & colours"],
    ["notifications", "Notifications"],
    ["units", "Units"],
    ["sources", "Sources"],
    ["privacy", "Data & privacy"],
    ["account", "Account"],
    ["about", "About & credits"],
];

const scope = (server) => h("span", { class: "scope" + (server ? " server" : "") }, server ? "Kismet server" : "This browser");
const title = (t, server) => h("div", { class: "set-title" }, h("h2", { class: "h1" }, t), scope(server));

function group(label, help, ctl) {
    return h("div", { class: "set-group" }, h("div", { class: "label" }, label), ctl ? h("div", { class: "ctl" }, ctl) : null, help ? h("div", { class: "help" }, help) : null);
}

function seg(options, value, onPick) {
    const box = h("div", { class: "seg", role: "group" });
    for (const [v, label] of options)
        box.append(h("button", { type: "button", "aria-pressed": v === value ? "true" : "false", onclick: () => {
            box.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", "false"));
            box.querySelector(`[data-v="${v}"]`).setAttribute("aria-pressed", "true");
            onPick(v);
        }, "data-v": v }, label));
    return box;
}

function toggle(checked, onChange) {
    return h("label", { class: "switch" }, h("input", { type: "checkbox", checked, onchange: (e) => onChange(e.target.checked) }));
}

const PANES = {
    appearance(sec) {
        const p = prefsGet();
        sec.append(title("Appearance", false),
            group("Motion", "System follows your device's reduced-motion setting.", seg([["system", "System"], ["reduced", "Reduced"], ["full", "Full"]], p.motion, (v) => { prefsSet({ motion: v }); applyPrefs(); })),
            group("Introduction", "The five-second opening each time Archimet is opened or reloaded in this browser (never when moving between pages). Escape or Skip ends it.",
                seg([["load", "Each time Archimet opens"], ["off", "Off"]], p.intro === "off" ? "off" : "load", (v) => prefsSet({ intro: v }))),
            group("Row density", "Compact fits more devices; comfortable is easier to tap.", seg([["comfortable", "Comfortable"], ["compact", "Compact"]], p.density, (v) => { prefsSet({ density: v }); applyPrefs(); })),
            group("Times", "Relative (“2m ago”) or the clock time.", seg([["relative", "Relative"], ["absolute", "Clock"]], p.timestamps, (v) => prefsSet({ timestamps: v }))),
            group("Layout", "Column widths, the sidebar and the Review list keep the sizes you drag them to, in this browser.",
                h("button", { class: "btn", type: "button", onclick: () => { prefsReplace("layout", {}); location.reload(); } }, "Reset layout")),
            group("Play the introduction", "", h("button", { class: "btn", type: "button", onclick: () => import("../app.js").then(m => m.replayIntro()) }, "Play now")));
    },
    categories(sec) {
        const p = prefsGet();
        // Live preview: one sample row with every kind of tag, redrawn on each change.
        const preview = h("div", {});
        function drawPreview() {
            const cur = prefsGet().tags;
            const sample = (marker, name, sub, tags) => {
                const shown = tags.filter(([id]) => TAG[id].locked || !(cur[id] && cur[id].show === false));
                const row = h("div", { class: `lrow m-${marker}`, style: { gridTemplateColumns: "minmax(0, 1fr) auto", cursor: "default" } },
                    h("div", { class: "who" }, h("div", { class: "names" }, h("span", { class: "name" }, name), h("span", { class: "sub mac" }, sub))),
                    h("div", { class: "badges" }, ...shown.map(([id, text]) => h("span", { class: `badge b-${id}`, title: TAG[id].help }, text || TAG[id].label))));
                return row;
            };
            clear(preview).append(h("div", { class: "list", style: { maxWidth: "760px" } },
                sample("confirmed", "Axon Body 3 X81234", "marker: LE log · model name broadcast", [["confirmed"], ["bodycam"], ["vendor", "Vendor match: Axon"], ["seen"]]),
                sample("confirmed", "BLE · no name advertised", "marker: LE log · equipment not identified", [["confirmed"], ["vendor", "Vendor match: Axon"]]),
                sample("confirmed", "Unit-14", "marker: LE log · your mark", [["confirmed"], ["operator"]]),
                sample("watch", "E110-t01", "marker: Watch (outranks Review)", [["review"], ["watch"]]),
                sample("review", "CityPolice", "marker: Review", [["review"]]),
                sample("wifi-client", "Client · no name", "marker: radio type", [["seen"]]),
                sample("ble", "BLE · no name advertised", "marker: radio type", [])));
        }
        const groups = TAG_GROUPS.map(([g, label, help]) => h("fieldset", { class: "tag-group" }, h("legend", {}, label),
            h("p", { class: "faint", style: { margin: "0 0 8px", fontSize: "12.5px", lineHeight: "1.5" } }, help),
            h("div", { class: "swatches" }, ...TAGS.filter(t => t.group === g).map(t => {
                const cur = p.tags[t.id] || { show: true, color: t.color };
                const note = h("div", { class: "faint", style: { fontSize: "12px", marginTop: "4px" } });
                const showNote = (c) => { const k = tagContrast(c); note.textContent = `${t.help} Contrast ${k.text.toFixed(1)}:1 text, ${k.marker.toFixed(1)}:1 marker.`; };
                showNote(cur.color);
                const input = h("input", { type: "color", value: cur.color, "aria-label": `${t.label} colour`, oninput: (e) => {
                    const c = e.target.value;
                    if (!readable(c)) {                // never apply a colour that makes the tag unreadable
                        note.textContent = `Not applied: ${c} is too hard to read on Archimet's black background (needs 4.5:1 text and 3:1 marker contrast).`;
                        note.className = "warnline"; return;
                    }
                    note.className = "faint"; showNote(c);
                    prefsSet({ tags: { [t.id]: { color: c } } }); applyPrefs(); drawPreview();
                } });
                const show = h("input", { type: "checkbox", checked: t.locked || cur.show !== false, disabled: !!t.locked,
                    "aria-label": `Show ${t.label}`, onchange: (e) => { prefsSet({ tags: { [t.id]: { show: e.target.checked } } }); applyPrefs(); drawPreview(); } });
                return h("div", { class: "swatch" }, input, h("div", { style: { minWidth: 0 } },
                    h("label", { class: "check", style: { gap: "8px" } }, show, h("span", { class: `badge b-${t.id}` }, t.label),
                        t.locked ? h("span", { class: "faint", style: { fontSize: "12px" } }, "always shown") : null),
                    note));
            }))));
        drawPreview();
        sec.append(title("Tags & colours", false),
            h("p", { class: "dim", style: { lineHeight: "1.6", maxWidth: "76ch" } },
                "Archimet keeps three things apart: the radio type Kismet reports, the LE equipment subtype (only when evidence identifies it), and evidence/workflow (LE log, Vendor match, Associated, Operator mark, Review, Watch). None of them establishes police ownership or use. Every tag is text, so colour is never the only cue, and colours are a display preference only: they never change what the data says. Each row has one marker for its strongest tag: LE log, then Watch, then Review, then radio type."),
            group("Preview", "", preview),
            ...groups,
            group("Marker style", "", seg([["edge", "Edge + badges"], ["badge", "Badges only"]], p.marker, (v) => { prefsSet({ marker: v }); applyPrefs(); })),
            group("Reset", "Restores every tag's default colour and shows every tag again.", h("button", { class: "btn", type: "button", onclick: () => {
                prefsSet({ tags: structuredClone(DEFAULT_TAG_PREFS) }); applyPrefs(); clear(sec); PANES.categories(sec); } }, "Reset to Archimet defaults")));
    },
    notifications(sec) {
        const p = prefsGet();
        sec.append(title("Notifications", false),
            group("Review device seen again", "One pop-up when an unconfirmed device returns after 30+ minutes away (the logger limits this to once per 6 h per device). Watched devices always notify.", toggle(p.notify.review, (v) => prefsSet({ notify: { review: v } }))),
            group("New LE device logged", "A pop-up when a device is added to the LE log by a vendor ID rule or a learned connection.", toggle(p.notify.le, (v) => prefsSet({ notify: { le: v } }))),
            h("p", { class: "faint", style: { fontSize: "12.5px" } }, "The re-sighting history itself is recorded by the logger on the Pi for everyone; these switches only control pop-ups in this browser."));
    },
    units(sec) {
        const p = prefsGet();
        sec.append(title("Units", false),
            group("Distance and speed", "", seg([["metric", "Metric"], ["imperial", "Imperial"]], p.units.distance, (v) => prefsSet({ units: { distance: v } }))),
            group("Temperature", "Used for the Pi's thermal sensors.", seg([["c", "°C"], ["f", "°F"]], p.units.temperature, (v) => prefsSet({ units: { temperature: v } }))));
    },
    sources(sec) {
        const list = current("sources") || [];
        sec.append(title("Sources", true),
            h("p", { class: "dim", style: { lineHeight: "1.6" } }, "Capture sources are defined in /etc/kismet/kismet_site.conf on the Pi. Nothing is logged as packets or handshakes. Wi-Fi capture is passive; the Bluetooth (hci0) source actively scans. Channel locking and hopping are on the Sources page and apply to the server."),
            ...list.map(s => group(s["kismet.datasource.name"], `${s["kismet.datasource.interface"]} · ${s["kismet.datasource.running"] ? "running" : "not running"} · ${s["kismet.datasource.hopping"] ? "hopping" : "locked " + s["kismet.datasource.channel"]}`,
                h("a", { class: "btn", href: "#/sources" }, "Open"))));
    },
    privacy(sec) {
        /* Every statement here was checked against the logger code, the Pi's Kismet configuration
         * and a restart test (docs/AUDIT-2026-10-21.md, section B). */
        const block = (heading, where, intro, rows) => h("section", { class: "priv" },
            h("div", { class: "priv-head" }, h("h3", {}, heading), where ? scope(where === "server") : null),
            intro ? h("p", { class: "dim" }, intro) : null,
            rows ? h("dl", { class: "kv" }, ...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])) : null);
        sec.append(h("div", { class: "set-title" }, h("h2", { class: "h1" }, "Data & privacy")),
            block("What Archimet logs on the Pi", "server", "In the Archimet data folder on the Pi (ARCHIMET_OUT in /etc/default/archimet; normally /var/lib/archimet/archimet-logs). Readable on the Pi by the service account and root; sent over the network only to a signed-in browser.", [
                ["Access points", "access_points.sqlite · MAC, network name, type, encryption, channel, manufacturer, hidden flag, first seen (date and time), last seen (date only). One row per MAC. No automatic expiry."],
                ["Wi-Fi clients", "wifi_clients.sqlite · MAC, manufacturer, name, network names it asked for, last access point, type, first and last seen. Randomized (locally administered) MACs are not written. No automatic expiry."],
                ["LE log", "law_enforcement.sqlite · one row per MAC with its evidence. A row leaves when you unmark it or its learned parent is withdrawn. A private JSON copy (le_history.json, mode 0640) is not served by Kismet."],
                ["Review & audit", "archimet_review.sqlite · unconfirmed devices with reasons, your Mark/Unmark actions and notes, the last 20 sighting sessions per device, and re-sighting notices. The audit and notices have no automatic expiry."],
                ["Hardware", "hardware_events.json · the last 500 power, USB and capture-source events (logger 5.2). The CPU and temperature trend is kept in memory only, for up to 24 h."],
            ]),
            block("What Kismet keeps", "server", null, [
                ["Device list", "In memory for the current Kismet run; cleared when Kismet restarts. Kismet's own capture logs are turned off (enable_logging=false)."],
                ["Names and notes", "Names and notes you give devices are stored by Kismet in ~/.kismet/devicetracker.db3 and survive restarts until removed."],
            ]),
            block("Never stored", null, null, [
                ["Capture data", "No packet captures (pcap or Kismet logs), payloads, or WPA handshakes (dot11_keep_eapol=false)."],
                ["Transmission", "Monitoring is receive-only: nothing is transmitted, no deauthentication and no active probes."],
            ]),
            block("In this browser", "browser", null, [
                ["Preferences", "Colours, column widths, device filters, units, notification switches and the intro choice, in this browser's local storage (archimet.prefs.v2). The Devices sort is not saved: each visit starts with Last heard, newest first."],
                ["Session", "One session cookie (ARCHIMET, issued by the Archimet gateway; HttpOnly, SameSite=Strict, HTTPS-only when HTTPS is on). It ends on sign-out, after 2 h without activity, when the account changes, or when the Pi or its gateway restarts. Archimet never stores your password."],
            ]),
            block("Who can see it", null, null, [
                ["Sign-in", "Every device, LE, Review, history, note, location and hardware request needs a sign-in with the Archimet account; the gateway and the logger both check it."],
                ["Without sign-in", "Only the interface's own files, the public local-CA certificate, the setup check and the logger's version answer. Until setup is finished and HTTPS is on, other devices get nothing at all."],
                ["Network", "No telemetry, web fonts, CDNs or outside requests; Archimet works on the Pi's hotspot without internet. Social links open only when you click them."],
            ]),
            group("Clear this browser's Archimet preferences", "Restores defaults here; nothing on the Pi changes.", h("button", { class: "btn", type: "button", onclick: () => { prefsReset(); applyPrefs(); toast("Cleared", "Preferences reset in this browser."); } }, "Clear")));
    },
    account(sec) {
        const ro = config().readonly;
        const keys = h("div", {}, h("div", { class: "loading" }, "reading API keys"));
        kismet.apiKeys().then(list => {
            clear(keys).append(list && list.length
                ? h("table", { class: "table" }, h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Role"))),
                    h("tbody", {}, ...list.map(k => h("tr", {}, h("td", {}, k["kismet.httpd.auth.name"] || k.name || "—"), h("td", {}, k["kismet.httpd.auth.role"] || k.role || "—")))))
                : h("p", { class: "dim", style: { margin: 0 } }, "No API keys. Kismet API keys let scripts read the REST API without the password."));
        }).catch(e => clear(keys).append(h("p", { class: "dim" }, `Not available (${e.status || "no answer"}).`)));
        sec.append(title("Account", true),
            group("Session", "Sign out ends this browser's session on the Pi (at the Archimet gateway), not only here. Sessions also end after 2 hours without activity, when the account changes, and when the Pi restarts.",
                h("button", { class: "btn", type: "button", onclick: signOut }, svg(ICON.signout), "Sign out")),
            group("User name", "The name you sign in with (one Archimet account per Pi; separate from the Pi's Linux login). Your current password is checked first; every other signed-in browser is signed out.",
                h("button", { class: "btn", type: "button", disabled: ro, onclick: () => changeAccountDialog("user") }, svg(ICON.lock), "Change user name…")),
            group("Password", "At least 10 characters, not the default and not the user name. Your current password is checked first; every other signed-in browser is signed out.",
                h("button", { class: "btn", type: "button", disabled: ro, onclick: () => changeAccountDialog("password") }, svg(ICON.lock), "Change password…")),
            h("div", { class: "set-group" }, h("div", { class: "label" }, "API keys (capture engine)"), h("div", { class: "help", style: { gridColumn: "1 / -1" } }, keys)),
            ...(ro ? [h("p", { class: "readonly-note" }, "Read-only preview: account changes are disabled.")] : []));
    },
    about(sec) {
        const st = current("status") || {};
        const box = h("ul", { class: "compat" }, h("li", { class: "faint" }, "not run yet"));
        const ext = (href, text) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
        const FEATURES = [
            ["Its own interface", "Archimet's own gateway serves this interface and the parts of Kismet's REST API it needs; Kismet runs behind it on the Pi itself and its stock pages are never reachable. Kismet itself is not modified."],
            ["Wi-Fi and Bluetooth", "Wi-Fi capture is passive (monitor mode; nothing is transmitted). Kismet's Linux Bluetooth source (hci0) is an active scan, not passive capture: it asks nearby devices to identify themselves and reports what they advertise, not packets; on this Pi it reports MAC, type and band only."],
            ["Separate logs", "Access points, Wi-Fi clients and LE devices each have their own log on the Pi, one row per MAC, with first and last seen."],
            ["Evidence, not guesses", "A device enters the LE log by a vendor match (its MAC prefix belongs to an LE-equipment maker), an association (data frames with a device already in the LE log), or your mark with a note. Each row names its evidence; none of them proves police ownership or use. A probe alone is never treated as a connection."],
            ["Review", "Uncertain devices (fleet vendors, agency words, model names) go to Review with reasons for and against, and never count as LE until you mark them."],
            ["Re-sighting", "Each Review device keeps its last 20 sighting sessions; watched devices notify you when they are heard again."],
            ["Notes", "Mark and Unmark require a note and are kept in an audit trail; Kismet device names and notes are editable in the inspector."],
            ["Clear device labels", "Radio band, category and an explanation of why a device has no name (hidden network, no beacon heard, client, BLE)."],
            ["Hardware health", "Power and throttling, CPU, temperature, memory, disk, USB and capture-source events from the Pi itself."],
            ["Private and offline", "Every data request needs the Archimet sign-in. No telemetry, outside fonts or scripts; it works on the Pi's hotspot without internet."],
        ];
        sec.append(
            h("div", { class: "about" },
                h("div", { class: "brandline about-brand" }, svg(MARK), h("b", { class: "mono" }, "ARCHIMET")),
                h("p", { class: "lede" }, "Archimet is a radio monitor for a Raspberry Pi, built by Archinet on top of Kismet. It watches the Wi-Fi and Bluetooth around it, keeps careful logs, and keeps what was observed apart from what is only suspected."),
                h("h3", {}, "What Archimet adds to Kismet"),
                h("dl", { class: "features" }, ...FEATURES.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
                h("h3", {}, "Credits and licences"),
                h("p", { class: "dim" }, "Built on Kismet ", h("span", { class: "mono" }, st["kismet.system.version"] || ""), " by Mike Kershaw (Dragorn) and contributors. Kismet is free software under the ",
                    ext("https://www.gnu.org/licenses/old-licenses/gpl-2.0.html", "GNU General Public License v2"), "; its source is at ", ext("https://www.kismetwireless.net/", "kismetwireless.net"), "."),
                h("p", { class: "dim" }, "Archimet's interface and logger are by Archinet and use no third-party libraries, fonts or images."),
                h("h3", {}, "Archinet"),
                h("p", { class: "social-row" }, socialLinks())),
            h("div", { class: "set-group" }, h("div", { class: "label" }, "Compatibility with this Kismet"),
                h("div", { class: "ctl" }, h("button", { class: "btn", type: "button", onclick: async (e) => {
                    e.target.disabled = true;
                    clear(box).append(h("li", { class: "faint" }, "checking…"));
                    const r = await runCompat();
                    clear(box).append(...r.results.map(x => h("li", { class: x.ok ? "ok" : "bad" }, `${x.ok ? "ok  " : "!!  "}${x.id} — ${x.screen}${x.ok ? "" : " — missing: " + x.missing.join(", ")}`)),
                        h("li", { class: "faint" }, `contract written for ${r.tested_with}`));
                    e.target.disabled = false;
                } }, "Check now")),
                h("div", { class: "help" }, "Checks every Kismet endpoint and field Archimet relies on. Run it after a Kismet update; anything marked !! needs an Archimet update.", box)));
    },
};

async function signOut() {
    try { await session.logout(); } catch (e) { /* the cookie is gone either way after reload */ }
    toast("Signed out", "This browser's session has ended.");
    setTimeout(() => location.reload(), 600);
}

/* what: "user" (new user name, password kept) or "password" (new password, user name kept). */
async function changeAccountDialog(what) {
    const field = (type, auto) => h("input", { class: "field", type, autocomplete: auto, spellcheck: "false", autocapitalize: "none" });
    const curUser = field("text", "username"), curPass = field("password", "current-password");
    const newUser = field("text", "off"), p1 = field("password", "new-password"), p2 = field("password", "new-password");
    curUser.value = signedInUser();
    const user = what === "user";
    const body = h("div", { class: "frame-body account-form" },
        h("label", { class: "eyebrow" }, "Current user name"), curUser,
        h("label", { class: "eyebrow" }, "Current password"), curPass,
        ...(user ? [h("label", { class: "eyebrow" }, "New user name"), newUser,
                    h("p", { class: "hint" }, "1-32 letters, digits, dots, dashes or underscores. Your password stays the same.")]
            : [h("label", { class: "eyebrow" }, "New password"), p1, h("label", { class: "eyebrow" }, "New password again"), p2,
               h("p", { class: "hint" }, "At least 10 characters, not the default and not the user name. Your user name stays the same.")]));
    const ok = await dialog(user ? "Change user name" : "Change password", body,
        { actions: [["Cancel", false, "ghost"], [user ? "Change user name" : "Change password", true, "primary"]] });
    const wipe = () => { curPass.value = p1.value = p2.value = ""; };
    if (!ok) { wipe(); return; }
    if (user ? !newUser.value.trim() : !p1.value) { wipe(); toast("Not changed", user ? "Enter a new user name." : "Enter a new password.", { color: "var(--bad)" }); return; }
    if (!user && p1.value !== p2.value) { wipe(); toast("Not changed", "The new passwords differ.", { color: "var(--bad)" }); return; }
    const r = await changeAccount({ currentUser: curUser.value, currentPassword: curPass.value,
        newUser: user ? newUser.value.trim() : "", newPassword: user ? "" : p1.value });
    wipe();
    toast(r.ok ? (user ? "User name changed" : "Password changed") : "Not changed", r.message, r.ok ? {} : { color: "var(--bad)" });
    if (r.relogin) setTimeout(() => location.reload(), 900);
}

route("settings", {
    title: "Settings", eyebrow: "archimet",
    mount(main, args) {
        let cur = GROUPS.some(g => g[0] === args[0]) ? args[0] : "appearance";
        const nav = h("nav", { "aria-label": "Settings" });
        const sec = h("section", {});
        function show(id) {
            cur = id;
            nav.querySelectorAll("button").forEach(b => b.setAttribute("aria-current", b.dataset.g === id ? "true" : "false"));
            history.replaceState(null, "", `#/settings/${id}`);
            clear(sec);
            PANES[id](sec);
        }
        for (const [id, label] of GROUPS) nav.append(h("button", { type: "button", "data-g": id, onclick: () => show(id) }, label));
        main.append(h("div", { class: "page" }, h("div", { class: "settings" }, nav, sec)));
        show(cur);
    },
    update(args) { if (args[0]) document.querySelector(`.settings nav [data-g="${args[0]}"]`)?.click(); },
});
