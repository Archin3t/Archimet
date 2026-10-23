// SPDX-License-Identifier: GPL-2.0-or-later
/* LE History (the LE log, across reboots) and Review (unconfirmed devices). */

import { h, svg, clear, macHex, requestGate } from "../lib/util.js";
import { ICON } from "../ui/art.js";
import { kismet } from "../api/kismet.js";
import { config } from "../api/archimet.js";
import { subscribe, current } from "../lib/hub.js";
import { openByMac, close as closeInspector } from "../ui/inspector.js";
import { reviewSummary } from "../lib/classify.js";
import { TAG, subtypesOf, vendorOf, reasonParts } from "../lib/tags.js";
import { heardStatus, lastObserved, observedKey, observedText, exactLocal, newestByMac, HEARD_WINDOW } from "../lib/heard.js";
import { route, askNote, toast } from "../ui/shell.js";
import { gridColumns, paneGrip } from "../ui/resize.js";
import { archimet } from "../api/archimet.js";
import { refresh } from "../lib/hub.js";

const KIND = { hardware: "Vendor match", operator: "Operator mark", learned: "Associated" };
const EVID = { hardware: "vendor", operator: "operator", learned: "learned" };
const subtypeText = (subs) => subs.length ? subs.map(s => TAG[s].label).join(" · ") : "not identified";
const REFRESH_MS = 15000;

function matches(r, q) {
    if (!q) return true;
    const s = q.toLowerCase(), hx = macHex(q);
    if (hx.length >= 2 && /^[0-9a-f:\-. ]+$/i.test(q) && macHex(r.mac).includes(hx)) return true;
    return [r.name, r.manufacturer, r.category, r.match_reason, r.why_might_be, r.why_might_not, r.type]
        .some(v => String(v || "").toLowerCase().includes(s));
}

/* Kismet's last_time for these MACs plus Kismet's own clock (cached 15 s).
 * -> { ok, kismetNow, last: Map, skew } ; ok=false when Kismet did not answer. */
let cache = { at: 0, key: "", val: null };
const lookupGate = requestGate();   // History and Review share the cache: an older answer must not replace a newer one
async function lookup(macs) {
    const key = macs.slice().sort().join(",");
    if (cache.val && key === cache.key && Date.now() - cache.at < REFRESH_MS) return withAge(cache.val, cache.at);
    const my = lookupGate.next();
    let val;
    try {
        const [rows, st] = await Promise.all([
            macs.length ? kismet.multimac(macs, ["kismet.device.base.macaddr", "kismet.device.base.last_time"]) : [],
            kismet.status()]);
        const now = Number(st["kismet.system.timestamp.sec"]) || null;
        val = { ok: !!now, kismetNow: now, kismetStart: Number(st["kismet.system.timestamp.start_sec"]) || 0, last: newestByMac(rows),
            skew: now ? Math.round(now - Date.now() / 1000) : 0 };
    } catch (e) {
        val = { ok: false, kismetNow: null, last: new Map(), skew: 0, error: e.status || "no answer" };
    }
    if (lookupGate.current(my)) cache = { at: Date.now(), key, val };
    return val;
}
/* Kismet's clock advanced by the time since it was read, so a badge expires on schedule. */
function withAge(v, at) { return v.ok ? { ...v, kismetNow: v.kismetNow + Math.round((Date.now() - at) / 1000) } : v; }

function lookupBanner(lk) {
    if (!lk) return null;
    if (!lk.ok) return h("div", { class: "warnline" }, `Kismet did not answer (${lk.error || "no clock"}), so "heard recently" is unknown for every device. Rows are not treated as history.`);
    if (Math.abs(lk.skew) > 120) return h("div", { class: "warnline" }, `This device's clock differs from Kismet's by ${Math.round(Math.abs(lk.skew) / 60)} min. Ages use Kismet's clock; times are shown in this device's time zone.`);
    return null;
}

const statusBadge = (s) => s.state === "recent" ? h("span", { class: "badge b-ok", title: s.why }, s.label)
    : s.state === "pending" ? h("span", { class: "faint" }, s.label)
    : s.state === "unknown" ? h("span", { class: "badge b-warn", title: s.why }, "Unknown")
    : h("span", { class: "faint", title: s.why }, s.label);

