// SPDX-License-Identifier: GPL-2.0-or-later
/* Alerts, SSIDs, Messages, System. */

import { h, svg, clear, relTime, absTime, duration, bytes, num, macSearch, debounce, get, requestGate } from "../lib/util.js";
import { ICON } from "../ui/art.js";
import { kismet } from "../api/kismet.js";
import { subscribe } from "../lib/hub.js";
import { rrdSeries, sparkline, recentRate } from "../lib/chart.js";
import { powerRows, eventText, unavailable } from "../lib/hardware.js";
import { groupAlerts } from "../lib/alerts.js";
import { prefsGet } from "../lib/store.js";
import { openByMac } from "../ui/inspector.js";
import { route } from "../ui/shell.js";

const SEV = ["info", "low", "medium", "high", "critical"];
const sevBadge = (n) => h("span", { class: `badge ${n >= 15 ? "b-bad" : n >= 10 ? "b-warn" : n >= 5 ? "b-info" : "b-seen"}` }, ["info", "low", "medium", "high"][Math.min(3, Math.floor((n || 0) / 5))] || "info");
const macA = (m) => m && m !== "00:00:00:00:00:00" ? h("a", { href: "#", class: "mono", onclick: (e) => { e.preventDefault(); openByMac(m); } }, m) : h("span", { class: "faint" }, "—");

route("alerts", {
    title: "Alerts", eyebrow: "kismet alerts",
    mount(main) {
        let alive = true, timer = 0, defsOpen = false;
        const open = new Set();             // expanded groups survive the 10 s refresh
        const body = h("div", { class: "page-pad" });
        main.append(h("div", { class: "page" }, body));
        async function load() {
            try {
                const [list, defs] = await Promise.all([kismet.alerts(0), defsOpen ? kismet.alertDefs() : Promise.resolve(null)]);
                if (!alive) return;
                const rows = list || [];
                const groups = groupAlerts(rows);
                const table = h("table", { class: "table alerts" },
                    h("thead", {}, h("tr", {}, ...["Last", "Severity", "Alert", "Count", "Transmitter", "Source", "Destination", "Ch"].map(t => h("th", {}, t)))),
                    h("tbody", {}, ...groups.flatMap(g => {
                        const expanded = open.has(g.key);
                        const toggle = g.count > 1 ? h("button", { class: "btn ghost count-btn", type: "button", "aria-expanded": String(expanded),
                            "aria-label": `${g.count} occurrences, ${expanded ? "hide" : "show"} times`,
                            onclick: () => { expanded ? open.delete(g.key) : open.add(g.key); load(); } }, svg(ICON.chevron), `×${g.count}`) : h("span", { class: "faint" }, "1");
                        const row = h("tr", { class: g.count > 1 ? "grouped" : "" },
                            h("td", { class: "mono", title: absTime(g.last) }, relTime(g.last)),
                            h("td", {}, sevBadge(g.severity)),
                            h("td", {}, h("div", { class: "mono", style: { fontSize: "12px", color: "var(--text-2)" } }, g.header, " · ", g.cls), g.text,
                                g.count > 1 ? h("div", { class: "faint mono", style: { fontSize: "11.5px", marginTop: "3px" } }, `first ${absTime(g.first).slice(5)} · last ${absTime(g.last).slice(5)}`) : null,
                                h("div", { class: "alert-macs mono" }, [["tx", g.tx], ["src", g.src], ["dst", g.dst], ["ch", g.ch]].filter(([, v]) => v && v !== "00:00:00:00:00:00" && String(v) !== "0").map(([k, v]) => `${k} ${v}`).join(" · "))),
                            h("td", {}, toggle),
                            h("td", {}, macA(g.tx)), h("td", {}, macA(g.src)), h("td", {}, macA(g.dst)), h("td", { class: "mono" }, g.ch || ""));
                        if (!expanded) return [row];
                        return [row, h("tr", { class: "occ" }, h("td", { colspan: 8 },
                            h("div", { class: "occ-list" }, ...g.times.map(t => h("span", { class: "mono", title: relTime(t) }, absTime(t).slice(5))))))];
                    })));
                const defsBox = h("details", { class: "tree", open: defsOpen, style: { marginTop: "22px" } },
                    h("summary", {}, h("span", { class: "tw" }, svg(ICON.chevron)), "Alert definitions and rate limits"));
                defsBox.addEventListener("toggle", () => { if (defsBox.open !== defsOpen) { defsOpen = defsBox.open; load(); } });
                if (defs) defsBox.append(h("div", { class: "node" }, h("table", { class: "table" },
                    h("thead", {}, h("tr", {}, ...["Alert", "Severity", "Description", "Sent", "Last"].map(t => h("th", {}, t)))),
                    h("tbody", {}, ...defs.map(d => h("tr", {}, h("td", { class: "mono" }, d["kismet.alert.definition.header"]),
                        h("td", {}, sevBadge(d["kismet.alert.definition.severity"])), h("td", {}, d["kismet.alert.definition.description"]),
                        h("td", { class: "mono" }, num(d["kismet.alert.definition.total_sent"])),
                        h("td", { class: "mono" }, d["kismet.alert.definition.time_last"] ? relTime(d["kismet.alert.definition.time_last"]) : "—")))))));
                clear(body).append(
                    h("div", { class: "eyebrow", style: { marginBottom: "10px" } }, `${rows.length} alerts in Kismet's memory, ${groups.length} distinct · identical repeats are grouped; Kismet keeps only its most recent alerts`),
                    rows.length ? table : h("div", { class: "empty" }, h("div", { class: "h2" }, "No alerts"), h("p", {}, "Kismet has not raised any alert since it started.")),
                    defsBox);
            } catch (e) {
                if (alive) clear(body).append(h("div", { class: "err" }, `Kismet did not return alerts (${e.status || "no answer"}).`));
            }
            timer = setTimeout(load, 10000);
        }
        load();
        return () => { alive = false; clearTimeout(timer); };
    },
});

