// SPDX-License-Identifier: GPL-2.0-or-later
/* Shared live data: one poll per source, any number of subscribers. */

import { kismet } from "../api/kismet.js";
import { archimet } from "../api/archimet.js";
import { indexState } from "./classify.js";
import { parseLocal, setClockOffset } from "./util.js";

const topics = {
    status: { fn: () => kismet.status(), every: 5000 },
    sources: { fn: () => kismet.sources(), every: 6000 },
    gps: { fn: () => kismet.gps(), every: 10000 },
    packets: { fn: () => kismet.packetStats(), every: 5000 },
    state: { fn: pollState, every: 3000 },
    metrics: { fn: () => archimet.metrics(), every: 15000 },   // Pi hardware (logger 5.2)
};

const data = {};
const errors = {};
const subs = {};
const timers = {};
let stateRev = "";

async function pollState() {
    const st = await archimet.state(stateRev);
    if (st && st.unchanged) return Object.assign({}, data.state, { logger: st.logger, updated: st.updated });
    stateRev = (st && st.rev) || "";
    return Object.assign(st || {}, { index: indexState(st) });
}

async function tick(name) {
    const t = topics[name];
    if (!subs[name] || !subs[name].size) { delete timers[name]; return; }   // nobody is looking
    try {
        data[name] = await t.fn();
        if (name === "status" && data.status) setClockOffset(Number(data.status["kismet.system.timestamp.sec"]) - Date.now() / 1000);
        errors[name] = null;
    } catch (e) {
        errors[name] = e;
    }
    for (const fn of subs[name] || []) {
        try { fn(data[name], errors[name]); } catch (e) { console.error(e); }
    }
    timers[name] = setTimeout(() => tick(name), document.hidden ? t.every * 4 : t.every);
}

export function subscribe(name, fn) {
    (subs[name] = subs[name] || new Set()).add(fn);
    if (name in data || errors[name]) fn(data[name], errors[name]);
    if (!timers[name]) timers[name] = setTimeout(() => tick(name), 0);
    return () => subs[name].delete(fn);
}

export function current(name) { return data[name]; }
export function refresh(name) { clearTimeout(timers[name]); if (name === "state") stateRev = ""; tick(name); }

/* "Seen before": first-seen dates from the logs, cached per MAC. */
const knownCache = new Map();
export async function known(macs) {
    const want = [...new Set(macs.map(m => String(m).toUpperCase()))].filter(m => !knownCache.has(m));
    if (want.length) {
        try {
            const res = await archimet.known(want);
            for (const m of want) {
                const r = res && res[m];
                knownCache.set(m, r ? { ...r, first_epoch: parseLocal(r.first_seen) } : null);
            }
        } catch (e) {
            for (const m of want) knownCache.set(m, undefined);   // unknown: try again later
            setTimeout(() => { for (const m of want) if (knownCache.get(m) === undefined) knownCache.delete(m); }, 30000);
        }
    }
    const out = {};
    for (const m of macs) out[String(m).toUpperCase()] = knownCache.get(String(m).toUpperCase()) || null;
    return out;
}
