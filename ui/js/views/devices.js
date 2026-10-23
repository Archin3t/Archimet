/* Devices: one view control, one search box, concise rows, inspector on click. */

import { h, svg, clear, relTime, absTime, macSearch, debounce, requestGate } from "../lib/util.js";
import { ICON } from "../ui/art.js";
import { kismet } from "../api/kismet.js";
import { subscribe, current, known } from "../lib/hub.js";
import { category, badgesFor, markerFor, identity } from "../lib/classify.js";
import { radioInfo, radioText, radioTitle } from "../lib/band.js";
import { newestThenSignal } from "../lib/device_order.js";
import { prefsGet, prefsSet } from "../lib/store.js";
import { open as openInspector, close as closeInspector } from "../ui/inspector.js";
import { route, dialog, toast } from "../ui/shell.js";
import { gridColumns } from "../ui/resize.js";
import { CATS, CAT_GROUPS, PRESETS, buildFilter, presetOf, summary, needsLogger as catsNeedLogger } from "../lib/filters.js";

const COLS = [
    ["type", "Type", "110px", "type"],
    // Not sortable: Kismet can only sort by its last-packet frequency tag (a hopping artefact), which is
    // not what this column shows (the band the channel evidence supports).
    ["band", "Radio", "104px", null],
    ["channel", "Ch", "52px", "channel"],
    ["signal", "Signal", "92px", "signal"],
    ["manuf", "Manufacturer", "minmax(120px, 1fr)", "manuf"],
    ["crypt", "Encryption", "minmax(110px, .8fr)", null],
    ["packets", "Packets", "80px", "packets"],
    ["last", "Last heard", "96px", "last"],
];
const PAGE = 50;

function sigBars(dbm) {
    const lvl = dbm == null || dbm === 0 ? 0 : dbm > -55 ? 4 : dbm > -67 ? 3 : dbm > -78 ? 2 : 1;
    return h("span", { class: "sig", "aria-hidden": "true" }, ...[4, 7, 10, 12].map((ht, i) => h("i", { class: i < lvl ? "on" : "", style: { height: ht + "px" } })));
}

/* The Devices sort is deliberately NOT saved: every page load and every fresh sign-in starts with
 * Last heard, newest first; equal-second readings put stronger signals first.
 * A clicked column lasts for this page session. */
const DEFAULT_SORT = { key: "last", dir: "desc" };
let sessionSort = { ...DEFAULT_SORT };
export function resetDevicesSort() { sessionSort = { ...DEFAULT_SORT }; }