route("ssids", {
    title: "SSIDs", eyebrow: "802.11 networks by name",
    mount(main) {
        let alive = true, timer = 0, page = 0, search = "";
        const q = h("input", { class: "field", type: "search", placeholder: "Search SSID", autocomplete: "off" });
        const meta = h("span", { class: "meta" });
        const body = h("div", {});
        const pager = h("div", { class: "pager" });
        main.append(h("div", { class: "toolbar" }, h("label", { class: "search" }, svg(ICON.search), q), meta), h("div", { class: "page" }, body), pager);
        q.addEventListener("input", debounce(() => { search = q.value.trim(); page = 0; load(); }, 300));
        const gate = requestGate();       // only the newest search / page may draw
        async function load() {
            clearTimeout(timer);
            const my = gate.next();
            try {
                const res = await kismet.ssids({ page, length: 50, search });
                if (!alive || !gate.current(my)) return;
                const rows = res.data || [];
                clear(body).append(h("table", { class: "table" },
                    h("thead", {}, h("tr", {}, ...["SSID", "Encryption", "Advertising", "Responding", "Probing", "First", "Last"].map(t => h("th", {}, t)))),
                    h("tbody", {}, ...rows.map(s => h("tr", {},
                        h("td", {}, s["dot11.ssidgroup.ssid"] || h("span", { class: "faint" }, "(hidden)")),
                        h("td", { class: "dim" }, s["dot11.ssidgroup.crypt_string"] || "—"),
                        h("td", { class: "mono" }, s["dot11.ssidgroup.advertising_devices_len"]),
                        h("td", { class: "mono" }, s["dot11.ssidgroup.responding_devices_len"]),
                        h("td", { class: "mono" }, s["dot11.ssidgroup.probing_devices_len"]),
                        h("td", { class: "mono", title: absTime(s["dot11.ssidgroup.first_time"]) }, relTime(s["dot11.ssidgroup.first_time"])),
                        h("td", { class: "mono", title: absTime(s["dot11.ssidgroup.last_time"]) }, relTime(s["dot11.ssidgroup.last_time"])))))));
                const total = res.last_row || rows.length;
                meta.textContent = `${total} SSIDs`;
                clear(pager).append(h("span", {}, `${page * 50 + (rows.length ? 1 : 0)}–${page * 50 + rows.length} of ${total}`),
                    h("button", { class: "btn", type: "button", disabled: page === 0, onclick: () => { page--; load(); } }, "‹ Prev"),
                    h("button", { class: "btn", type: "button", disabled: (page + 1) * 50 >= total, onclick: () => { page++; load(); } }, "Next ›"));
            } catch (e) {
                if (!alive || !gate.current(my)) return;
                clear(body).append(h("div", { class: "err" }, `Kismet did not return SSIDs (${e.status || "no answer"}).`));
            }
            timer = setTimeout(load, 15000);
        }
        load();
        return () => { alive = false; clearTimeout(timer); };
    },
});

/* Kismet message flags: 1 debug, 2 info, 4 error, 8 alert, 16 fatal. */
const FLAG = (f) => (f & 16) ? ["fatal", "b-bad"] : (f & 8) ? ["alert", "b-warn"] : (f & 4) ? ["error", "b-bad"] : (f & 2) ? ["info", "b-info"] : ["debug", "b-seen"];

