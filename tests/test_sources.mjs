// SPDX-License-Identifier: GPL-2.0-or-later
// node tests/test_sources.mjs — capture-source state (ui/js/lib/sources.js). Regression for
// "2/2 sources" shown while a source's packet count was not moving (2026-10-23 audit).
import { sourceStates, sourceSummary, STALL_S } from "../ui/js/lib/sources.js";

let failed = 0;
const t = (name, cond) => { if (!cond) { failed++; console.error("FAIL", name); } };
const src = (uuid, name, n, extra = {}) => ({ "kismet.datasource.uuid": uuid, "kismet.datasource.name": name, "kismet.datasource.running": 1,
    "kismet.datasource.error": 0, "kismet.datasource.num_packets": n, ...extra });
const S = 1000;

const mem = new Map();
let st = sourceStates(mem, [src("a", "ALFA", 100), src("b", "BT", 10)], 0);
t("first sight: checking, never capturing", st.get("a").state === "checking" && st.get("b").state === "checking");
t("summary while checking is not all-green", sourceSummary([src("a", "ALFA", 100), src("b", "BT", 10)], st).level !== "ok"
    && sourceSummary([src("a", "ALFA", 100), src("b", "BT", 10)], st).text === "0/2 capturing");
st = sourceStates(mem, [src("a", "ALFA", 500), src("b", "BT", 10)], 6 * S);
t("rising count: capturing", st.get("a").state === "capturing");
t("open but flat, watched < stall window: still checking", st.get("b").state === "checking");
st = sourceStates(mem, [src("a", "ALFA", 900), src("b", "BT", 10)], (STALL_S + 1) * S);
t("open but flat for the whole window: stalled (old code said running)", st.get("b").state === "stalled" && /no new packets/.test(st.get("b").why));
const sum = sourceSummary([src("a", "ALFA", 900), src("b", "BT", 10)], st);
t("summary: 1/2 capturing, red, explains each source", sum.text === "1/2 capturing" && sum.level === "bad" && /BT: stalled/.test(sum.title) && /ALFA: capturing/.test(sum.title));
st = sourceStates(mem, [src("a", "ALFA", 900), src("b", "BT", 12)], (STALL_S + 2) * S);
t("a stalled source that moves again: capturing", st.get("b").state === "capturing");
st = sourceStates(mem, [src("a", "ALFA", 900), src("b", "BT", 12)], (2 * STALL_S + 10) * S);
t("capturing source that stops: stalled after the window", st.get("a").state === "stalled");
// Disconnect / error / closed.
st = sourceStates(mem, [src("a", "ALFA", 900, { "kismet.datasource.error": 1, "kismet.datasource.error_reason": "Interface went away", "kismet.datasource.running": 0 }), src("b", "BT", 13)], (2 * STALL_S + 12) * S);
t("unplugged adapter: error with Kismet's reason", st.get("a").state === "error" && /went away/.test(st.get("a").why));
st = sourceStates(mem, [src("a", "ALFA", 900, { "kismet.datasource.running": 0 })], (2 * STALL_S + 14) * S);
t("closed source: closed; removed source forgotten", st.get("a").state === "closed" && !mem.has("b"));
// Kismet restart: counters start again from 0.
st = sourceStates(mem, [src("a", "ALFA", 3)], (2 * STALL_S + 20) * S);
t("counter reset (Kismet restart): checking again, not stalled", st.get("a").state === "checking");
st = sourceStates(mem, [src("a", "ALFA", 40)], (2 * STALL_S + 26) * S);
t("…then capturing once packets rise", st.get("a").state === "capturing");
t("no sources: says so", sourceSummary([], new Map()).text === "no sources");

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("source tests passed");