function observedCell(obs) {
    return h("span", { class: "cell num full" + (obs.precise ? "" : " faint"), title: obs.precise ? `${exactLocal(obs.epoch)} · from ${obs.source}` : "Only the date was recorded for this observation (before Archimet kept times of day). Open the row for details." }, observedText(obs));
}

function searchBox(onInput) {
    const q = h("input", { class: "field", type: "search", placeholder: "Search name, MAC (any format), reason", autocomplete: "off", spellcheck: "false" });
    q.addEventListener("input", () => onInput(q.value.trim()));
    return h("label", { class: "search" }, svg(ICON.search), q);
}

route("history", {
    title: "LE History", eyebrow: "law enforcement log",
    mount(main) {
        let q = "", lk = null, alive = true, last = null, when = "all", timer = 0;
        const classes = new Set(["hardware", "operator", "learned"]);
        let subFilter = "all";
        const meta = h("span", { class: "meta" });
        const banner = h("div", {});
        const list = h("div", { class: "list" });
        /* LE-log rows only. Unresolved devices are never mixed in here; they are on Review. */
        const whenSeg = h("div", { class: "seg", role: "group", "aria-label": "Heard recently" },
            ...[["all", "All logged"], ["recent", `Heard in the last ${HEARD_WINDOW / 60} min`], ["not", "Not heard recently"]].map(([v, l]) =>
                h("button", { type: "button", "aria-pressed": String(v === when), onclick: (e) => {
                    when = v; whenSeg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); } }, l)));
        const classBox = h("div", { class: "chips", role: "group", "aria-label": "Evidence" },
            ...[["hardware", "Vendor match"], ["operator", "Operator mark"], ["learned", "Associated"]].map(([v, l]) =>
                h("button", { class: "chip", type: "button", "aria-pressed": "true", title: TAG[EVID[v]].help, onclick: (e) => {
                    classes.has(v) ? classes.delete(v) : classes.add(v); e.currentTarget.setAttribute("aria-pressed", String(classes.has(v))); draw(); } }, l)));
        const subSeg = h("div", { class: "seg", role: "group", "aria-label": "Equipment" },
            ...[["all", "Any equipment"], ["known", "Model identified"], ["unknown", "Not identified"]].map(([v, l]) =>
                h("button", { type: "button", "aria-pressed": String(v === subFilter), onclick: (e) => {
                    subFilter = v; subSeg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); } }, l)));
        // Phones: the three filter groups fold behind one button (always shown on wider screens).
        const filters = h("div", { class: "filters", id: "le-filters" }, whenSeg, classBox, subSeg);
        const filtBtn = h("button", { class: "btn filters-btn", type: "button", "aria-expanded": "false", "aria-controls": "le-filters",
            onclick: () => { const open = filters.classList.toggle("open"); filtBtn.setAttribute("aria-expanded", String(open)); } }, "Filters");
        main.append(h("div", { class: "toolbar" }, searchBox((v) => { q = v; draw(); }), filtBtn, filters, meta),
            h("div", { class: "page" }, banner, list));
        const LECOLS = [{ id: "device", label: "Device", w: 240, min: 160, flex: 2 }, { id: "evidence", label: "Evidence", w: 140, min: 90 },
            { id: "subtype", label: "Equipment", w: 130, min: 80 }, { id: "reason", label: "Reason", w: 260, min: 120, flex: 2 },
            { id: "heard", label: "Heard", w: 170, min: 110 }, { id: "observed", label: "Last observed", w: 190, min: 170 }];
        const gc = gridColumns("le-history", LECOLS, list);
        const tpl = "var(--cols)";
        const classOf = (r) => r.kind === "operator" ? "operator" : r.kind === "learned" ? "learned" : "hardware";

        function draw() {
            const st = last;
            if (!st) { clear(list).append(h("div", { class: "loading" }, "reading the LE log")); return; }
            if (st.error) { clear(list).append(h("div", { class: "err" }, "LE History comes from the Archimet logger, which is not answering.")); return; }
            clear(banner).append(...[lookupBanner(lk)].filter(Boolean));
            const all = [...st.index.official.values()].map(r => ({ r, s: heardStatus(r.mac, lk), o: lastObserved(r, lk), subs: subtypesOf(r) }));
            const rows = all.filter(x => matches(x.r, q) && classes.has(classOf(x.r))
                    && (subFilter === "all" || (subFilter === "known") === x.subs.length > 0)
                    && (when === "all" || (when === "recent" ? x.s.state === "recent" : x.s.state === "earlier" || x.s.state === "absent")))
                .sort((a, b) => (observedKey(b.o) - observedKey(a.o)) || String(b.r.first_seen).localeCompare(String(a.r.first_seen)));
            const hc = (id, text, title) => h("span", { class: "hcell", title: title || null }, h("span", {}, text), gc.grip(id));
            const head = h("div", { class: "lhead" }, hc("device", "Device"), hc("evidence", "Evidence"),
                hc("subtype", "Equipment", "What the device is, only when it broadcast a model name that identifies it. The matching rule's category (e.g. “Body cam / Taser” for a vendor) describes the rule, not this device; it is in the row's tooltip."),
                hc("reason", "Reason"),
                hc("heard", "Heard", `By Kismet's clock: heard within the last ${HEARD_WINDOW / 60} minutes, earlier in this Kismet run, not at all, or unknown.`),
                hc("observed", "Last observed ↓", "Most recent real observation, newest first. Local time; open a row for the time zone and source."));
            head.style.gridTemplateColumns = tpl;
            const frag = document.createDocumentFragment();
            frag.append(head);
            for (const { r, s, o, subs } of rows) {
                const vendor = r.kind === "hardware" ? vendorOf(r) : "";
                const row = h("div", { class: "lrow m-confirmed", tabindex: "0" },
                    h("div", { class: "who" }, h("span", { class: "glyph" }, svg(ICON[r.radio === "Bluetooth" ? "bt" : /AP/.test(r.type || "") ? "ap" : "client"])),
                        h("div", { class: "names" }, r.name ? [h("span", { class: "name" }, r.name), h("span", { class: "mac" }, r.mac)] : [h("span", { class: "name mono macname" }, r.mac), h("span", { class: "mac" }, r.manufacturer || "")],
                            r.name ? h("span", { class: "sub mac" }, r.manufacturer || "") : null)),        // equipment is a chip below on phones
                    // Phones: heard status and last observation on the right; evidence as chips below.
                    h("div", { class: "m-meta" }, h("span", { class: "m-when" }, statusBadge(s)), h("span", { class: "m-sig" }, observedText(o))),
                    h("div", { class: "badges m-only" },
                        h("span", { class: `badge b-${EVID[r.kind]}`, title: TAG[EVID[r.kind]].help }, vendor ? `Vendor match: ${vendor}` : KIND[r.kind]),
                        ...(subs.length ? subs.map(x => h("span", { class: `badge b-${x}`, title: TAG[x].help }, TAG[x].label))
                            : [h("span", { class: "badge faint", title: "No model name observed; the vendor prefix names the maker only." }, "equipment not identified")])),
                    h("span", { class: "cell" }, h("span", { class: `badge b-${EVID[r.kind]}`, title: TAG[EVID[r.kind]].help }, vendor ? `Vendor match: ${vendor}` : KIND[r.kind])),
                    h("span", { class: "cell" + (subs.length ? "" : " faint"), title: `Rule category: ${r.category || "—"} (the rule's category, not the device's type).` },
                        subs.length ? subs.map(x => h("span", { class: `badge b-${x}`, title: TAG[x].help }, TAG[x].label)) : "not identified"),
                    (() => { const rp = reasonParts(r.match_reason);
                        return h("span", { class: "cell", title: rp.ruleCategory ? `${rp.text}\nRule category: ${rp.ruleCategory} (the rule's category, not this device's type)` : rp.text }, rp.text); })(),
                    h("span", { class: "cell" }, statusBadge(s)),
                    observedCell(o));
                row.style.gridTemplateColumns = tpl;
                row.addEventListener("click", () => openByMac(r.mac));
                row.addEventListener("keydown", (e) => { if (e.key === "Enter") openByMac(r.mac); });
                frag.append(row);
            }
            clear(list).append(frag);
            if (!rows.length) list.append(h("div", { class: "empty" }, h("div", { class: "h2" }, q ? "No match" : "No rows"),
                h("p", {}, q ? `Nothing in the LE log matches “${q}”.` : st.index.official.size
                    ? (when !== "all" && !(lk && lk.ok) ? "Heard status is unknown while Kismet is not answering." : "No logged LE device matches these filters.")
                    : "Devices appear here once a vendor match, an association with an LE-log device or an operator mark puts them in the LE log.")));
            const c = { hardware: 0, operator: 0, learned: 0 };
            for (const r of st.index.official.values()) c[r.kind]++;
            const recent = all.filter(x => x.s.state === "recent").length;
            const unknownSub = all.filter(x => !x.subs.length).length;
            meta.textContent = `${st.index.official.size} in the LE log · ${c.hardware} vendor match · ${c.operator} operator mark · ${c.learned} associated · ${unknownSub} equipment not identified · `
                + (lk && lk.ok ? `${recent} heard in the last ${HEARD_WINDOW / 60} min` : "heard status unknown");
        }

        let ticking = false;
        async function tick() {
            if (ticking) return;
            ticking = true;
            clearTimeout(timer);
            const st = current("state");
            try { if (st && st.index) lk = await lookup([...st.index.official.keys()]); } finally { ticking = false; }
            if (alive) { draw(); timer = setTimeout(tick, REFRESH_MS); }
        }
        const unsub = subscribe("state", (st, err) => {
            last = err ? { error: err } : st;
            if (alive) draw();
            if (!lk && st && st.index) tick();      // first lookup as soon as the log arrives
        });
        draw();
        tick();
        return () => { alive = false; clearTimeout(timer); unsub(); closeInspector(); };
    },
});

