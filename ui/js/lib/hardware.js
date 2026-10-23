// SPDX-License-Identifier: GPL-2.0-or-later
/* Pi hardware readings (logger metrics.json) matched to Kismet sources. Pure functions. */

const NA = (v) => v == null || (typeof v === "object" && "unavailable" in v);

/* The USB device, Wi-Fi interface and capture helper behind one Kismet source. */
export function sourceHardware(src, m) {
    if (!m) return { usb: null, wifi: null, helper: null, bt: null };
    // The capture interface (e.g. wlan1mon) is what Kismet listens on; prefer it over its parent.
    const ifs = [src["kismet.datasource.capture_interface"], src["kismet.datasource.interface"]].filter(Boolean);
    const list = Array.isArray(m.wifi) ? m.wifi : [];
    const wifi = ifs.map(i => list.find(w => w.iface === i)).find(Boolean) || null;
    const usb = wifi && wifi.usb_port && Array.isArray(m.usb) ? m.usb.find(u => u.port === wifi.usb_port) || null : null;
    const pid = src["kismet.datasource.ipc_pid"];
    const helper = Array.isArray(m.capture_helpers) ? m.capture_helpers.find(x => x.pid === pid) || null : null;
    const bt = Array.isArray(m.bluetooth) ? m.bluetooth.find(b => ifs.includes(b.iface)) || null : null;
    return { usb, wifi, helper, bt };
}

/* SOURCEERROR / SOURCEOPEN alerts for one source, newest first. Kismet keeps only recent alerts. */
export function sourceHistory(alerts, uuid) {
    const u = String(uuid || "").toUpperCase();
    return (alerts || [])
        .filter(a => /^SOURCE(ERROR|OPEN)$/.test(a["kismet.alert.header"]) && String(a["kismet.alert.text"]).toUpperCase().includes(u))
        .map(a => ({ t: a["kismet.alert.timestamp"], kind: a["kismet.alert.header"] === "SOURCEOPEN" ? "reopened" : "error", text: a["kismet.alert.text"] }))
        .sort((a, b) => b.t - a.t);
}

/* Power / throttling rows: [label, level ok|warn|bad|unknown, text]. Never guesses. */
export function powerRows(m) {
    if (!m || NA(m.throttled)) return [["Power & throttling", "unknown", m && m.throttled ? m.throttled.unavailable : "not available"]];
    const now = m.throttled.now, boot = m.throttled.since_boot;
    const row = (label, key, what) => now[key] ? [label, "bad", `${what} now`]
        : boot[key] ? [label, "warn", `not now · happened since boot`] : [label, "ok", "never since boot"];
    const rows = [
        row("Under-voltage", "undervoltage", "under-voltage"),
        row("Throttled", "throttled", "throttled"),
        row("CPU clock capped", "arm_freq_capped", "capped"),
        row("Soft temperature limit", "soft_temp_limit", "limit active"),
    ];
    return rows;
}

export function eventText(e) {
    const d = e.detail || {};
    return {
        undervoltage_start: "Under-voltage started",
        undervoltage_end: "Voltage normal again",
        throttle_flags: `Throttle flags ${d.from} → ${d.to}`,
        usb_removed: `USB disconnected: ${d.product || d.id} (port ${d.port})`,
        usb_added: `USB connected: ${d.product || d.id} (port ${d.port})`,
        usb_reenumerated: `USB reset / re-enumerated: ${d.product || d.id} (port ${d.port})`,
        wifi_interface_recreated: `Wi-Fi interface ${d.iface} re-created`,
        capture_helper_restarted: `Capture helper restarted: ${d.helper}`,
        capture_helper_stopped: `Capture helper stopped: ${d.helper}`,
    }[e.kind] || e.kind;
}

/* Detected radio hardware, kept separate from configured Kismet sources.
 * probed: Kismet's list_interfaces.cmd result (interfaces Kismet could capture on).
 * Each entry: { iface, driver, kind, usb, status: "source" | "managed" | "available" | "unsupported", source, note }.
 * An interface is never "available" when NetworkManager manages it (the hotspot radio), and
 * plugging in USB hardware never makes it a source by itself. */
/* wlan0 is the Pi's hotspot radio (and wlan0mon would be a monitor interface on it). */
export const isHotspotIface = (iface) => /^wlan0(mon)?$/.test(String(iface || ""));

