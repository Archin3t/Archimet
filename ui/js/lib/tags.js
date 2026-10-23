// SPDX-License-Identifier: GPL-2.0-or-later
/* Tags: the one catalogue for what a device row says about itself. Pure functions (tests/test_ui.mjs).
 *
 * Three separate things, never mixed:
 *   radio     what Kismet reports (Wi-Fi AP / client / other, BLE, BT Classic, other)
 *   equipment what the device is (Body cam, Taser, In-car router, ...). Shown ONLY when the device itself
 *             broadcast a model name that identifies it. A vendor MAC prefix (e.g. Axon's) identifies the
 *             maker, not whether that device is a camera or a Taser, so it never produces one on its own.
 *             The AP role Kismet reports is the radio type, never "police" anything.
 *   evidence  why a row is in the LE log: vendor match (OUI), association, operator mark; Seen before
 *   workflow  LE log, Review, Watch
 * Nothing here establishes police OWNERSHIP or USE. The LE log is a log of LE-equipment evidence:
 * every row says which evidence put it there, and an OUI and Kismet's manufacturer name (derived from
 * the same OUI) are one piece of evidence, not two.
 *
 * Colour is a preference (Settings › Tags & colours); every tag always has its text, so colour is
 * never the only cue, and no colour choice changes what the data claims.
 * Precedence for the single row marker: LE log > Watch > Review > radio type. */

export const GROUPS = [
    ["workflow", "Workflow", "Where a device stands. LE log: LE-equipment evidence, named by its evidence tag (not proof of police ownership or use). Review: unresolved signals, never counted as LE."],
    ["subtype", "Equipment (model identified)", "Shown only when the device itself broadcast a model name that identifies the equipment. A maker's MAC prefix or the AP role never sets one."],
    ["evidence", "Evidence", "Why a device is in the LE log, and whether it was logged before this Kismet run. Evidence tags are text, not row colours."],
    ["radio", "Radio type", "What Kismet reports about the radio."],
];

/* id, group, label, default colour, help. `locked`: always shown (hiding it would hide LE status). */
export const TAGS = [
    { id: "confirmed", group: "workflow", label: "LE log", color: "#c84a3c", locked: true, help: "In Archimet's LE log because of the evidence tag beside it (vendor match, association or an operator mark). It records LE-equipment evidence; it does not establish police ownership or use." },
    { id: "watch", group: "workflow", label: "Watch", color: "#8f86b8", help: "Unmarked devices you asked to be told about when they return." },
    { id: "review", group: "workflow", label: "Review", color: "#a8995a", help: "Unresolved signals; see Review. Never counted as LE." },
    { id: "bodycam", group: "subtype", label: "Body cam", color: "#b5655b", help: "The device broadcast a body-camera model name (e.g. “Axon Body 3”). Identifies the model, not who owns or uses it." },
    { id: "taser", group: "subtype", label: "Taser", color: "#b5655b", help: "The device broadcast a Taser model name (e.g. “TASER 10”). Identifies the model, not who owns or uses it." },
    { id: "incarvideo", group: "subtype", label: "In-car video", color: "#b5655b", help: "The device broadcast an in-car video model name (e.g. “Axon Fleet 3”, “4RE”). Identifies the model, not who owns or uses it." },
    { id: "incarrouter", group: "subtype", label: "In-car router", color: "#b5655b", help: "The device broadcast a vehicle-router model name (e.g. “E110”, “IBR900”). Such routers are also common outside LE." },
    { id: "radio2way", group: "subtype", label: "Two-way radio", color: "#b5655b", help: "The device broadcast a two-way radio model name (e.g. “APX NEXT”). Identifies the model, not who owns or uses it." },
    { id: "alpr", group: "subtype", label: "ALPR", color: "#b5655b", help: "The device broadcast an ALPR camera name pattern (e.g. “Flock-…”). ALPR cameras are also run by private owners." },
    { id: "vendor", group: "evidence", label: "Vendor match", color: "#8f9aa6", help: "Its MAC prefix (OUI) is assigned to a maker of LE equipment. Identifies the radio's maker only: not the device type, owner or use. Kismet's manufacturer name comes from the same prefix and is not a second piece of evidence." },
    { id: "operator", group: "evidence", label: "Operator mark", color: "#8f9aa6", help: "An operator marked it as LE, with a note (kept in the audit with time and source). The operator's judgement, not an observation." },
    { id: "learned", group: "evidence", label: "Associated", color: "#8f9aa6", help: "Exchanged data frames with a device already in the LE log (one hop). An association, not an identification." },
    { id: "seen", group: "evidence", label: "Seen before", color: "#7f8a96", help: "In the access point / client logs from before this Kismet run." },
    { id: "wifi-ap", group: "radio", label: "Wi-Fi AP", color: "#8a96a3", help: "Access points (incl. WDS and ad-hoc)." },
    { id: "wifi-client", group: "radio", label: "Wi-Fi client", color: "#7d8b99", help: "Wi-Fi clients." },
    { id: "wifi-other", group: "radio", label: "Wi-Fi other", color: "#6f7b88", help: "Bridged hosts, WDS links, role unknown." },
    { id: "ble", group: "radio", label: "BLE", color: "#5a86d6", help: "Bluetooth Low Energy." },
    { id: "btc", group: "radio", label: "BT Classic", color: "#4a72b8", help: "Bluetooth Classic (BR/EDR)." },
    { id: "other", group: "radio", label: "Other radio", color: "#6b7480", help: "Any other radio Kismet reports." },
];
export const TAG = Object.fromEntries(TAGS.map(t => [t.id, t]));
export const DEFAULT_TAG_PREFS = Object.fromEntries(TAGS.map(t => [t.id, { show: true, color: t.color }]));

