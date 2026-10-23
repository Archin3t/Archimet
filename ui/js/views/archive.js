// SPDX-License-Identifier: GPL-2.0-or-later
/* Archive: read-only view of everything Archimet has stored, across every capture run.
 * Devices shows only Kismet's current run; LE History and Review are the working lists; this is
 * the full record (AP / client logs, LE log, Review in all states, decisions, audit, sightings).
 * One table: its own columns, sortable. Several tables or All: one labelled schema (source, MAC,
 * name, first / last seen, summary); a MAC found in two sources stays two rows, because they are two
 * different facts. Search applies only to the selected sources. Nothing here writes. */

import { h, svg, clear, debounce, requestGate } from "../lib/util.js";
import { ICON } from "../ui/art.js";
import { archimet } from "../api/archimet.js";
import { route } from "../ui/shell.js";
import { openByMac } from "../ui/inspector.js";
import { gridColumns } from "../ui/resize.js";

const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;
// The logger's tables, so a single table stays selectable even if a request fails before the logger lists them.
const FALLBACK = { ap: "Access points", clients: "Wi-Fi clients", le: "LE log", review: "Review (all states)",
    decisions: "Review decisions", audit: "Operator audit", sightings: "Review sightings", overrides: "Operator marks" };
const phone = () => matchMedia("(max-width: 720px)").matches;
const COMBINED = { source_label: "Source", mac: "MAC", name: "Name / SSID", first_seen: "First seen", last_seen: "Last seen", summary: "Summary" };

