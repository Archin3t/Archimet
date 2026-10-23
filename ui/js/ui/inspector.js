/* Device inspector: disclosure tree over the real Kismet record plus the logger's view of
 * the MAC. Nothing here is synthesised; absent data says so. No packets are kept or shown. */

import { h, svg, clear, absTime, relTime, macColon, bytes, num, channelOf, get, isRandomized, serverNow } from "../lib/util.js";
import { ICON } from "./art.js";
import { kismet } from "../api/kismet.js";
import { archimet, config } from "../api/archimet.js";
import { current, known, refresh } from "../lib/hub.js";
import { category, badgesFor, markerFor, assocEvidence, kindOf, identity, identityFields } from "../lib/classify.js";
import { radioInfo, radioTitle } from "../lib/band.js";
import { TAG, subtypesOf, vendorOf, reasonParts } from "../lib/tags.js";
import { lastObserved, observedText, exactLocal, heardStatus, newestByMac } from "../lib/heard.js";
import { prefsGet } from "../lib/store.js";
import { askNote, toast, navigate } from "./shell.js";

let panel = null;
let openToken = 0;           // request order: only the newest open/openByMac may render
let shownMac = "";           // what the panel shows now (delayed refreshes re-open only this)
let lookupFailed = false;   // the last Kismet lookup failed (unknown), as opposed to "not in this run"

const SIBLING_FIELDS = ["kismet.device.base.key", "kismet.device.base.macaddr", "kismet.device.base.phyname",
    "kismet.device.base.type", "kismet.device.base.last_time"];
/* Of several Kismet records for one MAC, show the one that defines its role (as the logger does):
 * AP, then Wi-Fi client, then other 802.11, then Bluetooth; newest first within a role. */
const ROLE = (r) => r["kismet.device.base.phyname"] !== "IEEE802.11" ? (/bluetooth|btle/i.test(r["kismet.device.base.phyname"]) ? 3 : 4)
    : /AP$|Ad-Hoc|WDS$/.test(r["kismet.device.base.type"]) ? 0 : /Client|Bridged|Device/.test(r["kismet.device.base.type"]) ? 1 : 2;
const byRole = (a, b) => ROLE(a) - ROLE(b) || (b["kismet.device.base.last_time"] || 0) - (a["kismet.device.base.last_time"] || 0);

function ensure() {
    if (panel && panel.isConnected) return panel;
    panel = h("aside", { class: "inspector", hidden: true, "aria-label": "Device inspector" });
    document.getElementById("main").append(panel);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel && !panel.hidden && !document.querySelector(".scrim")) close(); });
    return panel;
}

export function close() {
    if (!panel) return;
    panel.hidden = true;
    document.querySelectorAll(".lrow[aria-selected='true'], .card-row[aria-selected='true']").forEach(r => r.setAttribute("aria-selected", "false"));
    if (/^#\/devices\/./.test(location.hash)) history.replaceState(null, "", "#/devices");
}

const badge = (b) => h("span", { class: `badge b-${b.id}`, title: b.title || "" }, b.text);
const kv = (pairs) => h("dl", { class: "kv" }, ...pairs.filter(Boolean).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v == null || v === "" ? h("span", { class: "faint" }, "—") : v)]));

function section(title, summary, body, open = false) {
    return h("details", { open },
        h("summary", {}, h("span", { class: "tw" }, svg(ICON.chevron)), title, summary ? h("span", { class: "sum" }, summary) : null),
        h("div", { class: "node" }, body));
}

function macLink(mac) {
    return h("a", { href: "#", class: "mono", onclick: (e) => { e.preventDefault(); openByMac(mac); } }, mac);
}

export async function openByMac(mac) {
    const m = macColon(mac);
    ensure();
    const token = ++openToken;
    let list = null, failed = false;
    try { list = await kismet.deviceByMac(m, SIBLING_FIELDS); } catch (e) { failed = true; }   // unknown, not "absent"
    if (token !== openToken) return;                   // a newer open() started meanwhile
    const recs = Array.isArray(list) ? list.slice().sort(byRole) : [];
    if (recs.length) return open(recs[0]["kismet.device.base.key"], m, recs);
    lookupFailed = failed;
    return open(null, m, failed ? null : []);
}

