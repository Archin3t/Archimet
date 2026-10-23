// node tests/test_resize.mjs — resizable columns / panes (ui/js/ui/resize.js) and their persistence,
// with a minimal DOM shim. Regression for two defects found on 2026-10-23: widths were never saved
// (the prefs merge dropped new layout keys) and dragging a flexible column only moved its invisible minimum.

let failed = 0;
const t = (name, cond) => { if (!cond) { failed++; console.error("FAIL", name); } };

// ---- minimal DOM
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
class El {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.kids = []; this.parentElement = null; this.listeners = {}; this.rect = { width: 0 };
        const props = {}; this.style = { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: (k) => props[k] ?? "" }; this.className = ""; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    append(...k) { for (const c of k) { this.kids.push(c); if (c instanceof El) c.parentElement = this; } }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
    fire(type, ev = {}) { for (const fn of [...(this.listeners[type] || [])]) fn({ preventDefault() {}, stopPropagation() {}, button: 0, pointerId: 1, ...ev }); }
    getBoundingClientRect() { return this.rect; }
    setPointerCapture() {}
}
globalThis.Node = El;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (s) => String(s), body: { classList: { add() {}, remove() {} } } };

const { gridColumns, paneGrip } = await import("../ui/js/ui/resize.js");
const { prefsGet } = await import("../ui/js/lib/store.js");

const cols = [{ id: "device", label: "Device", w: 160, min: 140, flex: 2 }, { id: "heard", label: "Heard", w: 170, min: 120 }];
const box = new El("div");
const gc = gridColumns("t1", cols, box);
t("default template keeps the flexible column flexible", box.style.getPropertyValue("--cols") === "minmax(160px, 2fr) 170px");

// Drag the flexible column: starts from its RENDERED width (486), not its 160 px minimum.
const head = new El("div"); head.rect = { width: 486 };
const g = gc.grip("device"); head.append(g); g.fire("focus");
t("grip reports the rendered width of a flexible column", g.getAttribute("aria-valuenow") === "486");
g.fire("pointerdown", { clientX: 1000 }); g.fire("pointermove", { clientX: 900 }); g.fire("pointerup");
t("drag narrows a flexible column to exactly what the user sees", box.style.getPropertyValue("--cols") === "386px 170px");
t("width saved per browser (prefs.layout)", prefsGet().layout.t1 && prefsGet().layout.t1.device === 386);
t("saved to localStorage", JSON.parse(store.get("archimet.prefs.v2")).layout.t1.device === 386);

// Keyboard on a fixed column, minimum enforced.
const g2 = gc.grip("heard");
for (let i = 0; i < 10; i++) g2.fire("keydown", { key: "ArrowLeft" });
t("keyboard resize stops at the minimum width", box.style.getPropertyValue("--cols") === "386px 120px" && prefsGet().layout.t1.heard === 120);

// A reload: a new gridColumns reads the saved widths (store.load keeps the open layout map).
const box2 = new El("div");
gridColumns("t1", cols, box2);
t("saved widths applied on the next mount", box2.style.getPropertyValue("--cols") === "386px 120px");

// Reset (Home) makes the column flexible again and removes its saved width.
g.fire("keydown", { key: "Home" });
t("Home resets the flexible column", box.style.getPropertyValue("--cols") === "minmax(160px, 2fr) 120px" && !("device" in prefsGet().layout.t1));

// Two tables keep separate widths.
gridColumns("t2", cols, new El("div")).grip("heard").fire("keydown", { key: "ArrowRight" });
t("layouts of different tables are independent", prefsGet().layout.t2.heard === 186 && prefsGet().layout.t1.heard === 120);

// Panes.
const pane = new El("div");
const pg = paneGrip("split", pane, "--split-left", { label: "Resize", def: 300, min: 200, max: 500 });
pg.fire("keydown", { key: "ArrowRight" });
t("pane grip moves and saves", pane.style.getPropertyValue("--split-left") === "316px" && prefsGet().layout.panes.split === 316);
for (let i = 0; i < 40; i++) pg.fire("keydown", { key: "ArrowRight" });
t("pane grip respects its maximum", pane.style.getPropertyValue("--split-left") === "500px");

// store.load keeps the layout map across a fresh module instance.
const fresh = await import("../ui/js/lib/store.js?reload=1");
t("a fresh load of the prefs keeps layout", fresh.prefsGet().layout.t1.heard === 120 && fresh.prefsGet().layout.panes.split === 500);

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("resize tests passed");