/* Radio tag from Kismet's phy / type. */
export function radioTag(phy, type) {
    phy = String(phy || ""); type = String(type || "");
    if (/bluetooth|btle/i.test(phy)) return /BR\/EDR/i.test(type) ? "btc" : "ble";
    if (/802\.11/.test(phy)) return /AP$|Ad-Hoc|WDS AP/.test(type) ? "wifi-ap" : /Client/.test(type) ? "wifi-client" : "wifi-other";
    return "other";
}

/* Model names that identify the equipment type. Matched against what the device itself
 * advertised (network or Bluetooth name), never against a rule's category. */
export const MODEL_SUBTYPES = [
    ["bodycam", /\bAxon[ -]?Body ?[234]\b|\bBody ?[234][ -]|\bVB400\b|\bBodyWorn\b/i],
    ["taser", /\bTASER ?(7|10|X2|X26P?)\b/i],
    ["incarvideo", /\bAxon[ -]?Fleet ?[23]?\b|\b4RE\b|\bArbitrator\b/i],
    ["incarrouter", /^E110-[0-9A-Za-z]+$|\bIBR[0-9]{3,4}\b|\bR19[0-9]{2}\b|\bAirLink\b|\bMG90\b/i],
    ["radio2way", /\bAPX ?(NEXT|[0-9]{4})\b|\bXL-?(185|200)P\b/i],
    ["alpr", /^Flock-[A-Za-z0-9]{4,}$|^Penguin-[0-9]{10}$/],
];

/* Equipment tags for an LE-log row (an empty list means "equipment not identified"): only model names
 * the device itself broadcast. row: { name } from the LE log; dev: optional Kismet { name, ssid }. */
export function subtypesOf(row, dev = {}) {
    const out = [];
    const names = [row && row.name, dev.name, dev.ssid].filter(v => typeof v === "string" && v.trim());
    for (const [id, re] of MODEL_SUBTYPES) if (names.some(n => re.test(n)) && !out.includes(id)) out.push(id);
    // No "Police AP": being an access point is the radio type, and an LE-vendor prefix does not
    // establish police ownership. (Removed 2026-10-23; it labelled Axon-prefix APs as police.)
    return out;
}

const EVIDENCE = { hardware: "vendor", operator: "operator", learned: "learned" };

/* Every tag for one MAC, in display order, each with text and an explanation.
 * o: indexed LE row (or undefined); r: indexed Review row; known: Seen-before info. */
