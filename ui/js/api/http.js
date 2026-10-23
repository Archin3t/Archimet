/* fetch wrapper. The session is the KISMET cookie, issued through archimet-gateway (same origin). A 401 anywhere
 * raises a session-expired event; the shell shows the login sheet and retries. */

const listeners = new Set();
export function onAuthLost(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function authLost() { for (const fn of listeners) fn(); }

export class HttpError extends Error {
    constructor(status, path, body) {
        super(`HTTP ${status} ${path}`);
        this.status = status;
        this.path = path;
        this.body = body;
    }
}

/* Kismet on a Pi 3B+ is shared with the logger: never more than two Kismet requests in
 * flight from one browser. Logger API calls (other origin/port) are not queued. */
const MAX_KISMET = 2;
let inflight = 0;
const waiting = [];
function slot() {
    if (inflight < MAX_KISMET) { inflight++; return Promise.resolve(); }
    return new Promise(r => waiting.push(r));
}
function release() {
    const next = waiting.shift();
    if (next) next(); else inflight--;
}
const isKismet = (url) => url.startsWith("/") && !url.startsWith("/archimet") && !url.startsWith("/js/");

export async function request(url, opts = {}) {
    if (!isKismet(url)) return send(url, opts);
    await slot();
    try { return await send(url, opts); } finally { release(); }
}

async function send(url, { method = "GET", form = null, json = null, headers = {}, timeout = 20000, auth = true } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const opts = { method, headers: { ...headers }, credentials: "include", signal: ctrl.signal, cache: "no-store" };
    if (form) {
        /* Kismet 2025.09 ignores the form (and returns every device in full, ~2.6 MB on this
         * Pi) when the type is "application/x-www-form-urlencoded;charset=UTF-8", which is what
         * fetch() sends for a URLSearchParams body. Send a string with the exact type. */
        opts.method = "POST";
        opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
        opts.body = new URLSearchParams(form).toString();
    } else if (json) {
        opts.method = method === "GET" ? "POST" : method;
        opts.headers["Content-Type"] = "application/json";
        opts.headers["X-Archimet"] = "1";
        opts.body = JSON.stringify(json);
    }
    let res;
    try {
        res = await fetch(url, opts);
    } catch (e) {
        throw new HttpError(0, url, e.name === "AbortError" ? "timeout" : "network");
    } finally {
        clearTimeout(t);
    }
    if (res.status === 401 && auth) authLost();
    const text = await res.text();
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch (e) { /* plain text */ }
    if (!res.ok) throw new HttpError(res.status, url, body);
    return body;
}
