// SPDX-License-Identifier: GPL-2.0-or-later
/* Capture-source state from Kismet's own fields AND packet progress. Pure (tests/test_ui.mjs).
 *
 * Kismet's "running" only means the source is open. A source counts as CAPTURING only when its packet
 * count has risen within STALL_S seconds of this browser watching it. Open but not rising for
 * STALL_S: STALLED. Open, watched for less than STALL_S, no rise yet: CHECKING (unknown, not "fine").
 * A count that drops (Kismet restarted) restarts the watch. */

export const STALL_S = 90;

/* memory: Map(uuid -> { n, rose, since }) carried between polls; list: Kismet's all_sources.json;
 * now: ms. Returns Map(uuid -> { state, label, why, packets }) and updates memory. */
export function sourceStates(memory, list, now) {
    const out = new Map();
    const seen = new Set();
    for (const s of list || []) {
        const id = s["kismet.datasource.uuid"];
        seen.add(id);
        const n = Number(s["kismet.datasource.num_packets"]) || 0;
        let m = memory.get(id);
        if (!m || n < m.n) m = { n, rose: 0, since: now };          // first sight, or counters reset
        else if (n > m.n) m = { n, rose: now, since: m.since };
        memory.set(id, m);
        const age = (now - m.since) / 1000, quiet = m.rose ? (now - m.rose) / 1000 : age;
        let state, why;
        if (s["kismet.datasource.error"]) { state = "error"; why = s["kismet.datasource.error_reason"] || "Kismet reports an error."; }
        else if (!s["kismet.datasource.running"]) { state = "closed"; why = "Kismet reports the source as not open."; }
        else if (s["kismet.datasource.paused"]) { state = "paused"; why = "Kismet reports the source as paused."; }
        else if (m.rose && quiet < STALL_S) { state = "capturing"; why = `Open, and its packet count rose ${Math.round(quiet)} s ago.`; }
        else if (age >= STALL_S) { state = "stalled"; why = `Open, but no new packets for ${Math.round(quiet)} s.`; }
        else { state = "checking"; why = `Open; watching for new packets (${Math.round(age)} of ${STALL_S} s).`; }
        out.set(id, { state, why, packets: n, label: { capturing: "capturing", stalled: "stalled", checking: "checking", closed: "closed", paused: "paused", error: "error" }[state] });
    }
    for (const id of [...memory.keys()]) if (!seen.has(id)) memory.delete(id);
    return out;
}

/* The status-strip summary: "1/2 capturing", with a colour and a per-source explanation. */
export function sourceSummary(list, states) {
    if (!list || !list.length) return { text: "no sources", level: "bad", title: "No capture sources." };
    const vals = list.map(s => [s["kismet.datasource.name"], states.get(s["kismet.datasource.uuid"])]);
    const cap = vals.filter(([, v]) => v && v.state === "capturing").length;
    const bad = vals.some(([, v]) => v && (v.state === "error" || v.state === "stalled" || v.state === "closed"));
    const level = cap === list.length ? "ok" : bad ? "bad" : "warn";
    return { text: `${cap}/${list.length} capturing`, level,
        title: vals.map(([name, v]) => `${name}: ${v ? v.label + " · " + v.why : "unknown"}`).join("\n") };
}
