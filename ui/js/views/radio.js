/* Sources (Kismet data sources) and Channels. Tuning is receive-only (lock/hop). */

import { sourceStates } from "../lib/sources.js";
import { h, svg, clear, num, relTime, absTime, duration, requestGate } from "../lib/util.js";
import { channelLabel, wifiChannel } from "../lib/band.js";
import { sourceHardware, sourceHistory, detectHardware, sourceDefinition, recheckAvailable } from "../lib/hardware.js";
import { ICON } from "../ui/art.js";
import { kismet } from "../api/kismet.js";
import { config } from "../api/archimet.js";
import { subscribe, refresh } from "../lib/hub.js";
import { rrdSeries, sparkline, bars } from "../lib/chart.js";
import { route, dialog, toast } from "../ui/shell.js";

const cardMemory = new Map();      // packet-count watch per source for the cards

route("sources", {
    title: "Sources", eyebrow: "radios",
    mount(main) {
        let alive = true, types = null, srcList = null, srcErr = null, met = null, metErr = null, alerts = [];
        let probed = null, probeErr = null, probing = false;
        const grid = h("div", { class: "grid" });
        const detected = h("div", {});
        const drivers = h("details", { class: "tree", style: { marginTop: "22px" } },
            h("summary", {}, h("span", { class: "tw" }, svg(ICON.chevron)), "Capture drivers installed with Kismet"), h("div", { class: "node" }));
        drivers.addEventListener("toggle", async () => {
            if (!drivers.open || types) return;
            try { types = await kismet.sourceTypes(); } catch (e) { types = []; }
            drivers.querySelector(".node").append(h("table", { class: "table" },
                h("thead", {}, h("tr", {}, ...["Driver", "Description", "Local", "Remote", "Tuning"].map(t => h("th", {}, t)))),
                h("tbody", {}, ...types.map(t => h("tr", {}, h("td", { class: "mono" }, t["kismet.datasource.driver.type"]), h("td", {}, t["kismet.datasource.driver.description"]),
                    h("td", {}, t["kismet.datasource.driver.local_capable"] ? "yes" : "—"), h("td", {}, t["kismet.datasource.driver.remote_capable"] ? "yes" : "—"),
                    h("td", {}, t["kismet.datasource.driver.tuning_capable"] ? "yes" : "—"))))));
        });
        main.append(h("div", { class: "page" }, h("div", { class: "page-pad" },
            h("h2", { class: "section-h" }, "Configured Kismet sources"),
            h("p", { class: "dim", style: { margin: "0 0 16px", maxWidth: "80ch" } }, "The radios Kismet is capturing with. Wi-Fi capture is passive (monitor mode); Kismet's Bluetooth (hci0) source actively scans for devices. These controls only change which channel a radio listens on, or open and close it. Changes apply to the Kismet server for everyone."),
            grid,
            h("h2", { class: "section-h" }, "Detected radio hardware"),
            h("p", { class: "dim", style: { margin: "0 0 12px", maxWidth: "80ch" } }, "Radios the Pi reports, whether or not Kismet uses them. Plugging in an adapter does not make it a source: add it here, and Archimet checks that it opened and is capturing."),
            detected, drivers)));

        async function probe() {
            probing = true; drawDetected();
            try { probed = await kismet.listInterfaces(); probeErr = null; } catch (e) { probeErr = e; }
            probing = false; drawDetected();
        }

        function drawDetected() {
            if (!alive) return;
            const ro = config().readonly;
            if (!met && !metErr) { clear(detected).append(h("div", { class: "loading" }, "reading Pi hardware")); return; }
            const hw = detectHardware(met, srcList, probed);
            const label = { source: ["Kismet source", "b-ok"], managed: ["NetworkManager", "b-warn"], busy: ["in use", "b-warn"], config: ["config only", ""], available: ["available", "b-info"], unsupported: ["not capturable", ""] };
            const rows = hw.radios.map(e => h("tr", {},
                h("td", { class: "mono" }, e.iface),
                h("td", {}, e.kind === "bluetooth" ? "Bluetooth" : "Wi-Fi"),
                h("td", { class: "mono" }, e.usb ? `${[e.usb.manufacturer, e.usb.product].filter(Boolean).join(" ")} · ${e.usb.id} · port ${e.usb.port}` : e.bus === "usb" ? "USB adapter" : e.bus ? `on-board (${e.bus})` : "on-board (not USB)"),
                h("td", { class: "mono" }, e.driver || "—"),
                h("td", {}, h("span", { class: `badge ${label[e.status][1]}` }, label[e.status][0]), " ", h("span", { class: "dim" }, e.note)),
                h("td", {}, e.status === "available"
                    ? h("button", { class: "btn", type: "button", disabled: ro, title: ro ? "read-only preview" : "", onclick: () => addSource(e) }, "Add as source…") : null)));
            clear(detected).append(...[
                metErr ? h("p", { class: "faint" }, `Pi hardware readings unavailable (${metErr.status === 404 ? "needs logger 5.2" : metErr.status || "no answer"}); only Kismet's own interface list is shown.`) : null,
                h("table", { class: "table detected" },
                    h("thead", {}, h("tr", {}, ...["Interface", "Radio", "Hardware", "Driver", "Status", ""].map(t => h("th", {}, t)))),
                    h("tbody", {}, ...rows)),
                h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "10px" } },
                    h("button", { class: "btn ghost", type: "button", disabled: probing, onclick: probe }, probing ? "Asking Kismet…" : "Ask Kismet for capture interfaces"),
                    h("span", { class: "faint", style: { fontSize: "12.5px" } }, probeErr ? `Kismet did not list interfaces (${probeErr.status || "no answer"}).` : probed ? `Kismet can capture on ${probed.length} interface${probed.length === 1 ? "" : "s"}.` : "")),
                hw.otherUsb.length ? h("details", { class: "tree", style: { marginTop: "14px" } },
                    h("summary", {}, h("span", { class: "tw" }, svg(ICON.chevron)), `Other USB devices (${hw.otherUsb.length})`),
                    h("div", { class: "node" }, h("dl", { class: "kv" }, ...hw.otherUsb.flatMap(u => [h("dt", { class: "mono" }, u.port),
                        h("dd", {}, `${[u.manufacturer, u.product].filter(Boolean).join(" ") || (u.drivers.includes("hub") ? "USB hub" : u.drivers.includes("lan78xx") ? "Ethernet (LAN7800)" : "device")} · ${u.id}${u.drivers.length ? " · " + u.drivers.join(", ") : ""}`)])))) : null].filter(Boolean));
        }

        /* Kismet's add_source.cmd, then proof: the source must be running and its packet count rising. */
        async function addSource(e) {
            const name = h("input", { class: "field", value: `USB_${e.iface.toUpperCase()}`, maxlength: "32", spellcheck: "false" });
            const go = await dialog(`Add ${e.iface} as a Kismet source`, h("div", { class: "frame-body" },
                h("p", { class: "dim", style: { margin: 0, lineHeight: "1.55" } }, `Kismet opens ${e.iface} (${e.driver || e.type}) for passive Wi-Fi capture, for everyone using this Kismet. Wi-Fi adapters are put in monitor mode. It stays a source until Kismet restarts; to keep it, add it to Kismet's configuration.`),
                h("label", { class: "eyebrow" }, "Source name"), name),
                { actions: [["Cancel", false, "ghost"], ["Add and check", true, "primary"]] });
            if (!go) return;
            // Re-check with fresh answers: the adapter may have been unplugged, taken by another
            // process, or added by someone else while the dialog was open.
            const [freshSrc, freshProbe] = await Promise.all([kismet.sources().catch(() => null), kismet.listInterfaces().catch(() => null)]);
            const rc = freshSrc ? recheckAvailable(e.iface, met, freshSrc, freshProbe) : { ok: false, reason: "Kismet did not list its sources just now." };
            if (!rc.ok) { toast("Not added", rc.reason, { color: "var(--bad)" }); probed = freshProbe || probed; refresh("sources"); drawDetected(); return; }
            let def;
            try { def = sourceDefinition(e.iface, e.type, name.value); } catch (err) { toast("Not added", err.message, { color: "var(--bad)" }); return; }
            const want = def.split("name=")[1];
            toast("Adding source", `${want}: asking Kismet…`);
            try { await kismet.addSource(def); } catch (err) { toast("Not added", `Kismet answered ${err.status || "nothing"}.`, { color: "var(--bad)" }); return; }
            let first = null;
            for (let i = 0; i < 15 && alive; i++) {
                await new Promise(r => setTimeout(r, 2000));
                const list = await kismet.sources().catch(() => []);
                const s = list.find(x => x["kismet.datasource.name"] === want);
                if (!s) continue;
                if (s["kismet.datasource.error"]) { toast("Source failed to open", s["kismet.datasource.error_reason"] || "error", { color: "var(--bad)" }); refresh("sources"); return; }
                const n = s["kismet.datasource.num_packets"] || 0;
                if (s["kismet.datasource.running"] && first !== null && n > first) { toast("Source capturing", `${want} opened and has received ${num(n)} packets.`); refresh("sources"); return; }
                if (s["kismet.datasource.running"] && first === null) first = n;
            }
            toast("Not confirmed", `${want} was added but has not shown rising packet counts within 30 s. Check it below.`, { color: "var(--warn)" });
            refresh("sources");
        }

        function hardware(s) {
            if (metErr || !met) return h("p", { class: "faint", style: { margin: "10px 0 0" } },
                metErr ? `Pi hardware readings unavailable (${metErr.status === 404 ? "needs logger 5.2" : metErr.status || "no answer"}).` : "reading Pi hardware…");
            const hw = sourceHardware(s, met);
            const u = hw.usb, w = hw.wifi;
            const b = hw.bt;
            const usbText = u ? `${[u.manufacturer, u.product].filter(Boolean).join(" ") || "USB device"} · ${u.id} · port ${u.port} · ${u.speed_mbps} Mb/s · rated ${u.max_power_ma} mA · power ${u.power_control === "on" ? "always on" : u.power_control}`
                : b ? (b.bus === "usb" ? `USB Bluetooth adapter · ${b.driver || "driver unknown"}` : `on-board Bluetooth (${b.bus} · ${b.driver || "driver unknown"})`)
                : w ? "not USB-attached" : "the Pi did not report this interface";
            return h("dl", { class: "kv hw" },
                h("dt", {}, "Hardware"), h("dd", { class: "mono" }, usbText),
                w ? h("dt", {}, "Kernel driver") : null, w ? h("dd", { class: "mono" }, `${w.driver || "—"} · ${w.iface}${/^(up|down)$/.test(w.operstate || "") ? " " + w.operstate : ""}`) : null,
                h("dt", {}, "Helper up"), h("dd", {}, hw.helper && hw.helper.started ? `${duration(met.time - hw.helper.started)} (since ${absTime(hw.helper.started).slice(11)})` : "not reported"));
        }

        function history(s) {
            const hist = sourceHistory(alerts, s["kismet.datasource.uuid"]);
            const lastErr = hist.find(x => x.kind === "error"), lastOpen = hist.find(x => x.kind === "reopened");
            return h("div", { class: "src-hist" },
                h("dl", { class: "kv" },
                    h("dt", {}, "Restarts"), h("dd", {}, `${num(s["kismet.datasource.total_retry_attempts"] || 0)} in this Kismet run`),
                    h("dt", {}, "Last error"), h("dd", {}, lastErr ? `${relTime(lastErr.t)} · ${absTime(lastErr.t).slice(11)} · ${s["kismet.datasource.error_reason"] || "error"}` : "none in Kismet's recent alerts"),
                    h("dt", {}, "Last reopen"), h("dd", {}, lastOpen ? `${relTime(lastOpen.t)} · ${absTime(lastOpen.t).slice(11)}` : "none in Kismet's recent alerts")),
                hist.length ? h("details", { class: "tree" }, h("summary", {}, h("span", { class: "tw" }, svg(ICON.chevron)), `Recent source events (${hist.length})`),
                    h("div", { class: "timeline" }, ...hist.slice(0, 12).map(x => h("div", { class: "ev", style: { "--c": x.kind === "error" ? "var(--bad)" : "var(--ok)" } },
                        h("span", { class: "mono" }, absTime(x.t).slice(5)), " ", x.kind === "error" ? "closed with an error" : "re-opened")))) : null,
                h("p", { class: "faint", style: { margin: "6px 0 0", fontSize: "12px" } }, "From Kismet's alert list, which keeps only the latest alerts and resets when Kismet restarts."));
        }

        function draw(list, err) {
            if (err) { clear(grid).append(h("div", { class: "err" }, `Kismet did not return sources (${err.status || "no answer"}).`)); return; }
            const ro = config().readonly;
            clear(grid);
            const states = sourceStates(cardMemory, list, Date.now());
            for (const s of list || []) {
                const running = s["kismet.datasource.running"], errored = s["kismet.datasource.error"];
                // Open is not the same as capturing: the badge needs a rising packet count (lib/sources.js).
                const ss = states.get(s["kismet.datasource.uuid"]) || { state: "checking", label: "checking", why: "" };
                const state = [ss.label, { capturing: "b-ok", checking: "b-info", stalled: "b-bad", error: "b-bad" }[ss.state] || "b-warn", ss.why];
                const pk = rrdSeries(s["kismet.datasource.packets_rrd"], "minute");
                const hop = s["kismet.datasource.hopping"];
                const chans = s["kismet.datasource.channels"] || [];
                const uuid = s["kismet.datasource.uuid"];
                const act = async (label, fn) => {
                    try { await fn(); toast(label, s["kismet.datasource.name"]); refresh("sources"); }
                    catch (e) { toast("Not applied", `Kismet answered ${e.status || "nothing"}.`, { color: "var(--bad)" }); }
                };
                const lock = async () => {
                    const sel = h("select", { class: "field" }, ...chans.map(c => h("option", { value: c }, c)));
                    const v = await dialog("Lock channel", h("div", { class: "frame-body" }, h("p", { class: "dim", style: { margin: 0 } }, "The radio stops hopping and listens on one channel. Server-wide."), sel),
                        { actions: [["Cancel", null, "ghost"], ["Lock", () => sel.value, "primary"]] });
                    if (v) act("Channel locked", () => kismet.lockChannel(uuid, v));
                };
                grid.append(h("section", { class: "frame" },
                    h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, s["kismet.datasource.name"]), h("span", { class: `badge ${state[1]}`, title: state[2] }, state[0])),
                    h("div", { class: "frame-body" },
                        h("dl", { class: "kv" },
                            h("dt", {}, "Interface"), h("dd", { class: "mono" }, `${s["kismet.datasource.interface"]}${s["kismet.datasource.capture_interface"] && s["kismet.datasource.capture_interface"] !== s["kismet.datasource.interface"] ? " → " + s["kismet.datasource.capture_interface"] : ""}`),
                            h("dt", {}, "Driver"), h("dd", { class: "mono" }, `${s["kismet.datasource.type_driver"] ? s["kismet.datasource.type_driver"]["kismet.datasource.driver.type"] || "" : ""} ${s["kismet.datasource.hardware"] || ""}`),
                            h("dt", {}, "Listening"), h("dd", {}, hop ? `hopping ${chans.length} channels at ${s["kismet.datasource.hop_rate"]}/s` : `locked on ${s["kismet.datasource.channel"] || "—"}`),
                            h("dt", {}, "Packets"), h("dd", { class: "mono" }, `${num(s["kismet.datasource.num_packets"])} · ${num(s["kismet.datasource.num_error_packets"])} errors`),
                            s["kismet.datasource.warning"] ? h("dt", {}, "Warning") : null, s["kismet.datasource.warning"] ? h("dd", { class: "dim" }, s["kismet.datasource.warning"]) : null,
                            errored ? h("dt", {}, "Error") : null, errored ? h("dd", {}, s["kismet.datasource.error_reason"] || "") : null),
                        h("div", { class: "panel-chart" }, sparkline(pk, { width: 300, height: 46 })),
                        hardware(s), history(s),
                        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" } },
                            chans.length ? h("button", { class: "btn", type: "button", disabled: ro || !running, onclick: lock }, "Lock channel…") : null,
                            chans.length && !hop ? h("button", { class: "btn", type: "button", disabled: ro || !running, onclick: () => act("Hopping", () => kismet.hopChannels(uuid)) }, "Hop all channels") : null,
                            running ? h("button", { class: "btn ghost", type: "button", disabled: ro, onclick: () => act("Source closed", () => kismet.closeSource(uuid)) }, "Close")
                                : h("button", { class: "btn", type: "button", disabled: ro, onclick: () => act("Source opened", () => kismet.openSource(uuid)) }, "Open"),
                            ro ? h("span", { class: "readonly-note" }, "read-only preview") : null))));
            }
        }
        const redraw = () => { if (alive && (srcList || srcErr)) draw(srcList, srcErr); drawDetected(); };
        probe();
        const un = subscribe("sources", (l, e) => { srcList = l; srcErr = e; redraw(); });
        const um = subscribe("metrics", (m, e) => { met = m; metErr = e; redraw(); });
        let at = 0;
        const pollAlerts = async () => {
            try { alerts = await kismet.alerts(0); redraw(); } catch (e) { /* history then shows none */ }
            if (alive) at = setTimeout(pollAlerts, 15000);
        };
        pollAlerts();
        return () => { alive = false; un(); um(); clearTimeout(at); };
    },
});