/* siblings: every Kismet record with this MAC (null = lookup failed, undefined = not asked yet). */
export async function open(key, macHint = "", siblings) {
    ensure();
    const token = ++openToken;
    panel.hidden = false;
    clear(panel).append(h("div", { class: "loading" }, "reading device"));
    let dev = null;
    if (key) {
        try { dev = await kismet.device(key); lookupFailed = false; } catch (e) { dev = null; lookupFailed = true; }
    }
    if (token !== openToken) return;
    const mac = macHint || (dev && dev["kismet.device.base.macaddr"]) || "";
    if (dev && siblings === undefined) {
        try { siblings = await kismet.deviceByMac(macColon(mac), SIBLING_FIELDS); } catch (e) { siblings = null; }
        if (token !== openToken) return;
    }
    render(dev, mac, siblings, token);
}

async function render(dev, mac, siblings, token) {
    mac = String(mac).toUpperCase();
    shownMac = mac;
    const st = current("state") || {};
    const idx = st.index || { official: new Map(), review: new Map() };
    const status = current("status") || {};
    const kStart = status["kismet.system.timestamp.start_sec"] || 0;
    const kn = (await known([mac]))[mac];
    if (token !== openToken) return;                   // superseded while the logger answered
    // Heard / Last observed use the newest last_time of all Kismet records with this MAC.
    const recs = Array.isArray(siblings) ? siblings : [];
    const newest = newestByMac(dev ? [...recs, dev] : recs).get(mac);
    const heardLookup = lookupFailed ? { ok: false, last: new Map() }
        : { ok: true, kismetNow: serverNow(), kismetStart: kStart, last: new Map(newest ? [[mac, newest]] : []) };
    const off = idx.official.get(mac), rv = idx.review.get(mac);
    const cat = category(dev ? { phy: dev["kismet.device.base.phyname"], type: dev["kismet.device.base.type"] } : { phy: off && off.radio === "Bluetooth" ? "Bluetooth" : "IEEE802.11", type: (off || rv || {}).type || "" });
    const idf = dev ? identityFields(dev) : {};
    const badges = badgesFor(mac, idx, kn, kStart, dev ? { phy: idf.phy, type: idf.type, name: idf.name, ssid: idf.ssid } : {});
    const marker = markerFor(cat, badges);
    const ident = dev ? identity(identityFields(dev)) : null;
    const advRec = dev && (dev["dot11.device"] || {})["dot11.device.last_beaconed_ssid_record"];
    const bd = dev ? radioInfo({ phy: dev["kismet.device.base.phyname"], type: dev["kismet.device.base.type"],
        freq: dev["kismet.device.base.frequency"], channel: dev["kismet.device.base.channel"],
        advChannel: advRec ? advRec["dot11.advertisedssid.channel"] : "", freqMap: dev["kismet.device.base.freq_khz_map"] }) : null;
    const name = dev ? ident.name : ((off && off.name) || (rv && rv.name));
    const ro = config().readonly;

    const head = h("div", { class: "insp-head" },
        h("div", {}, h("div", { class: "eyebrow" }, `${cat.label} · ${dev ? dev["kismet.device.base.phyname"] : lookupFailed ? "Kismet did not answer" : "not in this Kismet run"}`),
            h("h2", { class: "h1" }, name && name !== mac ? name : mac),
            h("div", { class: "mac" }, mac, isRandomized(mac) ? h("span", { class: "faint" }, "  · locally administered (randomized)") : null)),
        h("button", { class: "btn ghost iconbtn", type: "button", "aria-label": "Close inspector", onclick: close }, svg(ICON.close)),
        h("div", { class: "badges" }, h("span", { class: `badge b-${cat.radio}`, title: "Radio type, as Kismet reports it" }, cat.label), ...badges.map(badge)));
    panel.className = `inspector m-${marker}`;

    const tree = h("div", { class: "tree" });
    const d11 = (dev && dev["dot11.device"]) || {};
    const sig = (dev && dev["kismet.device.base.signal"]) || {};
    // Kismet's per-frequency packet counts for this device, most packets first.
    const freqs = Object.entries((dev && dev["kismet.device.base.freq_khz_map"]) || {}).map(([f, n]) => [Number(f), Number(n) || 0]).sort((a, b) => b[1] - a[1]);

    // Overview
    tree.append(section("Overview", newest ? `last heard ${relTime(newest)}` : "from the logs", kv([
        ["Name", name || (ident ? h("span", {}, ident.label, h("span", { class: "dim why" }, " — " + ident.reason)) : null)],
        ident && name && ident.reason ? ["Name source", ident.reason] : null,
        ["Radio", bd ? h("span", { class: bd.conflict ? "band-conflict" : "", title: radioTitle(bd) }, bd.conflict ? `${bd.conflict.text} (see Radio & identity)` : bd.detail) : null],
        ["MAC", h("span", { class: "mono" }, mac)],
        ["Manufacturer", dev ? dev["kismet.device.base.manuf"] : (off || rv || {}).manufacturer],
        ["Type", dev ? dev["kismet.device.base.type"] : (off || rv || {}).type],
        ["This Kismet run", dev ? `${absTime(dev["kismet.device.base.first_time"])} → ${absTime(dev["kismet.device.base.last_time"])}` : lookupFailed ? "unknown (Kismet did not answer)" : "not heard since Kismet started"],
        (off || rv) ? ["Heard", (() => {
            const s = heardStatus(mac, heardLookup);
            return h("span", { title: s.why }, s.label);
        })()] : null,
        ["In the logs", kn ? `${kn.log} log since ${kn.first_seen}` : "not in the access point / client logs"],
        ["LE log", off ? (() => {
            const subs = subtypesOf(off, { name: idf.name, ssid: idf.ssid, type: idf.type });
            const ev = off.kind === "hardware" ? `vendor match (${vendorOf(off)})` : off.kind === "operator" ? "operator mark" : "associated with an LE-log device";
            return h("span", { title: `Rule category: ${off.category || "—"}. That is the matching rule's category, not this device's type.` },
                `In the LE log · evidence: ${ev} · equipment: ${subs.length ? subs.map(x => TAG[x].label).join(", ") + " (model name it broadcast)" : "not identified (no model name observed)"} · police ownership or use: not established`);
        })() : "not listed"],
        ["Review", rv ? (rv.watch ? "open · watched" : "open") : "not listed"],
        (off || rv) ? ["Last observed", (() => {
            const o = lastObserved({ ...(off || rv), mac }, newest ? { ok: true, last: new Map([[mac, newest]]) } : null);
            // Full value and its source, never truncated.
            return o.precise
                ? h("span", {}, exactLocal(o.epoch), h("div", { class: "faint" }, `from ${o.source === "Kismet" ? "Kismet's last-heard time (this capture run)" : "the Archimet logger's minute-precision record"}`))
                : h("span", {}, observedText(o), h("div", { class: "faint" }, "Only the date was recorded for this row (before Archimet stored times of day); no time is invented."));
        })()] : null,
        recs.length > 1 ? ["Kismet records", h("span", { title: "Kismet keeps one record per radio type for a MAC. This panel shows the first; Heard and Last observed use the newest of all." },
            `${recs.length} for this MAC: ` + recs.map(r => `${r["kismet.device.base.type"] || r["kismet.device.base.phyname"]} (${relTime(r["kismet.device.base.last_time"])})`).join(", "))] : null,
        siblings === null && dev ? ["Kismet records", h("span", { class: "faint" }, "unknown: the per-MAC lookup failed, so other records for this MAC may be newer")] : null,
        ["Kismet notes", dev ? get(dev, ["kismet.device.base.tags", "notes"], null) : null],
    ]), true));

    // Radio & identity
    if (dev) {
        const adv = Object.values(d11["dot11.device.advertised_ssid_map"] || {}).map(r => r["dot11.advertisedssid.ssid"]).filter(Boolean);
        const probed = Object.values(d11["dot11.device.probed_ssid_map"] || {}).map(r => r["dot11.probedssid.ssid"]).filter(Boolean);
        const bt = dev["bluetooth.device"] || {};
        const srcs = current("sources") || [];
        const seenby = Object.values(dev["kismet.device.base.seenby"] || {}).map(s => {
            const src = srcs.find(x => x["kismet.datasource.uuid"] === s["kismet.common.seenby.uuid"]);
            return src ? src["kismet.datasource.name"] : s["kismet.common.seenby.uuid"];
        });
        tree.append(section("Radio & identity",
            `ch ${dev["kismet.device.base.channel"] || "—"}${bd.conflict ? " · conflicting readings" : ""} · ${sig["kismet.common.signal.last_signal"] != null ? sig["kismet.common.signal.last_signal"] + " dBm" : "no signal"}`,
            h("div", {},
                kv([
                    ["Band", bd.conflict ? h("span", { class: "band-conflict" }, "not stated: the readings conflict") : bd.detail],
                    ["Channel", h("span", {}, dev["kismet.device.base.channel"] || "—", h("span", { class: "faint" }, "  · Kismet's channel for the device"))],
                    advRec && advRec["dot11.advertisedssid.channel"] ? ["Beacon channel", h("span", {}, advRec["dot11.advertisedssid.channel"], h("span", { class: "faint" }, "  · announced in its last beacon"))] : null,
                    bd.differ ? ["Channel reports", h("span", { class: "band-differ" }, bd.differ.text + ". ", h("span", {}, bd.differ.why))] : null,
                    ["Last packet", dev["kismet.device.base.frequency"] ? h("span", {}, `${(dev["kismet.device.base.frequency"] / 1000).toFixed(0)} MHz`, h("span", { class: "faint" }, "  · the frequency tag of the most recent packet (the hopping radio's channel)")) : null],
                    freqs.length ? ["Heard on (this run)", freqs.map(([f, n]) => `${Math.round(f / 1000)} MHz ×${num(n)}`).join(" · ")] : null,
                    bd.readings ? ["Readings", h("span", { class: bd.conflict ? "band-conflict" : "" }, bd.conflict ? "Conflicting readings. " : bd.readings.state === "consistent" ? "Channel corroborated. " : bd.readings.state === "unverified" ? "Band unverified. " : "Not enough data. ", bd.readings.why,
                        bd.readings.note ? h("div", { class: "faint", style: { marginTop: "4px" } }, bd.readings.note) : null)] : null,
                    ["Signal", sig["kismet.common.signal.last_signal"] != null ? `${sig["kismet.common.signal.last_signal"]} dBm (min ${sig["kismet.common.signal.min_signal"]}, max ${sig["kismet.common.signal.max_signal"]})` : null],
                    ["Encryption", dev["kismet.device.base.crypt"]],
                    ["Packets", `${num(dev["kismet.device.base.packets.total"])} total · ${num(dev["kismet.device.base.packets.data"])} data · ${num(dev["kismet.device.base.packets.crypt"])} encrypted · ${num(dev["kismet.device.base.packets.error"])} errors`],
                    ["Data seen", bytes(dev["kismet.device.base.datasize"])],
                    adv.length ? ["Advertises", adv.join(", ")] : null,
                    probed.length ? ["Probes for", probed.join(", ")] : null,
                    bt["bluetooth.device.name"] ? ["BT name", bt["bluetooth.device.name"]] : null,
                    ["Heard by", seenby.join(", ") || null],
                ]))));
    }

    // Relationships
    const rel = h("div", {});
    if (dev) {
        const recs = Object.entries(d11["dot11.device.client_map"] || {});
        if (recs.length) {
            rel.append(h("div", { class: "eyebrow", style: { margin: "4px 0 6px" } }, "client records (this device → access point)"));
            for (const [bssid, rec] of recs) {
                const ev = assocEvidence(rec);
                rel.append(h("div", { class: "rel" },
                    macLink(bssid),
                    h("span", { class: ev.data ? "" : "dim" }, ev.data ? `connected: ${ev.evidence}` : "record only — could be a probe or connection attempt"),
                    h("span", { class: "faint mono" }, relTime(rec["dot11.client.last_time"]))));
            }
        }
        const clients = Object.keys(d11["dot11.device.associated_client_map"] || {});
        if (clients.length) {
            rel.append(h("div", { class: "eyebrow", style: { margin: "12px 0 6px" } }, `clients listed by this access point (${clients.length})`));
            for (const c of clients.slice(0, 40)) rel.append(h("div", { class: "rel" }, macLink(c), h("span", { class: "dim" }, idx.official.has(c) ? "in LE log" : idx.review.has(c) ? "in Review" : ""), h("span", {})));
            if (clients.length > 40) rel.append(h("div", { class: "faint" }, `…and ${clients.length - 40} more`));
        }
        const related = Object.keys(dev["kismet.device.base.related_devices"] || {});
        if (related.length) rel.append(h("p", { class: "dim" }, `Kismet groups ${related.length} related device record(s) with this one (same physical device on another interface or PHY). They stay separate rows; one row per MAC.`));
    }
    if (off && off.parent) rel.append(h("div", { class: "note-block", style: { "--c": "var(--c-learned)" } }, h("span", { class: "eyebrow" }, "learned from"), macLink(off.parent)));
    if (rv) for (const s of rv.signals || []) if (s.parent) rel.append(h("div", { class: "rel" }, macLink(s.parent), h("span", { class: "dim" }, s.detail || s.kind), h("span", {})));
    if (!rel.childNodes.length) rel.append(h("p", { class: "dim" }, dev ? "Kismet has no association records for this device in this run." : "No live record; relationships are only known while Kismet hears the device."));
    tree.append(section("Relationships", "", rel, !!(off && off.kind === "learned")));

    // Evidence & reasons
    const evb = h("div", {});
    if (off) evb.append(h("div", { class: "note-block", style: { "--c": "var(--t-confirmed)" } },
        h("span", { class: "eyebrow" }, `in the LE log · ${off.kind === "hardware" ? "vendor match" : off.kind === "learned" ? "associated" : "operator mark"}`), (() => {
            const rp = reasonParts(off.match_reason);
            return h("div", {}, rp.text, rp.ruleCategory ? h("div", { class: "faint", style: { marginTop: "4px", fontSize: "12.5px" } },
                `Rule category: ${rp.ruleCategory}. That describes the maker's product range, not this device, which is ${subtypesOf(off, { name: idf.name, ssid: idf.ssid, type: idf.type }).length ? "identified above by its model name" : "not identified"}.`) : null);
        })()));
    if (rv) {
        evb.append(h("div", { class: "note-block", style: { "--c": "var(--c-review)" } }, h("span", { class: "eyebrow" }, "why it might be"), rv.why_might_be || "—"));
        evb.append(h("div", { class: "note-block", style: { "--c": "var(--line-3)" } }, h("span", { class: "eyebrow" }, "why it might not be"), rv.why_might_not || "—"));
        const sigs = (rv.signals || []).map(s => h("li", {}, h("span", { class: "mono faint" }, (s.kind || s.class || "") + "  "), s.detail || ""));
        if (sigs.length) evb.append(h("details", {}, h("summary", {}, h("span", { class: "tw" }, svg(ICON.chevron)), `signals (${sigs.length})`), h("ul", { class: "node" }, ...sigs)));
    }
    if (!off && !rv) evb.append(h("p", { class: "dim" }, "No rule or relationship puts this device in the LE log or Review."));
    tree.append(section("Evidence & reasons", off ? (off.kind === "hardware" ? "vendor ID" : off.kind) : rv ? "review" : "none", evb, !!(off || rv)));

    // Sighting timeline
    const tl = h("div", { class: "timeline" });
    const ev = [];
    if (kn) ev.push([kn.first_epoch, `first logged (${kn.log} log)`, "var(--c-seen)"]);
    if (off) ev.push([Date.parse(off.first_seen.replace(" ", "T")) / 1000, "first seen as LE", "var(--c-le)"]);
    if (dev) ev.push([dev["kismet.device.base.first_time"], "first heard this Kismet run", "var(--blue-light)"], [dev["kismet.device.base.last_time"], "last heard", "var(--blue-light)"]);
    for (const s of (rv && rv.sightings) || []) ev.push([Date.parse(s.start.replace(" ", "T")) / 1000, `sighting session · ${s.polls} polls · until ${s.end}`, "var(--c-review)"]);
    for (const a of st.audit || []) if (a.mac === mac) ev.push([Date.parse(a.at.replace(" ", "T")) / 1000, `${a.action} (${a.actor})`, "var(--c-watch)"]);
    ev.filter(e => e[0]).sort((a, b) => b[0] - a[0]).forEach(([t, text, c]) => {
        const e = h("div", { class: "ev" }, h("span", { class: "t" }, absTime(t)), text);
        e.style.setProperty("--c", c);
        tl.append(e);
    });
    if (!tl.childNodes.length) tl.append(h("div", { class: "faint" }, "No recorded sightings."));
    tree.append(section("Sighting timeline", `${ev.length} events`, tl));

    // Notes & actions
    const notes = h("div", {});
    const ov = (st.overrides || []).find(o => o.mac === mac);
    if (ov) notes.append(h("div", { class: "note-block", style: { "--c": "var(--c-le)" } }, h("span", { class: "eyebrow" }, `operator note · ${ov.created}`), ov.note));
    if (dev) {
        // Only the custom (user-set) name: base.name is the network name for APs, and saving it back
        // would turn an SSID into a custom name. Empty = no custom name.
        const custom = dev["kismet.device.base.username"];
        const nm = h("input", { class: "field", value: typeof custom === "string" ? custom : "", placeholder: "Custom name (Kismet)", disabled: ro });
        const nt = h("textarea", { class: "field", placeholder: "Notes (Kismet)", disabled: ro }, get(dev, ["kismet.device.base.tags", "notes"], ""));
        const save = h("button", { class: "btn", type: "button", disabled: ro, onclick: async () => {
            try {
                await kismet.setName(dev["kismet.device.base.key"], nm.value);
                await kismet.setTag(dev["kismet.device.base.key"], "notes", nt.value);
                toast("Saved", "Name and notes stored in Kismet (server-wide).");
                if (shownMac === mac) open(dev["kismet.device.base.key"], mac);   // show what Kismet now holds
            } catch (e) { toast("Not saved", `Kismet answered ${e.status || "nothing"}.`, { color: "var(--bad)" }); }
        } }, "Save name & notes");
        notes.append(h("div", { style: { display: "grid", gap: "8px" } },
            h("div", { class: "eyebrow" }, "kismet name and notes · server-wide"), nm, nt, h("div", {}, save)));
    }
    const actions = h("div", { class: "insp-actions" });
    if (!off || off.kind === "learned") actions.append(h("button", { class: "btn", type: "button", disabled: ro, onclick: () => markLE(mac, name) }, "Mark as LE…"));
    if (off && off.kind === "operator") actions.append(h("button", { class: "btn danger", type: "button", disabled: ro, onclick: () => unmarkLE(mac) }, "Unmark…"));
    if (ro) actions.append(h("span", { class: "readonly-note" }, "read-only preview: actions disabled"));
    tree.append(section("Notes", ov ? "operator note" : "", notes, !!ov));

    // Raw fields
    if (dev) {
        const raw = h("div", { class: "json" });
        const det = section("All Kismet fields", `${Object.keys(dev).length} top-level`, raw);
        det.addEventListener("toggle", () => { if (det.open && !raw.childNodes.length) raw.append(jsonTree(dev)); }, { once: false });
        tree.append(det);
    }

    clear(panel).append(head, h("div", { class: "insp-body" }, tree), actions);
}