route("messages", {
    title: "Messages", eyebrow: "kismet message bus",
    mount(main) {
        let alive = true, timer = 0, msgs = [], since = 0, filter = "";
        const q = h("input", { class: "field", type: "search", placeholder: "Filter messages", autocomplete: "off" });
        q.addEventListener("input", () => { filter = q.value.toLowerCase(); draw(); });
        const body = h("div", {});
        main.append(h("div", { class: "toolbar" }, h("label", { class: "search" }, svg(ICON.search), q)), h("div", { class: "page" }, body));
        function draw() {
            const rows = msgs.filter(m => !filter || m.text.toLowerCase().includes(filter));
            clear(body).append(h("table", { class: "table" }, h("tbody", {}, ...rows.map(m => {
                const [lab, cls] = FLAG(m.flags);
                return h("tr", {}, h("td", { class: "mono", style: { width: "170px", whiteSpace: "nowrap" } }, absTime(m.time)),
                    h("td", { style: { width: "70px" } }, h("span", { class: `badge ${cls}` }, lab)), h("td", { class: "mono" }, m.text));
            }))));
            if (!rows.length) body.append(h("div", { class: "empty" }, h("p", {}, "No messages.")));
        }
        async function load() {
            try {
                const r = await kismet.messages(since);
                if (!alive) return;
                const fresh = (r["kismet.messagebus.list"] || []).map(m => ({ text: m["kismet.messagebus.message_string"], flags: m["kismet.messagebus.message_flags"], time: m["kismet.messagebus.message_time"] }));
                msgs = fresh.concat(msgs).sort((a, b) => b.time - a.time).slice(0, 500);
                since = r["kismet.messagebus.timestamp"] || since;
                draw();
            } catch (e) {
                if (alive) clear(body).append(h("div", { class: "err" }, `Kismet did not return messages (${e.status || "no answer"}).`));
            }
            timer = setTimeout(load, 4000);
        }
        load();
        return () => { alive = false; clearTimeout(timer); };
    },
});

function panel(title, ...kids) {
    return h("section", { class: "frame" }, h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, title)), h("div", { class: "frame-body" }, ...kids));
}

/* Measurements taken while Archimet is open (15 s apart), kept for the whole app session.
 * Used only when the logger has no trend of its own; nothing before the first sample is drawn. */
const live = { cpu: [], temp: [], freq: [], mem: [], since: 0, lastT: 0 };
function recordLive(m) {
    if (!m || m.time === live.lastT) return;
    live.lastT = m.time;
    if (!live.since) live.since = m.time;
    const push = (k, v) => { if (typeof v === "number" && isFinite(v)) { live[k].push(v); if (live[k].length > 360) live[k].shift(); } };
    push("cpu", m.cpu_usage && m.cpu_usage.total_pct);
    push("temp", m.cpu && m.cpu.temp_c);
    push("freq", m.cpu && m.cpu.freq_mhz);
    push("mem", m.memory && m.memory.total ? (m.memory.total - m.memory.available) / m.memory.total * 100 : null);
}