route("channels", {
    title: "Channels", eyebrow: "spectrum",
    mount(main) {
        let alive = true, timer = 0, metric = "device";
        const gate = requestGate();
        const seg = h("div", { class: "seg", role: "group", "aria-label": "Measure" },
            ...[["device", "Devices"], ["packets", "Packets"], ["data", "Data"]].map(([id, label]) =>
                h("button", { type: "button", "aria-pressed": id === metric ? "true" : "false", onclick: (e) => { metric = id; seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", "false")); e.target.setAttribute("aria-pressed", "true"); load(); } }, label)));
        const band24 = h("div", {}), band5 = h("div", {}), band6 = h("div", {}), other = h("div", {});
        main.append(h("div", { class: "toolbar" }, seg, h("span", { class: "meta" }, "last value per channel, from Kismet's channel tracker")),
            h("div", { class: "page" }, h("div", { class: "page-pad", style: { display: "grid", gap: "18px" } },
                h("section", { class: "frame" }, h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, "2.4 GHz")), h("div", { class: "frame-body" }, band24)),
                h("section", { class: "frame" }, h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, "5 GHz")), h("div", { class: "frame-body" }, band5)),
                h("section", { class: "frame" }, h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, "6 GHz")), h("div", { class: "frame-body" }, band6)),
                h("section", { class: "frame" }, h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, "other (Bluetooth / unlabelled)")), h("div", { class: "frame-body" }, other)))));
        async function load() {
            clearTimeout(timer);
            const my = gate.next();
            try {
                const c = await kismet.channels();
                if (!alive || !gate.current(my)) return;
                const map = c["kismet.channeltracker.frequency_map"] || {};
                const key = { device: "kismet.channelrec.device_rrd", packets: "kismet.channelrec.packets_rrd", data: "kismet.channelrec.data_rrd" }[metric];
                const items = Object.values(map).map(r => {
                    const s = rrdSeries(r[key], "minute");
                    const v = metric === "device" ? (r[key] ? r[key]["kismet.common.rrd.last_value"] || 0 : 0) : s.reduce((a, b) => a + b, 0);
                    const f = r["kismet.channelrec.frequency"];
                    return { f, label: channelLabel(f) || `${Math.round(f / 1000)}`, value: v,
                        band: wifiChannel((Number(f) || 0) / 1000)?.band || "" };
                }).sort((a, b) => a.f - b.f);
                const put = (box, list) => clear(box).append(list.length ? bars(list, { height: 150 }) : h("p", { class: "dim" }, "No activity recorded."));
                put(band24, items.filter(i => i.band === "2.4"));
                put(band5, items.filter(i => i.band === "5"));
                put(band6, items.filter(i => i.band === "6"));
                put(other, items.filter(i => !i.band));
            } catch (e) {
                if (alive && gate.current(my)) clear(band24).append(h("div", { class: "err" }, `Kismet did not return channels (${e.status || "no answer"}).`));
            }
            if (alive && gate.current(my)) timer = setTimeout(load, 8000);
        }
        load();
        return () => { alive = false; clearTimeout(timer); };
    },
});