route("archive", {
    title: "Archive", eyebrow: "everything stored · read-only",
    mount(main, args) {
        let alive = true, q = "", page = 0, sort = "", dir = "desc", tables = null;
        // The selected sources: from the URL (#/archive/ap or #/archive/ap,le or #/archive/all).
        let sel = new Set(String(args[0] || "ap").split(",").filter(Boolean));
        const PAGE = 50;
        const tabs = h("div", { class: "chips archive-sources", role: "group", "aria-label": "Search in" });
        const search = h("input", { class: "field", type: "search", placeholder: "Search the selected sources", autocomplete: "off", spellcheck: "false" });
        const meta = h("span", { class: "meta" });
        const body = h("div", { class: "page" });
        const pager = h("div", { class: "pager" });
        main.append(h("div", { class: "toolbar" }, h("span", { class: "eyebrow" }, "Search in"), tabs,
            h("label", { class: "search" }, svg(ICON.search), search), meta), body, pager);
        search.addEventListener("input", debounce(() => { q = search.value.trim(); page = 0; load(); }, 300));
        const gate = requestGate();
        const all = () => Object.keys(tables || FALLBACK);
        const isAll = () => sel.has("all") || (tables && all().every(k => sel.has(k)));
        const keys = () => (sel.has("all") ? all() : [...sel]);

        function setSel(next) {
            sel = next.size ? next : new Set(["ap"]);
            page = 0; sort = ""; dir = "desc";
            history.replaceState(null, "", `#/archive/${isAll() ? "all" : [...sel].join(",")}`);
            load();
        }

        function drawTabs() {
            const chip = (id, label, pressed, onclick, title) => h("button", { class: "chip", type: "button", "aria-pressed": String(pressed), title, onclick }, label);
            clear(tabs).append(
                chip("all", "All", isAll(), () => setSel(isAll() ? new Set(["ap"]) : new Set(["all"])), "Search every source at once"),
                ...Object.entries(tables || FALLBACK).map(([id, label]) => chip(id, label, !isAll() && sel.has(id), (e) => {
                    // Click: only this source. Ctrl / Cmd / Shift-click: add or remove it from the selection.
                    const multi = e.ctrlKey || e.metaKey || e.shiftKey;
                    const next = isAll() ? new Set() : new Set(sel);
                    if (!multi) return setSel(new Set([id]));
                    next.has(id) ? next.delete(id) : next.add(id);
                    setSel(next);
                }, "Click: only this source. Ctrl/Shift-click: add to the selection.")));
        }

        const cell = (v) => {
            const s = v == null ? "" : String(v);
            if (MAC.test(s)) return h("td", { class: "mono" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); openByMac(s); } }, s));
            return h("td", { class: s.length > 80 ? "wrap" : "", title: s.length > 80 ? s : "" }, s.length > 240 ? s.slice(0, 240) + "…" : s);
        };

        async function load() {
            const my = gate.next();
            clear(body).append(h("div", { class: "loading" }, "reading the archive"));
            try {
                const ks = keys();
                const combined = ks.length > 1;
                const res = combined
                    ? await archimet.archiveMulti({ tables: isAll() ? ["all"] : ks, q, page, length: PAGE })
                    : await archimet.archive({ table: ks[0], q, page, length: PAGE, sort, dir });
                if (!alive || !gate.current(my)) return;
                tables = res.tables;
                if (!combined) { sort = res.sort; dir = res.desc ? "desc" : "asc"; }
                drawTabs();
                // Combined: drop the internal key column, show the source label.
                const columns = combined ? res.columns.filter(c => c !== "source") : res.columns;
                const rows = combined ? res.rows.map(r => r.slice(1)) : res.rows;
                const colEls = columns.map(() => h("col"));
                const colgroup = h("colgroup", {}, ...colEls);
                const key = combined ? "archive-combined" : `archive-${ks[0]}`;
                const gcA = gridColumns(key, columns.map(c => ({ id: c, label: COMBINED[c] || c, w: /mac|_seen|time|at$|source/.test(c) ? 170 : 150, min: 60 })),
                    body, (w) => columns.forEach((c, i) => { colEls[i].style.width = `${w[c]}px`; }));
                const head = h("tr", {}, ...columns.map(c => h("th", { scope: "col", class: "hcell" }, gcA.grip(c),
                    combined
                        ? h("span", { title: c === "last_seen" ? "Newest first; ties by source, then MAC" : "" }, COMBINED[c] || c, c === "last_seen" ? " ↓" : "")
                        : h("button", { class: "linklike", type: "button", "aria-sort": c === sort ? (dir === "desc" ? "descending" : "ascending") : "none",
                            onclick: () => { if (sort === c) dir = dir === "desc" ? "asc" : "desc"; else { sort = c; dir = "desc"; } page = 0; load(); } },
                            c, c === sort ? (dir === "desc" ? " ↓" : " ↑") : ""))));
                const where = combined ? `${ks.length} sources` : res.label;
                // Phones: combined results as cards (source, identity, when, summary); a table scrolls sideways.
                const card = (r) => {
                    const v = Object.fromEntries(columns.map((c, i) => [c, r[i]]));
                    return h("div", { class: "arch-card" },
                        h("div", { class: "arch-top" }, h("span", { class: "badge" }, v.source_label), h("span", { class: "faint mono" }, v.last_seen || "")),
                        MAC.test(v.mac || "") ? h("a", { href: "#", class: "mono", onclick: (e) => { e.preventDefault(); openByMac(v.mac); } }, v.mac) : h("span", { class: "mono" }, v.mac || ""),
                        v.name ? h("div", { class: "name" }, v.name) : null,
                        h("div", { class: "faint arch-sum" }, v.summary || ""));
                };
                clear(body).append(rows.length && combined && phone()
                    ? h("div", { class: "arch-cards" }, ...rows.map(card))
                    : rows.length
                    ? h("div", { class: "table-wrap", title: phone() ? "Scroll sideways for more columns" : null }, h("table", { class: "table archive" }, colgroup, h("thead", {}, head), h("tbody", {}, ...rows.map(r => h("tr", {}, ...r.map(cell))))))
                    : h("div", { class: "empty" }, h("div", { class: "h2" }, q ? "No match" : "Empty"), h("p", {}, q ? `Nothing in ${where} matches “${q}”.` : `${where}: no rows yet.`)));
                meta.textContent = `${res.total.toLocaleString()} rows · ${where} · read-only`
                    + (combined ? " · " + Object.entries(res.counts).map(([k, n]) => `${tables[k]} ${n.toLocaleString()}`).join(", ") : "");
                const last = (page + 1) * PAGE >= res.total || (combined && (page + 2) * PAGE > res.max_rows);
                clear(pager).append(h("span", {}, `${res.total ? page * PAGE + 1 : 0}–${page * PAGE + rows.length} of ${res.total.toLocaleString()}`),
                    h("button", { class: "btn", type: "button", disabled: page === 0, onclick: () => { page--; load(); } }, "‹ Prev"),
                    h("button", { class: "btn", type: "button", disabled: last, onclick: () => { page++; load(); } }, "Next ›"),
                    combined && (page + 2) * PAGE > res.max_rows && res.total > res.max_rows
                        ? h("span", { class: "faint" }, `Combined results page to row ${res.max_rows.toLocaleString()}; narrow the search or pick one source.`) : null);
            } catch (e) {
                if (!alive || !gate.current(my)) return;
                clear(body).append(h("div", { class: "err" }, e.status === 404 ? "The Archive needs Archimet logger 5.2." : e.status === 400 ? (keys().length > 1 ? "This Pi's logger cannot search several tables at once (needs Archimet logger 5.3). Pick one table above." : "The Archive refused this request (unknown table, or paged too deep).") : `The Archimet logger did not answer (${e.status || "no answer"}).`));
            }
        }
        drawTabs();
        load();
        return () => { alive = false; };
    },
});