export function detectHardware(m, sources, probed) {
    const list = [];
    const usbBy = new Map((Array.isArray(m && m.usb) ? m.usb : []).map(u => [u.port, u]));
    const wifi = Array.isArray(m && m.wifi) ? m.wifi : [];
    const nm = new Map((Array.isArray(m && m.networkmanager) ? m.networkmanager : []).map(n => [n.iface, n]));
    const srcFor = (iface) => (sources || []).find(s => s["kismet.datasource.interface"] === iface || s["kismet.datasource.capture_interface"] === iface);
    const bts = Array.isArray(m && m.bluetooth) ? m.bluetooth : [];
    const seen = new Set();
    const add = (iface, driver, kind) => {
        if (!iface || seen.has(iface)) return;
        seen.add(iface);
        const w = wifi.find(x => x.iface === iface);
        const usb = w && w.usb_port ? usbBy.get(w.usb_port) || null : null;
        const pr = (probed || []).find(p => p["kismet.datasource.probed.interface"] === iface);
        const src = srcFor(iface);
        const n = nm.get(iface);
        // A radio with any interface already in monitor mode is being captured by something.
        const busy = w && w.phy ? wifi.some(x => x.phy === w.phy && x.monitor) : !!(w && w.monitor);
        let status = "unsupported", note = "Kismet cannot capture on this interface.";
        // wlan0 is reserved for the Pi hotspot even if metrics/NetworkManager fail to report it.
        if (isHotspotIface(iface)) { status = "managed"; note = "Reserved for the Pi hotspot; never offered as a capture source."; }
        else if (src) { status = "source"; note = `Kismet source ${src["kismet.datasource.name"]}`; }
        else if (n && n.state !== "unmanaged") { status = "managed"; note = `Managed by NetworkManager (${n.connection || n.state}); never offered as a capture source, so the hotspot is left alone.`; }
        else if (busy) { status = "busy"; note = "Already in monitor mode (another capture is using this radio); not offered."; }
        else if (kind === "bluetooth" && pr) { status = "config"; note = "Kismet can capture on it. Bluetooth sources are added in Kismet's configuration, not here, because Archimet cannot tell whether the controller is in use."; }
        else if (pr) { status = "available"; note = "Kismet can capture on this interface; it is not a source yet."; }
        list.push({ iface, driver: driver || (w && w.driver) || (pr && pr["kismet.datasource.probed.hardware"]) || "", kind,
            type: pr && pr["kismet.datasource.type_driver"] ? pr["kismet.datasource.type_driver"]["kismet.datasource.driver.type"] : (kind === "wifi" ? "linuxwifi" : "linuxbluetooth"),
            usb, bus: (bts.find(b => b.iface === iface) || {}).bus || (usb ? "usb" : null), status, source: src ? src["kismet.datasource.name"] : null, note });
    };
    // Monitor sub-interfaces (wlan1mon) belong to their parent; list parents only.
    for (const w of wifi) if (!/mon$/.test(w.iface) || !wifi.some(x => x.iface + "mon" === w.iface)) add(w.iface, w.driver, "wifi");
    for (const b of Array.isArray(m && m.bluetooth) ? m.bluetooth : []) add(b.iface, b.driver, "bluetooth");
    for (const p of probed || []) {
        const i = p["kismet.datasource.probed.interface"];
        if (/mon$/.test(i) && seen.has(i.slice(0, -3))) continue;
        add(i, p["kismet.datasource.probed.hardware"], /bluetooth/.test((p["kismet.datasource.type_driver"] || {})["kismet.datasource.driver.type"] || "") ? "bluetooth" : "wifi");
    }
    const radioPorts = new Set(list.map(e => e.usb && e.usb.port).filter(Boolean));
    const otherUsb = [...usbBy.values()].filter(u => !radioPorts.has(u.port) && !/^usb\d/.test(u.port));
    return { radios: list, otherUsb };
}

/* Immediately before an add: is this interface still offered, judged from FRESH readings
 * (Kismet's current sources and capture-interface list, the latest Pi metrics)? -> { ok, reason } */
export function recheckAvailable(iface, met, sources, probed) {
    if (isHotspotIface(iface)) return { ok: false, reason: "wlan0 is reserved for the Pi hotspot." };
    if (!Array.isArray(probed)) return { ok: false, reason: "Kismet did not list its capture interfaces just now." };
    const e = detectHardware(met, sources, probed).radios.find(r => r.iface === iface);
    if (!e) return { ok: false, reason: `${iface} is no longer present (unplugged?).` };
    if (e.status !== "available") return { ok: false, reason: `${iface} is no longer available: ${e.note}` };
    return { ok: true, reason: "" };
}

/* Definition string for Kismet's add_source.cmd. Names: letters, digits, _ and -. */
export function sourceDefinition(iface, type, name) {
    if (!/^[A-Za-z0-9_.-]{1,15}$/.test(iface)) throw new Error("bad interface name");
    if (isHotspotIface(iface)) throw new Error("wlan0 is reserved for the Pi hotspot");
    if (!/^linux(wifi|bluetooth)$/.test(type)) throw new Error("unsupported source type");
    const clean = String(name || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) || `ARCHIMET_${iface}`;
    return `${iface}:type=${type},name=${clean}`;
}

export { NA as unavailable };
