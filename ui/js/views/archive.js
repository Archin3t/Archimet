/* Archive: read-only view of everything Archimet has stored, across every capture run.
 * Devices shows only Kismet's current run; LE History and Review are the working lists; this is
 * the full record (AP / client logs, LE log, Review in all states, decisions, audit, sightings).
 * Nothing here writes. */

import { h, svg, clear, debounce, requestGate } from "../lib/util.js";
import { ICON } from "../ui/art.js";
import { archimet } from "../api/archimet.js";
import { route } from "../ui/shell.js";
import { openByMac } from "../ui/inspector.js";
import { gridColumns } from "../ui/resize.js";

const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

route("archive", {
    title: "Archive", eyebrow: "everything stored · read-only",
    mount(main, args) {
        let alive = true, table = args[0] || "ap", q = "", page = 0, sort = "", dir = "desc", tables = null;
        const PAGE = 50;
        const tabs = h("div", { class: "seg", role: "group", "aria-label": "Table" });
        const search = h("input", { class: "field", type: "search", placeholder: "Search every column", autocomplete: "off", spellcheck: "false" });
        const meta = h("span", { class: "meta" });
        const body = h("div", { class: "page" });
        const pager = h("div", { class: "pager" });
        main.append(h("div", { class: "toolbar" }, tabs, h("label", { class: "search" }, svg(ICON.search), search), meta), body, pager);
        search.addEventListener("input", debounce(() => { q = search.value.trim(); page = 0; load(); }, 300));
        const gate = requestGate();

        function drawTabs() {
            clear(tabs).append(...Object.entries(tables || { [table]: table }).map(([id, label]) =>
                h("button", { type: "button", "aria-pressed": String(id === table), onclick: () => {
                    table = id; page = 0; sort = ""; dir = "desc"; history.replaceState(null, "", `#/archive/${id}`); load(); } }, label)));
        }

        async function load() {
            const my = gate.next();
            clear(body).append(h("div", { class: "loading" }, "reading the archive"));
            try {
                const res = await archimet.archive({ table, q, page, length: PAGE, sort, dir });
                if (!alive || !gate.current(my)) return;
                tables = res.tables; sort = res.sort; dir = res.desc ? "desc" : "asc";
                drawTabs();
                // Column widths per table, resizable like every other table (saved per browser).
                const colEls = res.columns.map(() => h("col"));
                const colgroup = h("colgroup", {}, ...colEls);
                const gcA = gridColumns(`archive-${table}`, res.columns.map(c => ({ id: c, label: c, w: /mac|_seen|time|at$/.test(c) ? 170 : 150, min: 60 })),
                    body, (w) => res.columns.forEach((c, i) => { colEls[i].style.width = `${w[c]}px`; }));
                const head = h("tr", {}, ...res.columns.map(c => h("th", { scope: "col", class: "hcell" }, gcA.grip(c),
                    h("button", { class: "linklike", type: "button", "aria-sort": c === sort ? (dir === "desc" ? "descending" : "ascending") : "none",
                        onclick: () => { if (sort === c) dir = dir === "desc" ? "asc" : "desc"; else { sort = c; dir = "desc"; } page = 0; load(); } },
                        c, c === sort ? (dir === "desc" ? " ↓" : " ↑") : ""))));
                const cell = (v) => {
                    const s = v == null ? "" : String(v);
                    if (MAC.test(s)) return h("td", { class: "mono" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); openByMac(s); } }, s));
                    return h("td", { class: s.length > 80 ? "wrap" : "", title: s.length > 80 ? s : "" }, s.length > 240 ? s.slice(0, 240) + "…" : s);
                };
                clear(body).append(res.rows.length
                    ? h("div", { class: "table-wrap" }, h("table", { class: "table archive" }, colgroup, h("thead", {}, head), h("tbody", {}, ...res.rows.map(r => h("tr", {}, ...r.map(cell))))))
                    : h("div", { class: "empty" }, h("div", { class: "h2" }, q ? "No match" : "Empty"), h("p", {}, q ? `Nothing in ${res.label} matches “${q}”.` : `${res.label} has no rows yet.`)));
                meta.textContent = `${res.total.toLocaleString()} rows · ${res.label} · read-only`;
                clear(pager).append(h("span", {}, `${res.total ? page * PAGE + 1 : 0}–${page * PAGE + res.rows.length} of ${res.total.toLocaleString()}`),
                    h("button", { class: "btn", type: "button", disabled: page === 0, onclick: () => { page--; load(); } }, "‹ Prev"),
                    h("button", { class: "btn", type: "button", disabled: (page + 1) * PAGE >= res.total, onclick: () => { page++; load(); } }, "Next ›"));
            } catch (e) {
                if (!alive || !gate.current(my)) return;
                clear(body).append(h("div", { class: "err" }, e.status === 404 ? "The Archive needs Archimet logger 5.2." : `The Archimet logger did not answer (${e.status || "no answer"}).`));
            }
        }
        drawTabs();
        load();
        return () => { alive = false; };
    },
});