export function tagsFor({ mac, phy, type, name, ssid }, o, r, known, kismetStart) {
    const out = [];
    if (o) {
        out.push({ id: "confirmed", text: "LE log", title: `In the LE log: ${o.match_reason || o.kind}. Not proof of police ownership or use.` });
        const subs = subtypesOf(o, { name, ssid, type });
        for (const s of subs) out.push({ id: s, text: TAG[s].label, title: TAG[s].help });
        if (EVIDENCE[o.kind]) {
            const ev = EVIDENCE[o.kind];
            const vendor = ev === "vendor" ? vendorOf(o) : "";
            out.push({ id: ev, text: vendor ? `Vendor: ${vendor}` : TAG[ev].label,
                title: `${TAG[ev].help}${!subs.length ? " Equipment not identified: the device broadcast no model name." : ""}` });
        }
    }
    if (r) {
        const low = r.resolution && r.resolution.state === "deprioritized";
        out.push({ id: "review", text: low ? "Review · low priority" : "Review",
            title: low ? `Low priority (${r.resolution.rule}): ${r.resolution.why}` : (r.why_might_be || TAG.review.help) });
        if (r.watch) out.push({ id: "watch", text: "Watch", title: TAG.watch.help });
    }
    if (known && known.first_seen && (!kismetStart || known.first_epoch < kismetStart))
        out.push({ id: "seen", text: "Seen before", title: `In the ${known.log} log since ${known.first_seen}` });
    return out;
}

/* A stored LE reason, split for display. Hardware reasons carry the matching rule's category
 * ("Hardware: Axon Enterprise, Inc. OUI 00:25:DF — Body cam / Taser [rule axon-oui, rules 5.0.1]");
 * that category describes the rule, not the device, so it is returned separately and never shown
 * as the device's type. Stored rows are not changed. -> { kind, text, ruleCategory } */
export function reasonParts(reason) {
    // Rows stored before logger 5.3 say "confirmed LE AP/device"; shown in today's wording (the stored row is unchanged).
    const r = String(reason || "").trim().replace(/\bconfirmed LE (AP|device)\b/g, "LE-log $1");
    const m = /^(\w+):\s*(.*)$/s.exec(r);
    if (!m) return { kind: "", text: r, ruleCategory: "" };
    const kind = m[1].toLowerCase();
    if (kind !== "hardware") return { kind, text: m[2], ruleCategory: "" };
    const h = /^(.*?)\s+—\s+(.+?)\s*(\[[^\]]*\])?$/s.exec(m[2]);
    return h ? { kind, text: `${h[1]}${h[3] ? " " + h[3] : ""}`, ruleCategory: h[2] } : { kind, text: m[2], ruleCategory: "" };
}

/* Maker named by a vendor-ID (hardware) reason: "Hardware: Axon Enterprise, Inc. OUI 00:25:DF" -> "Axon". */
export function vendorOf(row) {
    const m = /^Hardware:\s*([^;]+?)\s+(?:OUI|MAC prefix|prefix|Kismet manufacturer lookup)\b/i.exec(String((row && row.match_reason) || ""));
    const company = m ? m[1] : (row && row.manufacturer) || "";
    return String(company).split(/[ ,(]/)[0];
}

/* The single marker for a row: LE log > Watch > Review > radio type. */
export function markerOf(tags, radio) {
    for (const id of ["confirmed", "watch", "review"]) if (tags.some(t => t.id === id)) return id;
    return radio;
}

/* Visible tags under the viewer's preferences (locked tags always show). */
export function visibleTags(tags, prefs) {
    return tags.filter(t => TAG[t.id] && (TAG[t.id].locked || !prefs || !prefs[t.id] || prefs[t.id].show !== false));
}

/* Old (v2) colour preferences -> tag colours, only where the viewer had changed a default. */
export const OLD_COLOR_MAP = { wifi: ["wifi-ap", "wifi-client", "wifi-other"], bluetooth: ["ble", "btc"], le: ["confirmed"],
    learned: ["learned"], review: ["review"], watch: ["watch"], other: ["other"] };   // "bodycam" has no successor
export function migrateColors(oldColors, oldDefaults) {
    const out = {};
    for (const [k, ids] of Object.entries(OLD_COLOR_MAP)) {
        const v = oldColors && oldColors[k];
        if (v && oldDefaults && v !== oldDefaults[k]) for (const id of ids) out[id] = { color: v };
    }
    return out;
}

/* WCAG contrast of the badge text a colour produces on Archimet's background (#0a0c0f):
 * text = 70% colour + 30% white, over 12% colour on the background (same as app.css). */
const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c)); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mix = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t));
const lum = (rgb) => { const l = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const BG = "#0a0c0f";
export function tagContrast(color) {
    const c = hex(color), bg = hex(BG);
    const text = mix(c, [255, 255, 255], 0.7), fill = mix(c, bg, 0.12);
    return { text: ratio(text, fill), marker: ratio(c, bg) };
}
/* Readable: badge text >= 4.5:1, and the edge marker >= 3:1 against the background. */
export const readable = (color) => { const k = tagContrast(color); return k.text >= 4.5 && k.marker >= 3; };