route("review", {
    title: "Review", eyebrow: "unconfirmed",
    mount(main, args) {
        let q = "", sel = args[0] ? args[0].toUpperCase() : "", alive = true, last = null, lk = null, timer = 0;
        const meta = h("span", { class: "meta" });
        const banner = h("div", {});
        const listPane = h("div", { class: "pane" });
        const detail = h("div", { class: "pane" });
        const split = h("div", { class: "split" });
        split.append(listPane, paneGrip("review-list", split, "--split-left", { label: "Resize the Review list", def: 420, min: 300, max: 900 }), detail);
        main.append(h("div", { class: "toolbar" }, searchBox((v) => { q = v; draw(); }), meta), h("div", { class: "page" }, banner, split));

        function draw() {
            const st = last;
            if (!st) { clear(listPane).append(h("div", { class: "loading" }, "reading Review")); return; }
            if (st.error) { clear(listPane).append(h("div", { class: "err" }, "Review comes from the Archimet logger, which is not answering.")); return; }
            clear(banner).append(...[lookupBanner(lk)].filter(Boolean));
            const stateOf = (r) => (r.resolution && r.resolution.state) || "active";
            // Live screen: only Review rows heard in this Kismet capture run. The rest (and dismissed
            // rows) are in the Archive. If Kismet's run cannot be read, nothing is hidden (the banner says why).
            const inRun = (r) => !(lk && lk.ok) || lk.last.has(r.mac) || r.mac === sel;
            const allRows = [...st.index.review.values()].filter(r => matches(r, q));
            const notInRun = allRows.filter(r => !inRun(r)).length;
            const rows = allRows.filter(inRun)
                .map(r => ({ r, s: heardStatus(r.mac, lk), o: lastObserved(r, lk) }))
                .sort((a, b) => ((stateOf(a.r) === "active" ? 0 : 1) - (stateOf(b.r) === "active" ? 0 : 1))
                    || (observedKey(b.o) - observedKey(a.o)) || String(b.r.first_seen).localeCompare(String(a.r.first_seen)));
            const dismissed = ((st.review_dismissed) || []).filter(r => matches(r, q));
            const frag = document.createDocumentFragment();
            if (notInRun) frag.append(h("div", { class: "faint", style: { padding: "8px 12px", fontSize: "12.5px" } },
                `${notInRun} Review row${notInRun === 1 ? " was" : "s were"} not heard in this capture run: `,
                h("a", { href: "#/archive/review" }, "open them in the Archive"), "."));
            // Equipment questions: LE-log rows whose equipment no broadcast model name identifies. Listed
            // here for follow-up; they stay in the LE log; nothing is stored twice.
            const questions = [...st.index.official.values()].filter(r => !subtypesOf(r).length && matches(r, q));
            if (questions.length) frag.append(h("details", { class: "subtype-q" },
                h("summary", {}, `Equipment questions · ${questions.length} LE-log device${questions.length === 1 ? "" : "s"} not identified`),
                h("p", { class: "faint", style: { margin: "6px 0 8px", fontSize: "12.5px" } }, "They are in the LE log because of the evidence shown (mostly a vendor match). What they are (body cam, Taser, router…) and who uses them is not established: a maker's MAC prefix names the maker only. A model name in their own broadcasts would identify the equipment; an operator's note records a judgement."),
                ...questions.map(r => h("div", { class: "l2", style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", padding: "4px 0" } },
                    h("span", { class: "badge b-confirmed" }, "LE log"),
                    h("a", { href: "#", class: "mono", onclick: (e) => { e.preventDefault(); openByMac(r.mac); } }, r.name || r.mac),
                    h("span", { class: "faint" }, `${r.kind === "hardware" ? "Vendor match: " + vendorOf(r) : KIND[r.kind]} · rule category “${r.category || "—"}” · equipment not identified`)))));
            let lowGroup = null;
            for (const { r, s, o } of rows) {
                if (stateOf(r) !== "active" && !lowGroup) {
                    const nLow = rows.filter(x => stateOf(x.r) !== "active").length;
                    lowGroup = h("details", { class: "low-group", open: rows.some(x => x.r.mac === sel && stateOf(x.r) !== "active") },
                        h("summary", {}, `Low priority · ${nLow}`, h("span", { class: "faint" }, ` · ${(last && last.review_policy) || "review policy"}: weak or stale signals, no notices; reopened automatically by new evidence`)));
                    frag.append(lowGroup);
                }
                const row = h("div", { class: `card-row m-${r.watch ? "watch" : "review"}`, tabindex: "0", "aria-selected": r.mac === sel ? "true" : "false" },
                    h("div", { class: "l1" }, h("span", { class: "name" + (r.name ? "" : " mono macname") }, r.name || r.mac),
                        h("span", { class: "badges" }, r.watch ? h("span", { class: "badge b-watch" }, "Watch") : null,
                            s.state === "recent" || s.state === "unknown" ? statusBadge(s) : null)),
                    h("div", { class: "l2" }, h("span", {}, r.mac), h("span", {}, r.manufacturer || ""),
                        h("span", { title: o.precise ? exactLocal(o.epoch) : "date only" }, `last ${observedText(o)}`), h("span", {}, `${r.sighting_count || 0} sightings`)),
                    h("div", { class: "l3" }, reviewSummary(r)));
                const pick = () => { sel = r.mac; history.replaceState(null, "", `#/review/${r.mac}`); split.classList.add("detail"); draw(); };
                row.addEventListener("click", pick);
                row.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); });
                (lowGroup || frag).append(row);
            }
            if (dismissed.length) frag.append(h("details", { class: "low-group" },
                h("summary", {}, `Dismissed · ${dismissed.length}`, h("span", { class: "faint" }, " · out of the Review list; reopened automatically by new evidence")),
                ...dismissed.map(r => h("div", { class: "card-row", style: { cursor: "default" } },
                    h("div", { class: "l1" }, h("span", { class: "name" + (r.name ? "" : " mono macname") }, r.name || r.mac),
                        h("span", { class: "badges" }, h("span", { class: "badge", title: r.resolution.why }, r.resolution.locked ? "dismissed by operator" : `dismissed · ${r.resolution.rule}`))),
                    h("div", { class: "l2" }, h("span", {}, r.mac), h("span", {}, r.manufacturer || "")),
                    h("div", { class: "l3" }, r.resolution.why || ""),
                    h("div", {}, h("button", { class: "btn", type: "button", disabled: config().readonly, onclick: () => decide(r, "keep") }, "Reopen…"))))));
            clear(listPane).append(frag);
            if (!rows.length) listPane.append(h("div", { class: "empty" }, h("div", { class: "h2" }, q ? "No match" : notInRun ? "None heard in this capture run" : "Nothing to review"), h("p", {}, q ? "" : notInRun ? "Review rows appear here when Kismet hears them again; older ones are in the Archive." : "Fleet-vendor MACs, model or agency names, probes and unconfirmed connections appear here.")));
            const recent = [...st.index.review.keys()].filter(m => heardStatus(m, lk).state === "recent").length;
            const nActive = [...st.index.review.values()].filter(r => stateOf(r) === "active").length;
            meta.textContent = `${nActive} need review · ${st.index.review.size - nActive} low priority · ${(st.review_dismissed || []).length} dismissed · ${[...st.index.review.values()].filter(r => r.watch).length} watched · `
                + (lk && lk.ok ? `${recent} heard in the last ${HEARD_WINDOW / 60} min` : "heard status unknown");
            drawDetail(st.index.review.get(sel));
        }

        function drawDetail(r) {
            clear(detail);
            if (!r) { detail.append(h("div", { class: "empty" }, h("div", { class: "h2" }, "Select a device"), h("p", {}, "Its evidence, notes and sighting history open here."))); return; }
            const ro = config().readonly;
            const s = heardStatus(r.mac, lk), o = lastObserved(r, lk);
            const tl = h("div", { class: "timeline" });
            for (const x of r.sightings || []) {
                const d = x.detail || {};
                const assoc = Object.entries(d.assoc || {}).map(([b, ev]) => `${b} (${ev})`).join(", ");
                const e = h("div", { class: "ev" }, h("span", { class: "t" }, `${x.start} → ${x.end}`), `${x.polls} polls${d.type ? " · " + d.type : ""}${assoc ? " · client records: " + assoc : ""}${d.assoc_clients ? " · " + d.assoc_clients + " clients" : ""}`);
                e.style.setProperty("--c", "var(--c-review)");
                tl.append(e);
            }
            for (const a of (current("state") || {}).audit || []) if (a.mac === r.mac) {
                const e = h("div", { class: "ev" }, h("span", { class: "t" }, a.at), `${a.action} (${a.actor})`);
                e.style.setProperty("--c", "var(--c-watch)");
                tl.append(e);
            }
            if (!tl.childNodes.length) tl.append(h("div", { class: "faint" }, "No sightings recorded since re-sighting history started."));
            detail.append(h("div", { class: "page-pad", style: { display: "grid", gap: "16px", maxWidth: "820px" } },
                h("div", {}, h("button", { class: "btn ghost", type: "button", style: { marginBottom: "10px" }, onclick: () => { split.classList.remove("detail"); sel = ""; history.replaceState(null, "", "#/review"); draw(); } }, "‹ All review"),
                    h("div", { class: "eyebrow" }, r.radio + " · " + (r.type || "")), h("h2", { class: "h1" }, r.name || "unnamed"),
                    h("div", { class: "mono dim", style: { marginTop: "4px" } }, r.mac, "  ·  ", r.manufacturer || "")),
                h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
                    h("span", { class: "badge b-review" }, r.resolution && r.resolution.state === "deprioritized" ? "Review · low priority" : "Review"), r.watch ? h("span", { class: "badge b-watch" }, "Watch") : null, statusBadge(s)),
                decisionFrame(r),
                h("div", { class: "frame" }, h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, "why it might be")), h("div", { class: "frame-body" }, r.why_might_be || "—")),
                h("div", { class: "frame" }, h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, "why it might not be")), h("div", { class: "frame-body dim" }, r.why_might_not || "—")),
                h("div", { class: "frame" }, h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, `sighting timeline · ${r.sighting_count || 0} sessions`)), h("div", { class: "frame-body" }, tl)),
                h("div", { class: "kv" },
                    h("dt", {}, "Last observed"), h("dd", {}, observedText(o), o.precise ? h("div", { class: "faint mono", style: { fontSize: "12px" } }, `${exactLocal(o.epoch)} · from ${o.source}`) : null),
                    h("dt", {}, "Heard"), h("dd", {}, `${s.label} · ${s.why}`),
                    h("dt", {}, "First logged"), h("dd", {}, r.first_seen), h("dt", {}, "Last logged (date)"), h("dd", {}, r.last_seen), h("dt", {}, "Source"), h("dd", {}, r.source)),
                h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
                    h("button", { class: "btn", type: "button", onclick: () => openByMac(r.mac) }, "Open in inspector"),
                    h("button", { class: "btn primary", type: "button", disabled: ro, onclick: () => mark(r) }, "Mark as LE…"),
                    ...decisionButtons(r, ro),
                    ro ? h("span", { class: "readonly-note" }, "read-only preview") : null)));
        }

        /* What the automatic policy (or an operator) decided, and why. */
        function decisionFrame(r) {
            const res = r.resolution || { state: "active" };
            const watched = r.watch || (r.signals || []).some(s => s.kind === "operator-unmarked");
            const rowsKv = res.rule ? [
                ["What was observed", res.observed || "—"],
                ["Why Archimet decided", res.why || "—"],
                ["What remains unknown", res.unknown || "—"],
                ["Decision", `${res.state}${res.locked ? " · by an operator (the automatic policy will not change it)" : ""} · ${res.rule} · ${res.policy || ""}${res.decided_at ? " · " + res.decided_at : ""}`],
            ] : [["Decision", watched ? "None: watched or unmarked by an operator, so the automatic policy does not decide it." : "Active: not yet evaluated, or no rule applies."]];
            return h("div", { class: "frame" }, h("div", { class: "frame-head" }, h("span", { class: "eyebrow" }, `review decision · ${res.state}`)),
                h("div", { class: "frame-body" }, h("dl", { class: "kv" }, ...rowsKv.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))));
        }

        function decisionButtons(r, ro) {
            const res = r.resolution || { state: "active" };
            const out = [];
            if (res.state !== "active" || !res.locked) out.push(h("button", { class: "btn", type: "button", disabled: ro, onclick: () => decide(r, "keep") }, "Keep active…"));
            if (res.state !== "dismissed") out.push(h("button", { class: "btn", type: "button", disabled: ro, onclick: () => decide(r, "dismiss") }, "Dismiss…"));
            if (res.locked) out.push(h("button", { class: "btn ghost", type: "button", disabled: ro, onclick: () => decide(r, "release") }, "Hand back to the policy"));
            return out;
        }

        async function decide(r, action) {
            let note = "";
            if (action !== "release") {
                note = await askNote(action === "dismiss" ? "Dismiss from Review" : "Keep in Review",
                    action === "dismiss" ? `Takes ${r.name || r.mac} out of the Review list. The automatic policy will not undo this; you can reopen it from the Dismissed group.`
                        : `Keeps ${r.name || r.mac} in the active Review list. The automatic policy will not lower or dismiss it until you hand it back.`,
                    { placeholder: "Why?" });
                if (note == null) return;
            }
            try { await archimet.resolveReview(r.mac, action, note); toast(action === "dismiss" ? "Dismissed" : action === "keep" ? "Kept in Review" : "Handed back to the policy", r.mac); refresh("state"); }
            catch (e) { toast("Not changed", (e.body && e.body.error) || `HTTP ${e.status}`, { color: "var(--bad)" }); }
        }

        async function mark(r) {
            const note = await askNote("Mark as LE", `Writes an Operator row for ${r.name || ""} ${r.mac} to the LE log with your note, the time and your address.`, { placeholder: "What did you see?" });
            if (note == null) return;
            try { await archimet.mark(r.mac, note); toast("Marked as LE", r.mac); refresh("state"); }
            catch (e) { toast("Not marked", (e.body && e.body.error) || `HTTP ${e.status}`, { color: "var(--bad)" }); }
        }

        let ticking = false;
        async function tick() {
            if (ticking) return;
            ticking = true;
            clearTimeout(timer);
            const st = current("state");
            try { if (st && st.index) lk = await lookup([...st.index.review.keys()]); } finally { ticking = false; }
            if (alive) { draw(); timer = setTimeout(tick, REFRESH_MS); }
        }
        if (sel) split.classList.add("detail");
        const unsub = subscribe("state", (st, err) => {
            last = err ? { error: err } : st;
            if (alive) draw();
            if (!lk && st && st.index) tick();
        });
        draw();
        tick();
        return () => { alive = false; clearTimeout(timer); unsub(); closeInspector(); };
    },
});
