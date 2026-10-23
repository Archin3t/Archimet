// SPDX-License-Identifier: GPL-2.0-or-later
/* When an LE / Review device was really heard. Pure functions (tests/test_ui.mjs).
 *
 * "Heard recently" means Kismet's own last_time for the MAC is within HEARD_WINDOW of Kismet's
 * own clock. Presence in Kismet's device list alone means nothing more than "heard at some
 * point in this Kismet run". A failed lookup is "unknown", never "history". */

import { relTime } from "./util.js";

export const HEARD_WINDOW = 120;        // seconds
export const CLOCK_SLACK = 60;          // a last_time further ahead of Kismet's clock than this is an anomaly

/* Kismet keys devices by phy + MAC, so one MAC can come back as several records (e.g. Wi-Fi and
 * Bluetooth). -> Map(MAC -> newest last_time of all its records); a plain Map over the rows
 * would keep whichever record happened to come last. */
export function newestByMac(rows) {
    const out = new Map();
    for (const r of rows || []) {
        const mac = String(r["kismet.device.base.macaddr"] || "").toUpperCase();
        const t = Number(r["kismet.device.base.last_time"]) || 0;
        if (mac && (!out.has(mac) || t > out.get(mac))) out.set(mac, t);
    }
    return out;
}

/* lookup: { ok: bool, kismetNow: epoch | null, kismetStart?: epoch, last: Map(mac -> last_time) } */
export function heardStatus(mac, lookup) {
    if (lookup == null) return { state: "pending", label: "Checking…", why: "Asking Kismet." };
    if (!lookup.ok || !lookup.kismetNow) return { state: "unknown", label: "Unknown", why: "Kismet did not answer the lookup." };
    const t = lookup.last.get(mac);
    if (t == null) return { state: "absent", label: "Not heard this Kismet run", why: "Not in Kismet's device list since Kismet started." };
    const age = lookup.kismetNow - t;
    if (age < -CLOCK_SLACK) return { state: "unknown", label: "Unknown", why: "Kismet reports a time in the future for this device (clock problem)." };
    // Same wording as every other "… ago" in Archimet (util.relTime), so screens read identically.
    // A record Kismet restored from storage can carry a time from before this run: never "this run".
    if (lookup.kismetStart && t < lookup.kismetStart) return { state: "earlier", age, label: `Heard before this Kismet run (${relTime(t, lookup.kismetNow)})`, why: "Kismet's record predates its current start (restored from its device store), so it was not heard in this run." };
    if (age <= HEARD_WINDOW) return { state: "recent", age: Math.max(0, age), label: `Heard ${relTime(t, lookup.kismetNow)}`, why: "Within the last 2 minutes by Kismet's clock." };
    return { state: "earlier", age, label: `Heard ${relTime(t, lookup.kismetNow)}`, why: "Heard earlier in this Kismet run, not in the last 2 minutes." };
}

/* Most recent real observation: Kismet's last_time (this run) or the logger's minute-precision
 * record; otherwise the logger's date-only last_seen. Never synthesises a time of day. */
export function lastObserved(row, lookup) {
    const k = lookup && lookup.ok ? lookup.last.get(row.mac) : null;
    const l = typeof row.last_observed === "number" ? row.last_observed : null;
    const best = Math.max(k || 0, l || 0);
    if (best > 0) return { precise: true, epoch: best, source: k && k >= (l || 0) ? "Kismet" : "Archimet logger" };
    return { precise: false, date: String(row.last_seen || "").slice(0, 10) || null, source: "date only" };
}

/* Sort key: precise times by epoch; date-only rows at the start of their (local) day, so a real
 * time on the same day ranks above them. */
export function observedKey(obs) {
    if (obs.precise) return obs.epoch;
    if (!obs.date) return 0;
    const [y, m, d] = obs.date.split("-").map(Number);
    return y ? new Date(y, m - 1, d).getTime() / 1000 : 0;
}

const pad = (n) => String(n).padStart(2, "0");
/* "2026-10-22 13:24" in the viewer's local time. */
export function minuteLocal(epoch) {
    const t = new Date(epoch * 1000);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
/* The viewer's time-zone name at that moment ("EDT", "GMT+2"), or "local" if unavailable. */
export function zoneName(epoch) {
    try {
        const p = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date(epoch * 1000));
        return (p.find(x => x.type === "timeZoneName") || {}).value || "local";
    } catch (e) { return "local"; }
}
/* Exact form for the detail: local time to the second with its zone, plus UTC. */
export function exactLocal(epoch) {
    const t = new Date(epoch * 1000);
    return `${minuteLocal(epoch)}:${pad(t.getSeconds())} ${zoneName(epoch)} · ${t.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")}`;
}
export function observedText(obs) {
    return obs.precise ? minuteLocal(obs.epoch) : obs.date ? `${obs.date} · date only` : "—";
}
