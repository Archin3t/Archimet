// SPDX-License-Identifier: GPL-2.0-or-later
/* Device category filter. A device is listed when it belongs to ANY checked category.
 * Kismet ORs regex pairs (verified on 2025.09), so one server-side query returns each device
 * once: no duplicates, no client-side merging. Pure functions (tests/test_ui.mjs). */

const TYPE = "kismet.device.base.type";
const MAC = "kismet.device.base.macaddr";

export const CATS = [
    { id: "ap", label: "Access points", group: "radio", type: "Wi-Fi AP|Wi-Fi WDS AP|Wi-Fi Ad-Hoc" },
    { id: "client", label: "Wi-Fi clients", group: "radio", type: "Wi-Fi Client" },
    { id: "wifiother", label: "Other Wi-Fi", hint: "bridged hosts, WDS links, unknown role", group: "radio", type: "Wi-Fi Bridged|Wi-Fi WDS|Wi-Fi Device" },
    { id: "ble", label: "Bluetooth LE", group: "radio", type: "BTLE" },
    { id: "btc", label: "Bluetooth Classic", group: "radio", type: "BR/EDR" },
    { id: "other", label: "Other radios", group: "radio", typeRe: "(?!Wi-Fi |BTLE$|BR/EDR$).*" },
    { id: "le_hw", label: "LE log · vendor match", group: "le", kinds: ["hardware"] },
    { id: "le_op", label: "LE log · operator mark", group: "le", kinds: ["operator"] },
    { id: "le_learned", label: "LE log · associated", group: "le", kinds: ["learned"] },
    { id: "review", label: "Review (unresolved)", group: "workflow", review: true },
    { id: "watch", label: "Watch", group: "workflow", watch: true },
];
/* Groups in the Show panel. A device is listed when it belongs to ANY checked box (union). */
export const CAT_GROUPS = [["radio", "Radio type"], ["le", "LE status · evidence"], ["subtype", "LE subtype"], ["workflow", "Workflow"]];
export const needsLogger = (cats) => (cats || []).some(id => (CATS.find(c => c.id === id) || {}).group !== "radio");
const RADIO = CATS.filter(c => c.group === "radio").map(c => c.id);

export const PRESETS = [
    ["all", "Everything", null],
    ["end", "End devices (mixed)", ["client", "ble", "btc"]],
    ["clients", "Wi-Fi clients only", ["client"]],
    ["wifi", "Wi-Fi", ["ap", "client", "wifiother"]],
    ["bt", "Bluetooth", ["ble", "btc"]],
    ["ble", "BLE", ["ble"]],
    ["aps", "Access points", ["ap"]],
    ["le", "LE & Review", ["le_hw", "le_op", "le_learned", "review", "watch"]],
];

/* null = everything. Returns the preset id when the selection equals one, else "". */
export function presetOf(cats) {
    const key = (a) => (a ? [...a].sort().join() : "*");
    const hit = PRESETS.find(([, , c]) => key(c) === key(cats));
    return hit ? hit[0] : "";
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/* -> { regex: [[field, re], ...] | null (no filter), empty: bool (nothing can match) } */
export function buildFilter(cats, idx) {
    if (!cats) return { regex: null, empty: false };
    const set = new Set(cats);
    if (RADIO.every(id => set.has(id))) return { regex: null, empty: false };   // every radio type: no filter needed
    const pairs = [];
    const types = CATS.filter(c => set.has(c.id) && c.type).map(c => c.type);
    const typeRes = CATS.filter(c => set.has(c.id) && c.typeRe).map(c => c.typeRe);
    if (types.length || typeRes.length)
        pairs.push([TYPE, "^(" + [...types.map(t => "(?:" + t.split("|").map(esc).join("|") + ")$"), ...typeRes].join("|") + ")"]);
    const macs = new Set();
    for (const c of CATS) {
        if (!set.has(c.id)) continue;
        if (c.kinds) for (const r of idx.official.values()) if (c.kinds.includes(r.kind)) macs.add(r.mac.toUpperCase());
        if (c.review) for (const m of idx.review.keys()) macs.add(m.toUpperCase());
        if (c.watch) for (const [m, r] of idx.review) if (r.watch) macs.add(m.toUpperCase());
    }
    if (macs.size) pairs.push([MAC, "^(" + [...macs].map(esc).join("|") + ")$"]);
    return { regex: pairs, empty: pairs.length === 0 };
}

export function summary(cats) {
    if (!cats) return "Everything";
    const p = PRESETS.find(([id]) => id === presetOf(cats));
    if (p) return p[1];
    const names = CATS.filter(c => cats.includes(c.id)).map(c => c.label);
    return names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")) : "Nothing selected";
}