function jsonTree(v, depth = 0) {
    if (v && typeof v === "object") {
        const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
        const box = h("div", {});
        for (const [k, x] of entries.slice(0, 400)) {
            if (x && typeof x === "object") {
                const d = h("details", {}, h("summary", {}, h("span", { class: "tw" }, svg(ICON.chevron)), h("span", { class: "k" }, String(k)),
                    h("span", { class: "sum" }, Array.isArray(x) ? `[${x.length}]` : `{${Object.keys(x).length}}`)), h("div", { class: "node" }));
                d.addEventListener("toggle", () => { const n = d.querySelector(".node"); if (d.open && !n.childNodes.length) n.append(jsonTree(x, depth + 1)); });
                box.append(d);
            } else {
                const cls = typeof x === "string" ? "s" : typeof x === "number" ? "n" : "b";
                box.append(h("div", {}, h("span", { class: "k" }, String(k) + ": "), h("span", { class: cls }, JSON.stringify(x))));
            }
        }
        return box;
    }
    return h("span", {}, JSON.stringify(v));
}

async function markLE(mac, name) {
    const note = await askNote("Mark as LE",
        `Writes an Operator row for ${name ? name + " " : ""}${mac} to the LE log with your note, the time and your address. Clients with data-frame evidence of a connection to it will be logged as Learned.`,
        { placeholder: "What did you see?" });
    if (note == null) return;
    try {
        const res = await archimet.mark(mac, note);
        toast("Marked as LE", res.kept_stronger ? "Recorded; its Hardware reason is kept." : mac);
        refresh("state");
        setTimeout(() => { if (shownMac === mac && !panel.hidden) openByMac(mac); }, 600);
    } catch (e) { toast("Not marked", (e.body && e.body.error) || `HTTP ${e.status}`, { color: "var(--bad)" }); }
}

async function unmarkLE(mac) {
    const note = await askNote("Unmark", "Removes the Operator row. The device moves to Review and is watched; devices learned only from it are re-evaluated.", { placeholder: "Why?" });
    if (note == null) return;
    try {
        await archimet.unmark(mac, note);
        toast("Unmarked", mac);
        refresh("state");
        setTimeout(() => { if (shownMac === mac && !panel.hidden) openByMac(mac); }, 600);
    } catch (e) { toast("Not unmarked", (e.body && e.body.error) || `HTTP ${e.status}`, { color: "var(--bad)" }); }
}

export { navigate };