route("devices", {
    title: "Devices", eyebrow: "monitor",
    mount(main, args) {
        const p = prefsGet();
        // view = Kismet scope ("all" or one source's seenby view); cats = categories (null = everything).
        let view = /^(all|seenby-)/.test(p.view) ? p.view : "all", cats = p.cats, search = "", page = 0, sort = sessionSort.key, dir = sessionSort.dir;
        let rows = [], total = 0, selected = null, timer = 0, alive = true, scopes = [];

        const viewBtn = h("button", { class: "btn view-btn", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: () => togglePanel() },
            svg(ICON.filter), h("span", { class: "lbl" }), svg(ICON.chevron));
        const panel = h("div", { class: "view-panel frame", role: "dialog", "aria-label": "What to show", hidden: true });
        const viewWrap = h("div", { class: "view-wrap" }, viewBtn, panel);
        const q = h("input", { class: "field", type: "search", placeholder: "Search name, SSID, manufacturer or MAC (any format)", "aria-label": "Search devices", autocomplete: "off", spellcheck: "false" });
        const meta = h("span", { class: "meta" });
        const colsBtn = h("button", { class: "btn ghost cols-btn", type: "button", onclick: chooseColumns }, "Columns");
        const toolbar = h("div", { class: "toolbar" }, viewWrap, h("label", { class: "search" }, svg(ICON.search), q), meta, colsBtn);
        const list = h("div", { class: "list", role: "grid", "aria-label": "Devices" });
        const pager = h("div", { class: "pager" });
        const page_ = h("div", { class: "page" }, list);
        main.append(toolbar, page_, pager);

        /* Chosen columns, minus the least important ones when the list is too narrow for them
         * (tablets): Device and State always stay visible. */
        const MIN = { type: 110, band: 104, channel: 52, signal: 92, manuf: 120, crypt: 110, packets: 80, last: 96 };
        const DROP = ["crypt", "packets", "channel", "type", "manuf"];
        function cols() {
            let chosen = COLS.filter(([id]) => prefsGet().columns[id]);
            const avail = (list.clientWidth || main.clientWidth || innerWidth) - 40;
            const need = () => 220 + 150 + chosen.reduce((n, [id]) => n + MIN[id] + 12, 0);
            for (const id of DROP) if (need() > avail) chosen = chosen.filter(([c]) => c !== id);
            return chosen;
        }
        // Default width (px) and minimum per column; Device and Manufacturer / Encryption also grow.
        const WIDTH = { type: [110, 70], band: [120, 80], channel: [56, 44], signal: [92, 70], manuf: [150, 90, 1], crypt: [130, 80, 0.8], packets: [80, 60], last: [104, 80] };
        let gc = null;
        function template() {
            gc = gridColumns("devices", [{ id: "device", label: "Device", w: 240, min: 170, flex: 2.2 },
                ...cols().map(([id, label]) => ({ id, label, w: WIDTH[id][0], min: WIDTH[id][1], flex: WIDTH[id][2] })),
                { id: "state", label: "State", w: 150, min: 110 }], list);
            return "var(--cols)";
        }

        function head() {
            const tpl = template();
            const btn = (label, key) => key
                ? h("button", { type: "button", "aria-sort": sort === key ? (dir === "desc" ? "descending" : "ascending") : null,
                    title: key === "signal" ? "Sorted by Kismet. Devices without a signal reading (many Bluetooth devices) count as the lowest, so they come first when ascending."
                        : key === "last" && dir === "desc" ? "Newest observations first; stronger signal breaks ties within this page." : null,
                    onclick: () => { if (sort === key) dir = dir === "desc" ? "asc" : "desc"; else { sort = key; dir = key === "name" || key === "manuf" ? "asc" : "desc"; } sessionSort = { key: sort, dir }; page = 0; load(); } },
                    label, sort === key ? (dir === "desc" ? " ↓" : " ↑") : "")
                : h("span", {}, label);
            const cell = (id, child, style) => h("span", { class: "hcell", style }, child, gc.grip(id));
            const el = h("div", { class: "lhead", role: "row" }, cell("device", btn("Device", "name")),
                ...cols().map(([id, label, , key]) => cell(id, btn(label, key))), cell("state", h("span", {}, "State"), { textAlign: "right" }));
            el.style.gridTemplateColumns = tpl;
            return el;
        }

        /* Scope: all radios, or what one capture source heard. Kismet's per-PHY views are not
         * offered: they duplicate the categories (and "IEEE802.11 devices" mixes APs and clients). */
        async function buildScopes() {
            let views = [];
            try { views = await kismet.views(); } catch (e) { views = []; }
            const srcs = current("sources") || [];
            scopes = views.filter(v => /^(all|seenby-)/.test(v["kismet.devices.view.id"])).map(v => {
                const id = v["kismet.devices.view.id"];
                const src = srcs.find(s => id === "seenby-" + s["kismet.datasource.uuid"]);
                return { id, label: id === "all" ? "All radios" : `Heard by ${src ? src["kismet.datasource.name"] : id.slice(7, 15)}`, n: v["kismet.devices.view.size"] };
            });
            if (!scopes.some(s => s.id === view)) view = "all";
            label();
        }

        function label() {
            const sc = scopes.find(s => s.id === view);
            viewBtn.querySelector(".lbl").textContent = summary(cats) + (view !== "all" && sc ? ` · ${sc.label}` : "");
        }

        function setCats(next) {
            cats = next && next.length === 0 ? [] : next;
            prefsSet({ cats });
            page = 0; label(); drawPanel(); load();
        }

        function drawPanel() {
            const st = current("state") || {};
            const idx = st.index || { official: new Map(), review: new Map() };
            const set = new Set(cats || CATS.map(c => c.id));
            const logged = (c) => c.review ? idx.review.size : c.watch ? [...idx.review.values()].filter(r => r.watch).length
                : c.kinds ? [...idx.official.values()].filter(r => c.kinds.includes(r.kind)).length : null;
            const box = (c) => h("label", { class: "check" },
                h("input", { type: "checkbox", checked: set.has(c.id), onchange: (e) => {
                    const s = new Set(cats || CATS.map(x => x.id));
                    e.target.checked ? s.add(c.id) : s.delete(c.id);
                    setCats(s.size === CATS.length ? null : [...s]);
                } }),
                h("span", {}, c.label, c.hint ? h("span", { class: "faint" }, ` · ${c.hint}`) : null),
                logged(c) != null ? h("span", { class: "faint num" }, `${logged(c)} in log`) : null);
            const cur = presetOf(cats);
            clear(panel).append(
                h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, "show"), h("button", { class: "btn ghost iconbtn", type: "button", "aria-label": "Close", onclick: () => togglePanel(false) }, svg(ICON.close))),
                h("div", { class: "frame-body" },
                    h("div", { class: "presets", role: "group", "aria-label": "Presets" }, ...PRESETS.map(([id, l, c]) =>
                        h("button", { class: "chip", type: "button", "aria-pressed": String(cur === id), onclick: () => setCats(c ? [...c] : null) }, l))),
                    h("div", { class: "cat-cols" },
                        ...CAT_GROUPS.map(([g, legend]) => h("fieldset", {}, h("legend", {}, legend), ...CATS.filter(c => c.group === g).map(box))),
                        h("p", { class: "faint", style: { margin: "6px 0 0", fontSize: "12px", gridColumn: "1 / -1" } }, "Review is unresolved and never counted as LE. LE boxes list matching devices in Kismet's device list for this run, including ones last heard long ago (see Last heard); every logged LE device is in LE History. The LE log records LE-equipment evidence (vendor match, association, operator mark), not police ownership or use. When a device has several tags, its row marker shows the strongest: LE log, then Watch, then Review, then radio type; all tags are listed as text.")),
                    h("fieldset", { class: "scope-set" }, h("legend", {}, "Heard by"), ...scopes.map(s =>
                        h("label", { class: "check" }, h("input", { type: "radio", name: "scope", checked: s.id === view, onchange: () => { view = s.id; prefsSet({ view }); page = 0; label(); load(); } }),
                            h("span", {}, s.label), h("span", { class: "faint num" }, String(s.n))))),
                    h("p", { class: "faint", style: { margin: "4px 0 0", fontSize: "12px" } }, "A device is listed once, when it belongs to any checked category.")));
        }

        function togglePanel(force) {
            const open = force ?? panel.hidden;
            panel.hidden = !open;
            viewBtn.setAttribute("aria-expanded", String(open));
            if (open) { drawPanel(); (panel.querySelector("[aria-pressed=true]") || panel.querySelector("input")).focus(); }
        }
        const outside = (e) => { if (!panel.hidden && !viewWrap.contains(e.target)) togglePanel(false); };
        const escKey = (e) => { if (e.key === "Escape" && !panel.hidden) { togglePanel(false); viewBtn.focus(); } };
        document.addEventListener("click", outside, true);
        document.addEventListener("keydown", escKey);

        const gate = requestGate();       // a slow older search must not overwrite a newer one
        async function load(quiet) {
            clearTimeout(timer);
            const my = gate.next();
            const stale = () => !alive || !gate.current(my);
            if (!quiet) { clear(list).append(head(), h("div", { class: "loading" }, "reading devices")); }
            const st = current("state");
            const needsLogger = catsNeedLogger(cats);
            try {
                if (needsLogger && !(st && st.index)) throw Object.assign(new Error("state"), { status: "logger" });
                const f = buildFilter(cats, (st && st.index) || { official: new Map(), review: new Map() });
                if (f.empty) { rows = []; total = 0; draw({}); timer = setTimeout(() => load(true), 8000); return; }
                const res = await kismet.devices(view, { page, length: PAGE, search: macSearch(search), sort, dir, regex: f.regex });
                if (stale()) return;
                const got = res.data || [];
                const kn = await known(got.map(r => r["kismet.device.base.macaddr"]));
                if (stale()) return;
                rows = sort === "last" && dir === "desc" ? got.slice().sort(newestThenSignal) : got;
                total = res.last_row || 0;
                draw(kn);
            } catch (e) {
                if (stale()) return;
                clear(list).append(head(), h("div", { class: "err" }, e.status === "logger" ? "The Archimet logger is not answering, so the LE and Review categories cannot be listed." : `Kismet did not return devices (${e.status || "no answer"}).`));
            }
            timer = setTimeout(() => load(true), document.hidden ? 20000 : 4000);
        }

        function draw(kn) {
            const st = current("state") || {};
            const idx = st.index || { official: new Map(), review: new Map() };
            const kStart = (current("status") || {})["kismet.system.timestamp.start_sec"] || 0;
            const tpl = template();
            const frag = document.createDocumentFragment();
            frag.append(head());
            for (const r of rows) {
                const mac = r["kismet.device.base.macaddr"];
                const cat = category({ phy: r["kismet.device.base.phyname"], type: r["kismet.device.base.type"] });
                const badges = badgesFor(mac, idx, kn[mac], kStart, { phy: r["kismet.device.base.phyname"], type: r["kismet.device.base.type"], name: r["kismet.device.base.name"], ssid: r.ssid });
                const marker = markerFor(cat, badges);
                const base = { mac, phy: r["kismet.device.base.phyname"], type: r["kismet.device.base.type"] };
                const id = identity({ ...base, name: r["kismet.device.base.name"], username: r["kismet.device.base.username"],
                    ssid: r.ssid, cloaked: r.cloaked, ssidlen: r.ssidlen, beacon_ts: r.beacon_ts, probe: r.probe });
                const bd = radioInfo({ ...base, freq: r["kismet.device.base.frequency"], channel: r["kismet.device.base.channel"],
                    advChannel: r.adv_channel, freqMap: r.freq_map });
                const bf = prefsGet().bandFormat;
                const bandText = radioText(bd, bf);
                const sig = r.signal;
                const cells = {
                    type: h("span", { class: "cell" }, cat.label),
                    // One compact indicator; the full readings are in the inspector.
                    band: h("span", { class: `cell band band-${bd.id}${bd.conflict ? " band-conflict" : ""}`, title: radioTitle(bd) }, bandText,
                        bd.differ ? h("span", { class: "band-differ", "aria-label": bd.differ.text }, " ≠") : null),
                    // Both reports when they disagree (Kismet's channel field ≠ the AP's beacon); full evidence in the inspector.
                    channel: h("span", { class: "cell num" + (bd.differ ? " band-differ" : ""), title: bd.differ ? bd.differ.why : bd.conflict ? "Reported channel; see the inspector for every reading" : "" },
                        bd.differ ? bd.differ.short : r["kismet.device.base.channel"] || "—"),
                    signal: h("span", { class: "cell num" }, sigBars(sig), sig ? `${sig}` : "—"),
                    manuf: h("span", { class: "cell" }, r["kismet.device.base.manuf"] || "—"),
                    crypt: h("span", { class: "cell" }, r["kismet.device.base.crypt"] || "—"),
                    packets: h("span", { class: "cell num" }, (r["kismet.device.base.packets.total"] || 0).toLocaleString()),
                    last: h("span", { class: "cell num", title: absTime(r["kismet.device.base.last_time"]) },
                        prefsGet().timestamps === "absolute" ? absTime(r["kismet.device.base.last_time"]).slice(11) : relTime(r["kismet.device.base.last_time"])),
                };
                const row = h("div", { class: `lrow m-${marker}`, role: "row", tabindex: "0", "aria-selected": selected === r["kismet.device.base.key"] ? "true" : "false" },
                    h("div", { class: "who" }, h("span", { class: "glyph", title: cat.label }, svg(ICON[cat.glyph])),
                        h("div", { class: "names" }, id.name
                                ? [h("span", { class: "name" }, id.name), h("span", { class: "mac" }, mac)]
                                : [h("span", { class: "name mono macname" }, mac), h("span", { class: "mac idlabel" + (id.hidden ? " hidden-ssid" : ""), title: id.reason }, id.label)],
                            h("span", { class: "sub mac", title: radioTitle(bd) }, bd.conflict ? h("span", { class: "band-conflict" }, bd.conflict.text) : bd.short,
                                ` · ch ${bd.differ ? bd.differ.short : r["kismet.device.base.channel"] || "—"} · ${sig ? sig + " dBm" : "—"} · ${relTime(r["kismet.device.base.last_time"])}`))),
                    ...cols().map(([id]) => cells[id]),
                    h("div", { class: "badges" }, ...badges.map(b => h("span", { class: `badge b-${b.id}`, title: b.title || "" }, b.text))));
                row.style.gridTemplateColumns = tpl;
                const pick = () => {
                    selected = r["kismet.device.base.key"];
                    list.querySelectorAll(".lrow").forEach(x => x.setAttribute("aria-selected", "false"));
                    row.setAttribute("aria-selected", "true");
                    history.replaceState(null, "", `#/devices/${selected}`);
                    openInspector(selected, mac);
                };
                row.addEventListener("click", pick);
                row.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); });
                frag.append(row);
            }
            clear(list).append(frag);
            if (!rows.length) list.append(emptyState());
            const from = total ? page * PAGE + 1 : 0, to = Math.min(total, (page + 1) * PAGE);
            meta.textContent = `${total.toLocaleString()} device${total === 1 ? "" : "s"}`;
            clear(pager).append(
                h("span", {}, total ? `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}` : "0"),
                h("button", { class: "btn", type: "button", disabled: page === 0, onclick: () => { page--; load(); } }, "‹ Prev"),
                h("button", { class: "btn", type: "button", disabled: to >= total, onclick: () => { page++; load(); } }, "Next ›"));
        }

        function emptyState() {
            if (search) return h("div", { class: "empty" }, h("div", { class: "h2" }, "No match"), h("p", {}, `Nothing in this view matches “${search}”.`));
            if (cats && cats.length === 0) return h("div", { class: "empty" }, h("div", { class: "h2" }, "Nothing selected"), h("p", {}, "Choose at least one category under Show."));
            if (cats && cats.every(id => (CATS.find(c => c.id === id) || {}).group !== "radio"))
                return h("div", { class: "empty" }, h("div", { class: "h2" }, "None of these in Kismet's list"),
                    h("p", {}, "These categories list matching devices in Kismet's device list for this run, whenever they were last heard. Everything ever logged as LE is in LE History; unresolved devices and their sightings are in Review."),
                    h("div", { style: { display: "flex", gap: "8px", justifyContent: "center" } }, h("a", { class: "btn", href: "#/history" }, "LE History"), h("a", { class: "btn", href: "#/review" }, "Review")));
            return h("div", { class: "empty" }, h("div", { class: "h2" }, "No devices"), h("p", {}, "Kismet has not reported any device in these categories."));
        }

        async function chooseColumns() {
            const c = { ...prefsGet().columns };
            const body = h("div", { class: "frame-body" },
                h("p", { class: "dim", style: { margin: 0 } }, "Saved in this browser."),
                ...COLS.map(([id, label]) => h("label", { class: "switch" }, h("input", { type: "checkbox", checked: c[id], onchange: (e) => { c[id] = e.target.checked; } }), label)));
            let bf = prefsGet().bandFormat;
            const fmt = h("div", { class: "seg", role: "group", "aria-label": "Radio column shows" },
                ...[["band", "Band"], ["channel", "Band · channel"], ["mhz", "Band · MHz"]].map(([v, l]) =>
                    h("button", { type: "button", "aria-pressed": String(bf === v), onclick: (e) => { bf = v; fmt.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } }, l)));
            body.append(h("div", { class: "dim", style: { marginTop: "6px" } }, "Radio column shows"), fmt);
            body.append(h("div", { style: { marginTop: "10px" } }, h("button", { class: "btn ghost", type: "button", onclick: () => {
                sort = "last"; dir = "desc"; resetDevicesSort(); page = 0; load();
                toast("Sorting reset", "Last heard, newest first; stronger signal breaks ties.");
            } }, "Reset sorting to Last heard")));
            const ok = await dialog("Columns", body, { actions: [["Cancel", false, "ghost"], ["Apply", true, "primary"]] });
            if (ok) { prefsSet({ columns: c, bandFormat: bf }); load(); }
        }

        const onResize = debounce(() => load(true), 250);     // re-fit columns on rotate / resize
        addEventListener("resize", onResize);
        q.addEventListener("input", debounce(() => { search = q.value.trim(); page = 0; load(); }, 300));
        q.addEventListener("keydown", (e) => { if (e.key === "Escape") { q.value = ""; search = ""; load(); } });
        let lastRev = "";
        const unsub = subscribe("state", (st) => {
            if (!st || st.rev === lastRev) return;
            lastRev = st.rev;
            if ((cats || []).some(id => CATS.find(c => c.id === id).group === "archimet")) load(true);
            if (!panel.hidden) drawPanel();
        });

        label();
        buildScopes().then(() => load());
        // Source names arrive with the sources poll; relabel the scopes when they do.
        const unsubSrc = subscribe("sources", () => {
            if (!scopes.some(s => /^Heard by [0-9A-F]{8}$/.test(s.label))) return;   // already named: no extra Kismet request
            buildScopes().then(() => { if (!panel.hidden) drawPanel(); });
        });
        if (args[0]) { selected = args[0]; openInspector(args[0]); }

        return () => { alive = false; clearTimeout(timer); unsub(); unsubSrc(); closeInspector();
            document.removeEventListener("click", outside, true); document.removeEventListener("keydown", escKey); removeEventListener("resize", onResize); };
    },
    update(args) { if (args[0]) openInspector(args[0]); else closeInspector(); },
});
