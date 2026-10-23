/* How a device is shown: category (glyph + label + radio tag) and its tags (lib/tags.js).
 * Pure functions; the logger is the only classifier, this only reads its results. */

import { radioTag, tagsFor, markerOf } from "./tags.js";

export function kindOf(reason) {
    const r = String(reason == null ? "" : reason).trim();
    if (r.startsWith("Hardware:")) return "hardware";
    if (r.startsWith("Operator:")) return "operator";
    if (r.startsWith("Learned:")) return "learned";
    const parts = r.split(";").map(p => p.trim().split(":")[0]).filter(Boolean);
    if (parts.some(p => p === "mac prefix" || p === "manufacturer" || p === "ble service")) return "hardware";
    return parts.length ? "keyword" : "";
}

export function parentOf(reason) {
    const m = /confirmed LE (?:AP|device) ([0-9A-F]{2}(?::[0-9A-F]{2}){5})/.exec(String(reason || ""));
    return m ? m[1] : "";
}

/* Radio category from Kismet's phy/type. */
export function category(d) {
    const phy = String(d.phy || d["kismet.device.base.phyname"] || "");
    const type = String(d.type || d["kismet.device.base.type"] || "");
    const radio = radioTag(phy, type);
    if (/bluetooth|btle/i.test(phy)) return { id: "bluetooth", radio, label: /BTLE/i.test(type) ? "BLE" : "BT", glyph: "bt" };
    if (/802\.11/.test(phy)) {
        if (/AP|Ad-Hoc|WDS/.test(type)) return { id: "wifi", radio, label: type.replace("Wi-Fi ", "") || "AP", glyph: "ap" };
        return { id: "wifi", radio, label: type.replace("Wi-Fi ", "") || "Client", glyph: "client" };
    }
    return { id: "other", radio, label: type || phy || "Device", glyph: "other" };
}

/* Index of logger state by MAC: official LE rows and open Review rows. */
export function indexState(state) {
    const official = new Map(), review = new Map();
    for (const r of (state && state.official) || []) {
        const kind = r.kind || kindOf(r.match_reason);
        if (kind === "keyword") continue;
        // r.category is the matching rule's category; it is never treated as the device's subtype.
        official.set(String(r.mac).toUpperCase(), { ...r, kind, parent: r.parent || parentOf(r.match_reason) });
    }
    for (const r of (state && state.review) || []) {
        review.set(String(r.mac).toUpperCase(), { ...r, watch: (r.signals || []).some(s => s.watch === true) });
    }
    return { official, review };
}

/* Tags for one MAC (lib/tags.js). Each has a text label, so colour is never the only cue.
 * `known` = first-seen date from the logs when the MAC was logged before this Kismet run;
 * `rec` = what Kismet reports now ({ phy, type, name, ssid }), used for subtype evidence. */
export function badgesFor(mac, idx, known, kismetStart, rec = {}) {
    const m = String(mac || "").toUpperCase();
    return tagsFor({ mac: m, ...rec }, idx.official.get(m), idx.review.get(m), known, kismetStart);
}

/* The row's single marker: LE log > Watch > Review > radio type (lib/tags.js). */
export function markerFor(cat, badges) {
    return markerOf(badges, cat.radio || cat.id);
}

/* Kismet client record → is there data-frame evidence (same rule as the logger)? */
export function assocEvidence(rec) {
    const r = Number(rec["dot11.client.num_retries"] || 0);
    const f = Number(rec["dot11.client.num_fragments"] || 0);
    const b = Number(rec["dot11.client.datasize_retry"] || 0);
    const extra = ["dot11.client.dhcp_host", "dot11.client.dhcp_vendor", "dot11.client.eap_identity",
        "dot11.client.cdp_device", "dot11.client.cdp_port", "dot11.client.ipdata"]
        .filter(k => rec[k] != null && rec[k] !== "" && rec[k] !== 0).map(k => k.split(".").pop());
    const ev = [];
    if (r) ev.push(`${r} retried data frames`);
    if (f) ev.push(`${f} fragmented data frames`);
    if (b && !r) ev.push(`${b} retried data bytes`);
    if (extra.length) ev.push("data-frame metadata " + extra.join("/"));
    return { data: ev.length > 0, evidence: ev.join(", ") };
}

/* One short line for a Review row, built from its signals (full notes live in the detail). */
export function reviewSummary(r) {
    const out = [];
    for (const s of (r && r.signals) || []) {
        const k = s.kind || s.class;
        let t = "";
        if (s.class === "fleet") t = `fleet-vendor MAC (${String(s.company || "").split(/[ ,(]/)[0]})`;
        else if (s.class === "name") t = "model name in SSID";
        else if (s.class === "laa") t = "Kismet Axon prefix";
        else if (s.class === "agency") t = `agency word “${s.word || ""}”`;
        else if (k === "operator-unmarked") t = "unmarked by operator";
        else if (k === "association-unconfirmed") t = `unconfirmed link to ${s.parent}`;
        else if (k === "probe-confirmed-ssid") t = "probed an LE network name";
        else if (k === "probed-by-confirmed") t = "name probed by LE device";
        else if (k === "adjacent-mac") t = "MAC adjacent to LE device";
        else if (k === "shared-ap") t = "LE device joined a shared AP";
        else if (k === "parent-full") t = "LE AP client cap reached";
        else if (k === "parent-withdrawn") t = "learned parent withdrawn";
        else if (k === "learned-unsupported") t = "former learned row";
        else if (k === "legacy-le-row") t = "formerly in LE log";
        if (t && !out.includes(t)) out.push(t);
    }
    return out.join(" · ") || "unconfirmed";
}