route("system", {
    title: "System", eyebrow: "server",
    mount(main) {
        let alive = true;
        const grid = h("div", { class: "health" });
        const lower = h("div", { class: "grid" });
        main.append(h("div", { class: "page" }, h("div", { class: "page-pad" },
            h("h2", { class: "section-h" }, "Health"), grid, h("h2", { class: "section-h" }, "Status"), lower)));
        let st = null, ps = null, gps = null, phys = [], plugins = [], met = null, metErr = null;
        const tempU = () => prefsGet().units.temperature;
        const tC = (c) => tempU() === "f" ? `${(c * 9 / 5 + 32).toFixed(1)} °F` : `${c.toFixed(1)} °C`;
        const card = (title, big, unit, sub, series, histLabel) => h("section", { class: "hcard frame" },
            h("div", { class: "hcard-head" }, h("span", { class: "eyebrow" }, title)),
            h("div", { class: "stat" }, h("span", { class: "big" }, big), unit ? h("span", { class: "dim" }, unit) : null),
            sub ? h("div", { class: "hcard-sub" }, sub) : null,
            h("div", { class: "panel-chart" }, series && series.length > 1 ? sparkline(series, { width: 300, height: 40 })
                : h("div", { class: "chart-empty" }, series && series.length === 1 ? "one measurement so far" : "no history yet")),
            h("div", { class: "faint mono hcard-foot" }, histLabel));
        const liveLabel = (arr) => arr.length ? `measured every 15 s since ${absTime(live.since).slice(11, 16)} (Archimet open)` : "not measured yet";
        function trend(key, liveKey, scale) {
            const tr = met && Array.isArray(met.trend) ? met.trend.filter(x => typeof x[key] === "number") : [];
            if (tr.length > 1) return [tr.map(x => scale ? scale(x[key]) : x[key]), `logger trend · 1/min since ${absTime(tr[0].t).slice(11, 16)}`];
            return [live[liveKey], liveLabel(live[liveKey])];
        }
        function draw() {
            if (!alive) return;
            if (!st) { clear(grid).append(h("div", { class: "loading" }, "reading status")); return; }
            const now = st["kismet.system.timestamp.sec"], start = st["kismet.system.timestamp.start_sec"];
            const mem = rrdSeries(st["kismet.system.memory.rrd"], "hour");
            const devs = rrdSeries(st["kismet.system.devices.rrd"], "hour");
            const pk = ps ? rrdSeries(ps["kismet.packetchain.packets_rrd"], "minute") : [];
            const drop = ps ? rrdSeries(ps["kismet.packetchain.dropped_packets_rrd"], "minute") : [];
            const errs = ps ? rrdSeries(ps["kismet.packetchain.error_packets_rrd"], "minute") : [];
            const sum = (a) => a.reduce((x, y) => x + y, 0);
            const na = (why) => h("p", { class: "dim", style: { margin: 0 } }, why);
            const metWhy = metErr ? `Pi hardware readings unavailable (${metErr.status === 404 ? "the Pi's logger is older than 5.2" : metErr.status || "no answer"}).` : "reading Pi hardware…";
            const u = met && met.cpu_usage && !unavailable(met.cpu_usage) ? met.cpu_usage : null;
            const c = met && met.cpu && !unavailable(met.cpu) ? met.cpu : null;
            const m = met && met.memory && !unavailable(met.memory) ? met.memory : null;
            const [cpuS, cpuL] = trend("cpu_pct", "cpu");
            const [tS, tL] = trend("temp_c", "temp");
            const [fS, fL] = trend("freq_mhz", "freq");
            const [mS, mL] = m ? trend("mem_used", "mem", (v) => v / m.total * 100) : [live.mem, liveLabel(live.mem)];
            const pc = u ? u.processes_pct : {};
            const kTemps = Object.entries(st["kismet.system.sensors.temp"] || {});
            const hasT = c && typeof c.temp_c === "number";
            clear(grid).append(
                card("CPU usage", u ? `${u.total_pct}` : "—", u ? "% of all 4 cores" : "",
                    u ? `Kismet ${pc.kismet ?? "—"}% · capture helpers ${pc["capture helpers"] ?? "—"}% · Archimet logger ${pc["archimet logger"] ?? "—"}%` : metWhy, cpuS, cpuL),
                card("Temperature", hasT ? tC(c.temp_c) : kTemps.length ? tC(kTemps[0][1]) : "—", "",
                    hasT ? "CPU, from the Pi's thermal sensor" : kTemps.length ? "from Kismet's sensor reading" : metWhy, tS, tL),
                card("CPU clock", c && typeof c.freq_mhz === "number" ? `${c.freq_mhz}` : "—", c && c.max_freq_mhz ? `of ${c.max_freq_mhz} MHz` : "MHz",
                    c && typeof c.freq_mhz === "number" ? (c.freq_mhz < c.max_freq_mhz ? "below maximum: idle scaling or throttling (see Power)" : "at maximum") : metWhy, fS, fL),
                card("System memory", m ? `${Math.round((m.total - m.available) / m.total * 100)}` : "—", m ? "% used" : "",
                    m ? `${bytes(m.total - m.available)} used of ${bytes(m.total)}` : metWhy, mS, mL),
                card("Kismet memory", bytes((st["kismet.system.memory.rss"] || 0) * 1024), "resident", "Kismet's own process", mem, "Kismet history · last hour"),
                card("Packets", `${recentRate(pk)}`, "per second (10 s avg)", `${sum(drop)} dropped · ${sum(errs)} errors in the last minute`, pk, "Kismet history · last minute"),
                card("Devices", num(st["kismet.system.devices.count"]), "in Kismet's memory", "since Kismet started", devs, "Kismet history · last hour"));

            const lvl = { ok: "b-ok", warn: "b-warn", bad: "b-bad", unknown: "" };
            const uvEvents = met && Array.isArray(met.events) ? met.events.filter(e => e.kind === "undervoltage_start") : null;
            const power = met ? h("div", {},
                h("dl", { class: "kv" }, ...powerRows(met).flatMap(([label, level, text]) => [h("dt", {}, label),
                    h("dd", {}, h("span", { class: `badge ${lvl[level]}` }, level === "ok" ? "ok" : level === "bad" ? "now" : level === "warn" ? "earlier" : "n/a"), " ", text)]),
                    h("dt", {}, "Under-voltage events"), h("dd", {}, uvEvents ? (uvEvents.length ? `${uvEvents.length} recorded · last ${absTime(uvEvents[uvEvents.length - 1].t).slice(5)}` : "none recorded") : "counted by logger 5.2"),
                    h("dt", {}, "Raw flags"), h("dd", { class: "mono faint" }, met.throttled && met.throttled.raw || "—")),
                met.throttled && met.throttled.since_boot && met.throttled.since_boot.undervoltage
                    ? h("p", { class: "warnline" }, "Under-voltage means the supply is not holding 5 V under load. USB radios such as the Alfa are the first to misbehave when it dips. A better supply or a powered USB hub is the fix.") : null)
                : na(metWhy);
            const storage = met && Array.isArray(met.disks) ? h("dl", { class: "kv" }, ...met.disks.flatMap(d => unavailable(d)
                ? [h("dt", {}, d.label), h("dd", { class: "dim" }, d.unavailable)]
                : [h("dt", {}, d.label), h("dd", { class: "mono" }, `${bytes(d.free)} free of ${bytes(d.total)} (${Math.round(100 - d.free / d.total * 100)}% used)`)]),
                h("dt", {}, "Pi up for"), h("dd", {}, met.host && met.host.uptime_s ? duration(met.host.uptime_s) : "—"),
                h("dt", {}, "Model"), h("dd", {}, (met.host && met.host.model) || "—")) : na(metWhy);
            const ev = met ? (unavailable(met.events) ? na(met.events.unavailable)
                : met.events.length ? h("div", { class: "timeline" }, ...met.events.slice(-14).reverse().map(e => h("div", { class: "ev", style: { "--c": /undervoltage_start|removed|reenumerated|recreated|stopped/.test(e.kind) ? "var(--bad)" : "var(--text-3)" } },
                    h("span", { class: "mono" }, absTime(e.t).slice(5)), " ", eventText(e))))
                : na("No hardware events recorded since the logger started.")) : na(metWhy);
            const active = phys.filter(p => p["kismet.phy.device_count"] > 0);
            const g = gps && gps["kismet.common.location.geopoint"];
            const gpsOn = !!(g && (g[0] || g[1]));
            clear(lower).append(
                panel("power & throttling", power),
                panel("storage & host", storage),
                panel("hardware events", ev, h("p", { class: "faint", style: { margin: "8px 0 0", fontSize: "12px" } }, h("a", { href: "#/sources" }, "USB and radio hardware →"))),
                panel("kismet",
                    h("dl", { class: "kv" },
                        h("dt", {}, "Version"), h("dd", { class: "mono" }, `${st["kismet.system.version"]} · ${st["kismet.system.git"] || ""}`),
                        h("dt", {}, "Up for"), h("dd", {}, duration(now - start)),
                        h("dt", {}, "Runs as"), h("dd", { class: "mono" }, st["kismet.system.user"]),
                        h("dt", {}, "Active radios"), h("dd", {}, active.length ? active.map(p => `${p["kismet.phy.phy_name"]} · ${num(p["kismet.phy.device_count"])} devices`).join("; ") : "none yet"),
                        h("dt", {}, "Plugins"), h("dd", {}, plugins.length ? plugins.map(p => `${p["kismet.plugin.name"]} ${p["kismet.plugin.version"]}`).join(", ") : "none"),
                        h("dt", {}, "GPS"), h("dd", {}, gpsOn ? `${g[1].toFixed(5)}, ${g[0].toFixed(5)}` : "not configured (no GPS receiver on this Pi)"))),
                h("p", { class: "faint not-configured" }, `Not configured, so not shown: radiation sensor, battery monitor${gpsOn ? "" : ", GPS"}. ${phys.length - active.length} of Kismet's ${phys.length} radio handlers have seen no devices.`));
        }
        const u1 = subscribe("status", (s) => { st = s; draw(); });
        const u2 = subscribe("packets", (p) => { ps = p; draw(); });
        const u3 = subscribe("gps", (g) => { gps = g; });
        const u4 = subscribe("metrics", (m, e) => { met = m; metErr = e; recordLive(m); draw(); });
        kismet.phys().then(p => { phys = p || []; draw(); }).catch(() => {});
        kismet.plugins().then(p => { plugins = p || []; draw(); }).catch(() => {});
        return () => { alive = false; u1(); u2(); u3(); u4(); };
    },
});
