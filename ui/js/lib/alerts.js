// SPDX-License-Identifier: GPL-2.0-or-later
/* Group repeated, identical Kismet alerts for display. Identical = same header, text,
 * transmitter, source, destination and channel; nothing else is merged. Kismet's records are
 * untouched: every occurrence stays listed with its own time. Pure (tests/test_ui.mjs). */

const F = (a, k) => a["kismet.alert." + k];

export function alertKey(a) {
    return ["header", "text", "transmitter_mac", "source_mac", "dest_mac", "channel"].map(k => String(F(a, k) ?? "")).join("\u0001");
}

/* -> [{ key, header, cls, severity, text, tx, src, dst, ch, count, first, last, times[] }], newest group first */
export function groupAlerts(list) {
    const groups = new Map();
    for (const a of list || []) {
        const key = alertKey(a);
        const t = Number(F(a, "timestamp")) || 0;
        let g = groups.get(key);
        if (!g) {
            g = { key, header: F(a, "header"), cls: F(a, "class"), severity: F(a, "severity"), text: F(a, "text"),
                tx: F(a, "transmitter_mac"), src: F(a, "source_mac"), dst: F(a, "dest_mac"), ch: F(a, "channel"),
                count: 0, first: t, last: t, times: [] };
            groups.set(key, g);
        }
        g.count++;
        g.first = Math.min(g.first, t);
        g.last = Math.max(g.last, t);
        g.times.push(t);
    }
    for (const g of groups.values()) g.times.sort((x, y) => y - x);
    return [...groups.values()].sort((x, y) => y.last - x.last);
}