/* What to call a device that has no name, from the Kismet fields actually observed.
 * `r` is a flat record (row aliases or identityFields(dev)). Returns
 * { name, label, reason, hidden }: `name` only when the device really has one. */
export function identity(r) {
    const mac = String(r.mac || "").toUpperCase();
    const real = (v) => typeof v === "string" && v.trim() && v.trim().toUpperCase() !== mac ? v.trim() : "";
    const type = String(r.type || "");
    const phy = String(r.phy || "");
    const user = real(r.username);
    if (user) return { name: user, label: "", reason: "Name set in Kismet.", hidden: false };
    if (/802\.11/.test(phy)) {
        const ssid = real(r.ssid), probe = real(r.probe);
        const responded = (r.responded || []).map(real).filter(Boolean);
        if (/AP/.test(type)) {
            if (r.beacon_ts) {
                if (ssid && !r.cloaked) return { name: ssid, label: "", reason: "Network name taken from its beacons.", hidden: false };
                const len = Number(r.ssidlen) || 0;
                const base = `Its beacons carry a blank network name (Kismet marks it cloaked${len ? `, ${len}-byte name field` : ", zero-length name"}). That is direct evidence of a hidden network.`;
                if (responded.length) return { name: "", label: `Hidden SSID · answers “${responded[0]}”`, hidden: true,
                    reason: `${base} It answered a probe as “${responded.join("”, “")}”, which is likely the real network name.` };
                return { name: "", label: "Hidden SSID", hidden: true, reason: base };
            }
            if (responded.length) return { name: "", label: `AP · answers “${responded[0]}”`, hidden: false,
                reason: "No beacon has been heard, but it answered a probe with this network name." };
            return { name: "", label: "AP · no beacon heard", hidden: false,
                reason: "Kismet identified this as an access point from other frames, but has not heard a beacon from it, so its network name is unknown. A missing name alone is not evidence of a hidden network." };
        }
        if (/Bridged/.test(type)) return { name: "", label: "Bridged host · no name", hidden: false,
            reason: "Seen only as the far end of traffic relayed by an access point (a wired or bridged host). It did not transmit on Wi-Fi itself, so it has no name, channel or signal." };
        if (/WDS/.test(type)) return { name: "", label: "WDS link · no name", hidden: false,
            reason: "A wireless distribution (AP-to-AP) link. These frames carry no network or device name." };
        if (/Client/.test(type)) return { name: "", label: probe ? `Client · probes “${probe}”` : "Client · no name", hidden: false,
            reason: "Wi-Fi clients do not transmit a device name; Kismet shows one only if you set it." + (probe ? ` The last network it asked for was “${probe}” (that is a network, not the device's name).` : "") };
        return { name: "", label: "Wi-Fi device · role unknown", hidden: false,
            reason: "Kismet saw frames from this address but not enough to tell whether it is an access point or a client." };
    }
    if (/bluetooth|btle/i.test(phy)) {
        const n = real(r.name);
        if (n) return { name: n, label: "", reason: "Name from its Bluetooth advertisements or name response.", hidden: false };
        if (/BTLE/i.test(type)) return { name: "", label: "BLE · no name advertised", hidden: false,
            reason: "Its Bluetooth Low Energy advertisements carry no local-name field." };
        return { name: "", label: "BT Classic · name not received", hidden: false,
            reason: "Classic Bluetooth names arrive only in a name response, and Kismet has not received one." };
    }
    const n = real(r.name);
    return n ? { name: n, label: "", reason: "", hidden: false } : { name: "", label: "No name reported", reason: "Kismet has no name for this device.", hidden: false };
}

/* Flatten a full Kismet device record into identity()'s shape. */
export function identityFields(dev) {
    const d11 = dev["dot11.device"] || {};
    const b = d11["dot11.device.last_beaconed_ssid_record"] || {};
    const p = d11["dot11.device.last_probed_ssid_record"] || {};
    return {
        mac: dev["kismet.device.base.macaddr"], type: dev["kismet.device.base.type"], phy: dev["kismet.device.base.phyname"],
        name: dev["kismet.device.base.name"], username: dev["kismet.device.base.username"],
        ssid: b["dot11.advertisedssid.ssid"], cloaked: b["dot11.advertisedssid.cloaked"], ssidlen: b["dot11.advertisedssid.ssidlen"],
        beacon_ts: d11["dot11.device.last_beacon_timestamp"], probe: p["dot11.probedssid.ssid"],
        responded: Object.values(d11["dot11.device.responded_ssid_map"] || {}).map(x => x["dot11.advertisedssid.ssid"]),
    };
}

/* Radio band, channel and frequency live in band.js (one derivation for every screen). */
export { band } from "./band.js";
