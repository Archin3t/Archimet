/* Checks the running Kismet against contract.json. Pure check() is shared with tests. */

import { request } from "./http.js";

/* "archimet-logger 5.2.0" -> [5, 2, 0]; anything else -> null. */
export function loggerVersion(s, name = "archimet-logger") {
    const m = typeof s === "string" && s.trim().match(/^(\S+) (\d+)\.(\d+)\.(\d+)$/);
    return m && m[1] === name ? [+m[2], +m[3], +m[4]] : null;
}

/* The logger's /archimet/health answer against contract.logger. Fails closed: no minimum in
 * the contract, no answer, or no parseable version is a failure, never a pass. Same rules as
 * pi/archimet-compat check_logger_version(). */
export function checkLogger(spec, status, body) {
    const min = spec && loggerVersion(`${spec.name} ${spec.min_version}`, spec.name);
    if (!min) return { ok: false, missing: ["contract has no logger minimum version"] };
    if (status !== 200) return { ok: false, missing: [`HTTP ${status || "no answer"}`] };
    const v = body && typeof body === "object" ? loggerVersion(body.version, spec.name) : null;
    if (!v) return { ok: false, missing: ["logger reports no version"] };
    const cmp = v.map((x, i) => x - min[i]).find(x => x !== 0) || 0;
    return cmp >= 0 ? { ok: true, missing: [] } : { ok: false, missing: [`logger ${v.join(".")} older than ${spec.min_version}`] };
}

export function check(entry, status, body) {
    const missing = [];
    if (status !== 200) return { ok: false, missing: [`HTTP ${status || "no answer"}`] };
    if (entry.text) return { ok: true, missing };
    if (entry.list && !Array.isArray(body)) return { ok: false, missing: ["expected a list"] };
    for (const k of entry.requires || []) if (!body || !(k in body)) missing.push(k);
    let item = null;
    if (entry.item) {
        item = entry.item.reduce((o, k) => (o == null ? o : o[k]), body);
        if (item && entry.item_requires) for (const k of entry.item_requires) if (!(k in item)) missing.push(k);
    }
    /* Paging and field selection must be honoured (Kismet silently ignores malformed forms
     * and returns every device in full, which a Pi 3B+ cannot sustain). */
    if (entry.max_items) {
        const arr = body && body[entry.max_items[0]];
        if (Array.isArray(arr) && arr.length > entry.max_items[1]) missing.push(`paging ignored (${arr.length} items)`);
        if (Array.isArray(arr) && arr[0] && entry.max_fields && Object.keys(arr[0]).length > entry.max_fields) missing.push("field list ignored");
    }
    if (entry.list && body.length && entry.item_requires_if_any)
        for (const k of entry.item_requires_if_any) if (!(k in body[0])) missing.push(k);
    return { ok: missing.length === 0, missing };
}

export async function run() {
    const contract = await request("js/api/contract.json", { auth: false });
    const out = [];
    for (const e of contract.endpoints) {
        let status = 0, body = null;
        try {
            body = await request(e.path, e.method === "POST" ? { form: e.form || {} } : {});
            status = 200;
        } catch (err) {
            status = err.status || 0;
        }
        out.push({ id: e.id, screen: e.screen, path: e.path, ...check(e, status, body) });
    }
    // Sort direction semantics (Kismet 2025.09 inverts "asc"/"desc"; Archimet compensates).
    try {
        const { SORT_DESC } = await import("./kismet.js");
        const r = await request("/devices/views/all/devices.json", { form: {
            json: JSON.stringify({ fields: ["kismet.device.base.last_time"] }), page: 0, length: 5,
            sort: "kismet.device.base.last_time", sort_dir: SORT_DESC } });
        const t = (r.data || []).map(d => d["kismet.device.base.last_time"]);
        const ok = t.every((v, i) => i === 0 || t[i - 1] >= v);
        out.push({ id: "sort_dir", screen: "Devices (sorting)", path: "sort_dir", ok, missing: ok ? [] : ["sort direction semantics changed"] });
    } catch (e) {
        out.push({ id: "sort_dir", screen: "Devices (sorting)", path: "sort_dir", ok: false, missing: [`HTTP ${e.status || 0}`] });
    }
    // Lookup by MAC (inspector from LE History / Review): a real device must come back.
    try {
        const { byMacPath } = await import("./kismet.js");
        const one = await request("/devices/views/all/devices.json", { form: { json: JSON.stringify({ fields: ["kismet.device.base.macaddr"] }), page: 0, length: 1 } });
        const mac = one.data && one.data[0] && one.data[0]["kismet.device.base.macaddr"];
        const found = mac ? await request(byMacPath(mac), { form: { json: JSON.stringify({ fields: ["kismet.device.base.key"] }) } }) : [];
        const ok = !mac || (Array.isArray(found) && found.length > 0);
        out.push({ id: "by_mac", screen: "Inspector (open by MAC)", path: "/devices/by-mac", ok, missing: ok ? [] : ["by-mac lookup returned nothing"] });
    } catch (e) {
        out.push({ id: "by_mac", screen: "Inspector (open by MAC)", path: "/devices/by-mac", ok: false, missing: [`HTTP ${e.status || 0}`] });
    }
    // Logger version: the UI needs the logger API of contract.logger.min_version or newer.
    let lstatus = 0, lbody = null;
    try {
        const { archimet } = await import("./archimet.js");
        lbody = await archimet.health();
        lstatus = 200;
    } catch (e) {
        lstatus = e.status || 0;
    }
    out.push({ id: "logger_version", screen: "LE History, Review, System (logger)", path: "/archimet/health",
               ...checkLogger(contract.logger, lstatus, lbody) });
    return { tested_with: contract.tested_with, results: out };
}
