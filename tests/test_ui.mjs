// SPDX-License-Identifier: GPL-2.0-or-later
// node tests/test_ui.mjs — pure parts of the v2 frontend (compatibility check, classification, RRD maths).
import fs from "fs";
import { check, checkLogger, loggerVersion } from "../ui/js/api/compat.js";
import { badgesFor, indexState, markerFor, reviewSummary, assocEvidence, identity, band } from "../ui/js/lib/classify.js";
import { rrdSeries, recentRate } from "../ui/js/lib/chart.js";
import { sourceHardware, sourceHistory, powerRows } from "../ui/js/lib/hardware.js";
import { shadowRows, lettering, width } from "../ui/js/ui/ascii.js";
import { CATS, buildFilter, presetOf, summary } from "../ui/js/lib/filters.js";
import { groupAlerts } from "../ui/js/lib/alerts.js";
import { heardStatus, lastObserved, observedKey, observedText, minuteLocal, newestByMac, HEARD_WINDOW } from "../ui/js/lib/heard.js";
import { radioConflict, radioInfo, radioText, radioTitle, radioReadings, heardFrequencies, channelFrequencies } from "../ui/js/lib/band.js";
import { newestThenSignal } from "../ui/js/lib/device_order.js";
import { requestGate } from "../ui/js/lib/util.js";
import { TAGS, TAG, GROUPS, radioTag, subtypesOf, tagsFor, markerOf, visibleTags, vendorOf, reasonParts, migrateColors, tagContrast, readable, DEFAULT_TAG_PREFS } from "../ui/js/lib/tags.js";
import { ssidPattern } from "../ui/js/api/kismet.js";
import { detectHardware, sourceDefinition, recheckAvailable, isHotspotIface } from "../ui/js/lib/hardware.js";

let failed = 0;
const t = (name, cond) => { if (!cond) { failed++; console.error("FAIL", name); } };

// A browser can hold malformed preference JSON; merging it must never mutate prototypes.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { prefsSet, prefsGet, prefsReset } = await import("../ui/js/lib/store.js");
prefsSet(JSON.parse('{"__proto__":{"archimetPolluted":true},"tags":{"__proto__":{"archimetPolluted":true}},"density":"compact"}'));
t("malformed preferences cannot pollute Object.prototype", Object.prototype.archimetPolluted === undefined);
t("valid preferences still merge", prefsGet().density === "compact");
prefsReset();
delete globalThis.localStorage;

const ordered = [
    { id: "weak", "kismet.device.base.last_time": 200, signal: -83 },
    { id: "old", "kismet.device.base.last_time": 199, signal: -25 },
    { id: "unknown", "kismet.device.base.last_time": 200, signal: null },
    { id: "strong", "kismet.device.base.last_time": 200, signal: -42 },
].sort(newestThenSignal).map(r => r.id);
t("Devices default: newest first, stronger signal for same-second ties, missing signal last", ordered.join() === "strong,weak,unknown,old");

const contract = JSON.parse(fs.readFileSync(new URL("../ui/js/api/contract.json", import.meta.url)));
const entry = (id) => contract.endpoints.find(e => e.id === id);

// Contract: every list entry checks item fields, never top-level keys of an array.
for (const e of contract.endpoints) t(`${e.id}: list entries have no top-level requires`, !(e.list && e.requires));

// views (a list) passes with real-shaped data and fails when Kismet renames a field.
const view = { "kismet.devices.view.id": "all", "kismet.devices.view.description": "All devices", "kismet.devices.view.size": 3 };
t("views ok", check(entry("views"), 200, [view]).ok);
t("views renamed field", !check(entry("views"), 200, [{ ...view, "kismet.devices.view.id": undefined, x: 1 }].map(({ ["kismet.devices.view.id"]: _, ...r }) => r)).ok);

// devices: an ignored form (all devices, all fields) is caught.
const dev = { "kismet.device.base.key": "k", "kismet.device.base.macaddr": "AA:BB:CC:DD:EE:FF", "kismet.device.base.last_time": 1 };
t("devices ok", check(entry("devices"), 200, { data: [dev], last_row: 1, last_page: 1 }).ok);
t("devices paging ignored", !check(entry("devices"), 200, { data: [dev, dev], last_row: 2, last_page: 1 }).ok);
t("devices fields ignored", !check(entry("devices"), 200, { data: [{ ...dev, extra: 1 }], last_row: 1, last_page: 1 }).ok);
t("http error", !check(entry("status"), 401, null).ok);

// Logger minimum version: required by the contract, and fails closed.
const L = contract.logger;
t("contract: logger minimum is 5.2.0", L && L.min_version === "5.2.0" && L.name === "archimet-logger" && L.path === "/archimet/health");
t("shipped logger meets the minimum", checkLogger(L, 200, { ok: true, version:
    fs.readFileSync(new URL("../pi/kismet-device-logger", import.meta.url), "utf8").match(/^VERSION = "([^"]+)"/m)[1] }).ok);
t("logger 5.2.0 ok", checkLogger(L, 200, { ok: true, version: "archimet-logger 5.2.0" }).ok);
t("logger 5.10.0 ok (numeric, not string order)", checkLogger(L, 200, { version: "archimet-logger 5.10.0" }).ok);
t("logger 6.0.0 ok", checkLogger(L, 200, { version: "archimet-logger 6.0.0" }).ok);
t("logger 5.1.9 refused", !checkLogger(L, 200, { version: "archimet-logger 5.1.9" }).ok);
t("logger 4.9.9 refused", !checkLogger(L, 200, { version: "archimet-logger 4.9.9" }).ok);
t("no version refused", !checkLogger(L, 200, { ok: true }).ok);
t("empty version refused", !checkLogger(L, 200, { version: "" }).ok);
t("garbled version refused", !checkLogger(L, 200, { version: "archimet-logger 5.2" }).ok);
t("other program refused", !checkLogger(L, 200, { version: "other-logger 9.9.9" }).ok);
t("non-JSON health refused", !checkLogger(L, 200, "archimet-logger 5.2.0").ok);
t("no answer refused", !checkLogger(L, 0, null).ok);
t("HTTP error refused", !checkLogger(L, 404, null).ok);
t("contract without logger refused", !checkLogger(undefined, 200, { version: "archimet-logger 5.2.0" }).ok);
t("contract without minimum refused", !checkLogger({ name: "archimet-logger" }, 200, { version: "archimet-logger 5.2.0" }).ok);
t("loggerVersion parse", JSON.stringify(loggerVersion("archimet-logger 5.2.0")) === "[5,2,0]" && loggerVersion(null) === null);

// Badges: text on every badge, LE outranks Review, Seen-before only for older MACs.
const idx = indexState({
    official: [{ mac: "00:25:df:00:00:01", match_reason: "Hardware: Axon", category: "Body cam" },
               { mac: "AA:00:00:00:00:02", match_reason: "keyword: police" }],
    review: [{ mac: "00:30:44:00:00:03", why_might_be: "fleet", signals: [{ class: "fleet", company: "CradlePoint, Inc", watch: true }] }],
});
t("keyword-only rows are not official", !idx.official.has("AA:00:00:00:00:02"));
const b1 = badgesFor("00:25:DF:00:00:01", idx, null, 0);
// A vendor prefix (Axon) puts the row in the LE log and names the maker; it never claims Body cam,
// Taser, police ownership or use, and the row is never called "Confirmed".
t("vendor-only LE row: LE log + Vendor match, no equipment", b1.map(b => b.id).join() === "confirmed,vendor" && b1.every(b => b.text)
    && !b1.some(b => /body cam|taser|police|confirmed/i.test(b.text)) && /Equipment not identified/.test(b1[1].title)
    && b1[0].text === "LE log" && /Not proof of police ownership or use/.test(b1[0].title));
t("vendor match says Kismet's manufacturer is the same evidence", /not a second piece of evidence/.test(TAG.vendor.help));
const b3 = badgesFor("00:30:44:00:00:03", idx, { first_seen: "2026-10-01", first_epoch: 100, log: "wifi_clients" }, 200);
t("review + watch + seen", b3.map(b => b.id).join() === "review,watch,seen");
t("marker strongest", markerFor({ id: "wifi" }, b3) === "watch");
t("seen-before not for this run", !badgesFor("00:30:44:00:00:03", idx, { first_seen: "x", first_epoch: 300, log: "l" }, 200).some(b => b.id === "seen"));
t("review summary", reviewSummary(idx.review.get("00:30:44:00:00:03")) === "fleet-vendor MAC (CradlePoint)");
t("probe-only has no evidence", !assocEvidence({}).data);
t("retries are evidence", assocEvidence({ "dot11.client.num_retries": 3 }).data);

// RRD: oldest → newest, newest is the slot of last_time; rate skips the filling slot.
const vec = Array.from({ length: 60 }, (_, i) => i);
const s = rrdSeries({ "kismet.common.rrd.minute_vec": vec, "kismet.common.rrd.last_time": 1000 * 60 + 7 }, "minute");
t("rrd newest last", s[59] === 7 && s[0] === 8);
t("rate excludes current", recentRate([10, 10, 10, 0], 3) === 10);

// Identity: a missing name is labelled by what Kismet observed, never "hidden" without beacon evidence.
const W = { phy: "IEEE802.11", mac: "06:00:00:00:2F:50" };
t("beacon ssid is the name", identity({ ...W, type: "Wi-Fi AP", beacon_ts: 1, ssid: "TestNet", name: "TestNet" }).name === "TestNet");
const cl = identity({ ...W, type: "Wi-Fi AP", beacon_ts: 1, ssid: "", cloaked: 1, ssidlen: 0, name: "06:00:00:00:2F:50" });
t("cloaked beacon is hidden", cl.hidden && cl.label === "Hidden SSID" && !cl.name);
t("cloaked + probe response", identity({ ...W, type: "Wi-Fi AP", beacon_ts: 1, cloaked: 1, responded: ["Office"] }).label.includes("Office"));
const nb = identity({ ...W, type: "Wi-Fi AP", beacon_ts: 0, name: "" });
t("no beacon is not hidden", !nb.hidden && nb.label === "AP · no beacon heard");
t("client no name", identity({ ...W, type: "Wi-Fi Client" }).label === "Client · no name");
t("client probe is not its name", identity({ ...W, type: "Wi-Fi Client", probe: "HomeNet" }).name === "");
t("bridged", identity({ ...W, type: "Wi-Fi Bridged" }).label.startsWith("Bridged"));
t("ble unnamed", identity({ phy: "BTLE", type: "BTLE", mac: "AA" }).label === "BLE · no name advertised");
t("bt classic unnamed", identity({ phy: "Bluetooth", type: "BR/EDR", mac: "AA" }).label.startsWith("BT Classic"));
t("username wins", identity({ ...W, type: "Wi-Fi Client", username: "Van" }).name === "Van");
t("mac as name is no name", identity({ ...W, type: "Wi-Fi Device", name: "06:00:00:00:2f:50" }).name === "");

// Band: from observed frequency / BT type only.
t("2.4", band({ phy: "IEEE802.11", freq: 2437000 }).short === "2.4 GHz");
t("5", band({ phy: "IEEE802.11", freq: 5745000 }).short === "5 GHz");
t("6", band({ phy: "IEEE802.11", freq: 5955000 }).short === "6 GHz");
t("wifi unknown", band({ phy: "IEEE802.11", freq: 0 }).short === "Unknown");
t("ble", band({ phy: "BTLE", type: "BTLE", freq: 2402000 }).short === "BLE");
t("classic", band({ phy: "Bluetooth", type: "BR/EDR" }).short === "BT Classic");
t("other phy", band({ phy: "RTL433", type: "Sensor" }).short === "Unknown");

// Hardware: sources map to their USB device by interface; history is per-source; power never guesses.
const met = { time: 100, usb: [{ port: "1-1.1.3", id: "0bda:8812", product: "NIC", max_power_ma: 500 }],
    wifi: [{ iface: "wlan1", usb_port: "1-1.1.3", driver: "rtw88_8812au" }, { iface: "wlan1mon", usb_port: "1-1.1.3" }],
    capture_helpers: [{ name: "kismet_cap_linux_wifi", pid: 7, started: 40 }],
    throttled: { raw: "0x50000", now: { undervoltage: false, throttled: false, arm_freq_capped: false, soft_temp_limit: false },
        since_boot: { undervoltage: true, throttled: true, arm_freq_capped: false, soft_temp_limit: false } } };
const hw = sourceHardware({ "kismet.datasource.interface": "wlan1", "kismet.datasource.capture_interface": "wlan1mon", "kismet.datasource.ipc_pid": 7 }, met);
t("usb matched", hw.usb && hw.usb.id === "0bda:8812" && hw.helper.started === 40);
t("capture interface preferred", hw.wifi.iface === "wlan1mon");
t("bt not usb", sourceHardware({ "kismet.datasource.interface": "hci0" }, met).usb === null);
const al = [{ "kismet.alert.header": "SOURCEERROR", "kismet.alert.text": "Source ALFA (5fe308bd-1) error", "kismet.alert.timestamp": 5 },
    { "kismet.alert.header": "SOURCEOPEN", "kismet.alert.text": "Source ALFA (5FE308BD-1) re-opened", "kismet.alert.timestamp": 9 },
    { "kismet.alert.header": "SOURCEERROR", "kismet.alert.text": "Source BT (91DD-2) error", "kismet.alert.timestamp": 6 }];
t("history per source newest first", sourceHistory(al, "5FE308BD-1").map(x => x.kind).join() === "reopened,error");
const pr = powerRows(met);
t("undervoltage earlier", pr[0][1] === "warn" && pr[2][1] === "ok");
t("power unavailable", powerRows({ throttled: { unavailable: "x" } })[0][1] === "unknown");

// Intro lettering: real ANSI Shadow text, rectangular, distress only touches block faces.
t("title width", width("ARCHIMET") === 63 && width("ARCHINET") === 62);
for (const w of ["ARCHIMET", "ARCHINET"]) t(`${w} rows equal`, new Set(shadowRows(w).map(r => [...r].length)).size === 1);
const plain = lettering("ARCHIMET"), rough = lettering("ARCHIMET", { distress: true });
t("drips add rows", rough.length > plain.length && rough.length <= plain.length + 4 && rough.every(r => r.length === 63));
let touched = 0;
plain.forEach((row, r) => row.forEach((c, i) => { if (rough[r][i].ch !== c.ch) { touched++; if (c.ch !== "█") failed++; } }));
t("distress is sparse", touched > 0 && touched <= 8);
t("letters readable", shadowRows("ARCHIMET")[2].includes("███████║"));

// Category filter: union semantics in ONE server query; never an empty regex list.
const idx2 = indexState({ official: [{ mac: "00:25:df:00:00:01", match_reason: "Hardware: Axon", category: "Body cam" },
    { mac: "aa:bb:cc:00:00:02", match_reason: "Operator: marked", category: "Other" }, { mac: "aa:bb:cc:00:00:03", match_reason: "Learned: client of confirmed LE AP 00:25:DF:00:00:01" }],
    review: [{ mac: "00:30:44:00:00:03", signals: [] }] });
t("everything = no filter", buildFilter(null, idx2).regex === null);
t("all radio types = no filter", buildFilter(CATS.filter(c => c.group === "radio").map(c => c.id), idx2).regex === null);
const fc = buildFilter(["client"], idx2);
t("clients only: one type pair", fc.regex.length === 1 && new RegExp(fc.regex[0][1]).test("Wi-Fi Client") && !new RegExp(fc.regex[0][1]).test("Wi-Fi AP"));
const fe = buildFilter(["client", "ble", "btc"], idx2);
const reE = new RegExp(fe.regex[0][1]);
t("end devices", ["Wi-Fi Client", "BTLE", "BR/EDR"].every(x => reE.test(x)) && !["Wi-Fi AP", "Wi-Fi Bridged", "Wi-Fi Device"].some(x => reE.test(x)));
const fo = buildFilter(["other"], idx2);
t("other radios excludes Wi-Fi/BT", !["Wi-Fi AP", "BTLE", "BR/EDR", "Wi-Fi Client"].some(x => new RegExp(fo.regex[0][1]).test(x)) && new RegExp(fo.regex[0][1]).test("RTL433"));
const fl = buildFilter(["le_hw", "review"], idx2);
t("LE classes by MAC", fl.regex.length === 1 && fl.regex[0][0] === "kismet.device.base.macaddr" && new RegExp(fl.regex[0][1]).test("00:25:DF:00:00:01") && new RegExp(fl.regex[0][1]).test("00:30:44:00:00:03") && !new RegExp(fl.regex[0][1]).test("AA:BB:CC:00:00:02"));
t("mixed = two pairs (Kismet ORs them)", buildFilter(["ap", "le_learned"], idx2).regex.length === 2);
const none = buildFilter(["le_op"], indexState({ official: [], review: [] }));
t("nothing to match -> empty, no query", none.empty && none.regex.length === 0);
t("nothing selected -> empty", buildFilter([], idx2).empty);
t("preset names", presetOf(["btc", "ble", "client"]) === "end" && summary(["client"]) === "Wi-Fi clients only" && summary(null) === "Everything");
t("presets: Wi-Fi, BLE", presetOf(["ap", "client", "wifiother"]) === "wifi" && presetOf(["ble"]) === "ble");
const idx3 = indexState({ official: [{ mac: "00:25:DF:00:00:0A", match_reason: "Hardware: Axon Enterprise, Inc. OUI 00:25:DF", type: "Wi-Fi AP" },
    { mac: "00:25:DF:00:00:0B", match_reason: "Hardware: Axon Enterprise, Inc. OUI 00:25:DF", type: "BTLE" }],
    review: [{ mac: "00:30:44:00:00:0C", signals: [{ class: "fleet", watch: true }] }, { mac: "00:30:44:00:00:0D", signals: [{ class: "fleet" }] }] });
const macRe = (f) => new RegExp(f.regex.find(p => p[0] === "kismet.device.base.macaddr")[1]);
t("no Police AP filter any more (an AP role is not police evidence)", !CATS.some(c => c.id === "policeap" || /police/i.test(c.label)));
t("Watch filter: watched Review rows only", macRe(buildFilter(["watch"], idx3)).test("00:30:44:00:00:0C") && !macRe(buildFilter(["watch"], idx3)).test("00:30:44:00:00:0D"));
t("every category in a panel group", CATS.every(c => ["radio", "le", "subtype", "workflow"].includes(c.group)));

// Alerts: identical repeats group; different text or MACs never merge; every time kept.
const A = (t2, text, tx = "AA") => ({ "kismet.alert.header": "NOCLIENTMFP", "kismet.alert.text": text, "kismet.alert.timestamp": t2, "kismet.alert.transmitter_mac": tx, "kismet.alert.severity": 5 });
const g = groupAlerts([A(10, "x"), A(30, "x"), A(20, "x"), A(25, "y"), A(40, "x", "BB")]);
t("groups", g.length === 3 && g[0].tx === "BB");
const gx = g.find(x => x.text === "x" && x.tx === "AA");
t("count + first/last + all times", gx.count === 3 && gx.first === 10 && gx.last === 30 && gx.times.join() === "30,20,10");

// Detected hardware: sources, NetworkManager radios and available ones are told apart.
const met2 = { usb: [{ port: "1-1.1.3", id: "0bda:8812", product: "NIC", drivers: ["rtw88_8812au"] }, { port: "1-1.2", id: "148f:5370", product: "802.11 n WLAN", drivers: ["rt2800usb"] }, { port: "1-1", id: "0424:2514", drivers: ["hub"] }],
    wifi: [{ iface: "wlan0", driver: "brcmfmac", usb_port: null }, { iface: "wlan1", usb_port: "1-1.1.3", driver: "rtw88_8812au" }, { iface: "wlan1mon", usb_port: "1-1.1.3" }, { iface: "wlan2", usb_port: "1-1.2", driver: "rt2800usb" }],
    networkmanager: [{ iface: "wlan0", state: "connected", connection: "Hotspot" }, { iface: "wlan1", state: "unmanaged" }, { iface: "wlan2", state: "unmanaged" }] };
const srcs2 = [{ "kismet.datasource.name": "ALFA", "kismet.datasource.interface": "wlan1", "kismet.datasource.capture_interface": "wlan1mon" }];
const probed2 = [{ "kismet.datasource.probed.interface": "wlan1", "kismet.datasource.type_driver": { "kismet.datasource.driver.type": "linuxwifi" } },
    { "kismet.datasource.probed.interface": "wlan2", "kismet.datasource.type_driver": { "kismet.datasource.driver.type": "linuxwifi" } }];
const det = detectHardware(met2, srcs2, probed2);
const by = Object.fromEntries(det.radios.map(r => [r.iface, r]));
t("source recognised", by.wlan1.status === "source" && by.wlan1.source === "ALFA");
t("hotspot radio never offered", by.wlan0.status === "managed");
t("new adapter available", by.wlan2.status === "available" && by.wlan2.usb.id === "148f:5370");
t("monitor sub-interface folded", !by.wlan1mon);
t("hub listed as other USB", det.otherUsb.length === 1 && det.otherUsb[0].port === "1-1");
t("no Kismet probe -> not offered", detectHardware(met2, srcs2, null).radios.find(r => r.iface === "wlan2").status === "unsupported");
// A radio already in monitor mode (captured by another process) is never offered.
const met3 = { ...met2, wifi: [{ iface: "wlan1", phy: "phy1", usb_port: "1-1.1.3" }, { iface: "wlan1mon", phy: "phy1", monitor: true, usb_port: "1-1.1.3" }] };
t("busy radio not offered", detectHardware(met3, [], probed2).radios.find(r => r.iface === "wlan1").status === "busy");
const met4 = { bluetooth: [{ iface: "hci1", bus: "usb", driver: "btusb" }] };
const probedBt = [{ "kismet.datasource.probed.interface": "hci1", "kismet.datasource.type_driver": { "kismet.datasource.driver.type": "linuxbluetooth" } }];
t("bluetooth never offered from the UI", detectHardware(met4, [], probedBt).radios[0].status === "config");
t("definition", sourceDefinition("wlan2", "linuxwifi", "USB WLAN2!") === "wlan2:type=linuxwifi,name=USB_WLAN2_");
let threw = 0; try { sourceDefinition("wlan2;rm", "linuxwifi", "x"); } catch (e) { threw++; } try { sourceDefinition("wlan2", "pcapfile", "x"); } catch (e) { threw++; }
t("definition rejects bad input", threw === 2);

// Intro: two-line title keeps distress positions; address wording never implies the Pi.
const l1 = lettering("ARCHI", { distress: true, offset: 0 }), l2 = lettering("MET", { distress: true, offset: 35 });
t("split widths", l1[0].length === 35 && l2[0].length === 28);
t("drips follow their letters", l1.length > 6 && l2.length > 6);

const { addressLine } = await import("../ui/js/ui/intro.js");
const { byMacPath } = await import("../ui/js/api/kismet.js");
t("by-mac path keeps literal colons", byMacPath("02:00:00:00:a0:01") === "/devices/by-mac/02:00:00:00:A0:01/devices.json");
let bad = 0; try { byMacPath("02:00:00:00:A0:01/../x"); } catch (e) { bad++; }
t("by-mac rejects anything but a MAC", bad === 1);
t("preview address labelled as local", /local preview/.test(addressLine("preview", "127.0.0.1:8765").label));
t("production address is the one this browser used", addressLine("", "192.0.2.10:2501").label === "connected via" && addressLine("", "192.0.2.10:2501").value === "192.0.2.10:2501");

// Heard recently: Kismet's own last_time vs Kismet's clock; failures are unknown, never history.
const NOWK = 1792689910;
const lk = { ok: true, kismetNow: NOWK, last: new Map([["A", NOWK - 30], ["B", NOWK - HEARD_WINDOW], ["C", NOWK - HEARD_WINDOW - 1], ["D", NOWK - 2700], ["F", NOWK + 3600]]) };
t("recent", heardStatus("A", lk).state === "recent" && heardStatus("B", lk).state === "recent");
t("window edge", heardStatus("C", lk).state === "earlier");
t("45 min ago is not on air", heardStatus("D", lk).state === "earlier" && heardStatus("D", lk).label === "Heard 45m ago");
t("absent", heardStatus("Z", lk).state === "absent");
t("lookup failed -> unknown", heardStatus("A", { ok: false, last: new Map() }).state === "unknown");
t("not looked up yet -> pending", heardStatus("A", null).state === "pending");
t("future time -> unknown", heardStatus("F", lk).state === "unknown");
t("expiry as Kismet's clock moves", heardStatus("A", { ...lk, kismetNow: NOWK + 120 }).state === "earlier");
// Last observed: real times only; date-only rows stay date-only and sort below same-day real times.
const o1 = lastObserved({ mac: "A", last_observed: NOWK - 600, last_seen: "2026-10-22" }, lk);
t("kismet newer than logger", o1.precise && o1.epoch === NOWK - 30 && o1.source === "Kismet");
const o2 = lastObserved({ mac: "Z", last_observed: NOWK - 600, last_seen: "2026-10-22" }, lk);
t("logger minute record", o2.precise && o2.epoch === NOWK - 600 && o2.source === "Archimet logger");
const o3 = lastObserved({ mac: "Z", last_observed: null, last_seen: "2026-10-20" }, { ok: false, last: new Map() });
t("date only", !o3.precise && observedText(o3) === "2026-10-20 · date only");
t("date-only sorts below a real time on the same day", observedKey(lastObserved({ mac: "Z", last_seen: "2026-10-22" }, lk)) < observedKey(o2));
t("minute format", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(minuteLocal(NOWK)));

// Sign-in copy: the isolated test Kismet never invites the Pi's credentials; elsewhere the existing account is named.
const { loginCopy, startWater, hexGlyph } = await import("../ui/js/ui/login.js");
const cTest = loginCopy({ preview: "test" }), cReal = loginCopy({ preview: "pi" }), cProd = loginCopy({});
t("test: Pi credentials do not work", /Pi's own account does not work here/.test(cTest.note) && cTest.test);
t("test: never says to use the Pi's account", !/Archimet account|this Pi's/.test(cTest.intro + cTest.note));
t("real preview: Pi account, no test warning", /Archimet account/.test(cReal.note) && !/do not work/.test(cReal.intro + cReal.note) && !cReal.test);
t("Pi: Archimet account, no preview note", /Archimet account/.test(cProd.intro) && cProd.note === "" && !/test/i.test(cProd.intro));
t("labels are Archimet-facing, not Kismet", !/Kismet/.test(cProd.intro + cReal.note + loginCopy({ expired: true }).intro));
t("expired keeps the distinction", /does not work/.test(loginCopy({ expired: true, preview: "test" }).note) && /session ended/.test(loginCopy({ expired: true }).intro));
t("first setup names the default and the lock", /archimet \/ archimet/.test(loginCopy({ firstSetup: true, defaultUser: "archimet" }).intro)
    && /closed to the network/.test(loginCopy({ firstSetup: true }).intro));
t("password never stored, said plainly", /password is not stored/.test(cProd.intro));

// Hex splash: two hex digits, never a binary-looking pair.
let rs = 0; const seq = () => (rs = (rs * 9301 + 49297) % 233280) / 233280;
const gl = Array.from({ length: 2000 }, () => hexGlyph(seq));
t("hex glyphs", gl.every(g => /^[0-9A-F]{2}$/.test(g)) && !gl.some(g => /^[01]+$/.test(g)) && new Set(gl).size > 100);
t("hex glyph with a stuck random source", hexGlyph(() => 0) === "02");

// Water backdrop: bounded, paused while hidden, still under reduced motion, cleaned up on stop.
function fakeEnv({ w = 1280, h = 800 } = {}) {
    const ev = () => { const m = new Map(); return { m, addEventListener: (k, f) => m.set(k, [...(m.get(k) || []), f]), removeEventListener: (k, f) => m.set(k, (m.get(k) || []).filter(x => x !== f)), fire(k, e = {}) { (m.get(k) || []).forEach(f => f(e)); }, count: () => [...m.values()].reduce((a, l) => a + l.length, 0) }; };
    const puts = { n: 0 };
    const ctx = new Proxy({ createImageData: (cw, ch) => ({ data: new Uint8ClampedArray(cw * ch * 4) }), putImageData: () => puts.n++ }, { get: (o, k) => k in o ? o[k] : () => {}, set: () => true });
    const doc = { ...ev(), hidden: false, createElement: () => ({ getContext: () => ctx }) };
    const win = { ...ev(), innerWidth: w, innerHeight: h, devicePixelRatio: 2 };
    let clock = 0, id = 0; const q = new Map();
    const env = { win, doc, now: () => clock, rand: seq,
        raf: (f) => { q.set(++id, f); return id; }, caf: (i) => q.delete(i) };
    const run = (n = 1, ms = 16.7) => { for (let k = 0; k < n; k++) { clock += ms; const fs2 = [...q.values()]; q.clear(); fs2.forEach(f => f()); } };
    return { env, doc, win, q, run, puts, target: ev(), canvas: { getContext: () => ctx }, tick: (ms) => { clock += ms; } };
}
const F = fakeEnv();
const wv = startWater(F.canvas, { target: F.target, env: F.env });
F.run(3);
t("water runs and paints, capped near 30 fps (3 frames at 60 fps -> 2 paints)", wv.stats().running && F.puts.n === 2 && wv.stats().cells <= 16000);
for (let k = 0; k < 200; k++) { F.tick(8); F.target.fire("pointermove", { clientX: 100 + (k % 2) * 300, clientY: 200 + k }); if (k % 5 === 0) F.run(1); }
const st = wv.stats();
t("fast moves splash a few hex glyphs (restrained: at most 12)", st.glyphs.length > 0 && st.glyphs.length <= 12 && st.glyphs.every(g => /^[0-9A-F]{2}$/.test(g)));
t("swirls bounded (at most 3)", st.swirls > 0 && st.swirls <= 3);
F.run(120);
t("splash fades", wv.stats().glyphs.length === 0);
F.doc.hidden = true; F.doc.fire("visibilitychange");
const painted = F.puts.n; F.run(10);
t("hidden tab: no frames", F.q.size === 0 && F.puts.n === painted && !wv.stats().running);
F.target.fire("pointermove", { clientX: 5, clientY: 5 });
t("hidden tab: pointer does not restart", F.q.size === 0);
F.doc.hidden = false; F.doc.fire("visibilitychange"); F.run(2);
t("visible again: resumes (frame-capped)", wv.stats().running && F.puts.n === painted + 1);
wv.stop();
t("stop: no frame pending, listeners gone", F.q.size === 0 && F.target.count() === 0 && F.doc.count() === 0 && F.win.count() === 0 && wv.stats().listeners === 0);
F.run(5); F.target.fire("pointermove", { clientX: 9, clientY: 9 }); F.win.fire("resize"); F.run(2);
t("stop is final", F.q.size === 0 && !wv.stats().running);
const R = fakeEnv();
const wr = startWater(R.canvas, { target: R.target, env: R.env, reduced: true });
t("reduced motion: one still frame, no loop, no pointer", R.puts.n === 1 && R.q.size === 0 && R.target.count() === 0 && R.doc.count() === 0);
R.win.fire("resize");
t("reduced motion: resize repaints once", R.puts.n === 2 && R.q.size === 0);
wr.stop();
t("reduced motion: stop removes resize", R.win.count() === 0);
const C = fakeEnv({ w: 390, h: 844 });
const wc = startWater(C.canvas, { target: C.target, env: C.env, coarse: true });
t("touch: taps only, smaller grid", C.target.m.has("pointerdown") && !(C.target.m.get("pointermove") || []).length && wc.stats().cells <= 7000);
C.target.fire("pointerdown", { clientX: 200, clientY: 400 });
t("touch: tap swirls, never splashes", wc.stats().swirls === 1 && wc.stats().glyphs.length === 0);
wc.stop();

// One MAC, several Kismet records (phy + MAC keys): the newest last_time wins, in any order.
const recs = [{ "kismet.device.base.macaddr": "aa:bb:cc:00:00:01", "kismet.device.base.last_time": 500 },
    { "kismet.device.base.macaddr": "AA:BB:CC:00:00:01", "kismet.device.base.last_time": 900 },
    { "kismet.device.base.macaddr": "AA:BB:CC:00:00:02", "kismet.device.base.last_time": 100 }];
t("newest of several records", newestByMac(recs).get("AA:BB:CC:00:00:01") === 900 && newestByMac([...recs].reverse()).get("AA:BB:CC:00:00:01") === 900);
t("one entry per MAC", newestByMac(recs).size === 2);
t("heard uses the newest record", heardStatus("AA:BB:CC:00:00:01", { ok: true, kismetNow: 960, last: newestByMac(recs) }).state === "recent");


// Request order: only the newest request may draw.
const gate = requestGate(); const r1 = gate.next(), r2 = gate.next();
t("older request is stale", !gate.current(r1) && gate.current(r2));

// SSID search: Kismet ignores "search" on the SSID view, so a literal case-insensitive regex is sent.
t("ssid pattern literal", ssidPattern("a.b(c)") === String.raw`(?i)a\.b\(c\)`);
t("ssid pattern matches case-insensitively", new RegExp(ssidPattern("ARCH").slice(4), "i").test("archimet-test-ap"));

// ---- Regression: sign-in wording (simple, never says which field was wrong; no credentials shown).
const { loginError } = await import("../ui/js/ui/login.js");
t("401 wording", loginError(401) === "Invalid username or password.");
t("other HTTP", loginError(500) === "Sign-in failed (HTTP 500).");
t("unreachable", loginError(0) === "The Pi is not reachable." && loginError(undefined) === "The Pi is not reachable.");
t("test note names no user", !/archimet-test/.test(loginCopy({ preview: "test" }).note) && /Isolated test instance/.test(loginCopy({ preview: "test" }).note));

// ---- Regression: wlan0 (hotspot) is never a capture source, whatever the readings say.
t("hotspot iface", isHotspotIface("wlan0") && isHotspotIface("wlan0mon") && !isHotspotIface("wlan1") && !isHotspotIface("wlan01"));
const pWlan0 = [{ "kismet.datasource.probed.interface": "wlan0", "kismet.datasource.type_driver": { "kismet.datasource.driver.type": "linuxwifi" } }];
for (const [label, m] of [["metrics missing", null], ["metrics failed", { error: "x" }], ["NM unmanaged", { wifi: [{ iface: "wlan0" }], networkmanager: [{ iface: "wlan0", state: "unmanaged" }] }]]) {
    const r = detectHardware(m, [], pWlan0).radios.find(x => x.iface === "wlan0");
    t(`wlan0 not offered (${label})`, r && r.status === "managed");
}
t("wlan0mon not offered", detectHardware(null, [], [{ "kismet.datasource.probed.interface": "wlan0mon" }]).radios.every(r => r.status !== "available"));
let w0 = 0; for (const i of ["wlan0", "wlan0mon"]) { try { sourceDefinition(i, "linuxwifi", "x"); } catch (e) { w0++; } }
t("sourceDefinition refuses wlan0 and wlan0mon", w0 === 2);
t("recheck: wlan0 refused", !recheckAvailable("wlan0", null, [], pWlan0).ok);
t("recheck: still available", recheckAvailable("wlan2", met2, srcs2, probed2).ok);
t("recheck: unplugged", !recheckAvailable("wlan2", { ...met2, wifi: met2.wifi.filter(w => w.iface !== "wlan2") }, srcs2, probed2.filter(p => p["kismet.datasource.probed.interface"] !== "wlan2")).ok);
t("recheck: added meanwhile", !recheckAvailable("wlan2", met2, [...srcs2, { "kismet.datasource.name": "X", "kismet.datasource.interface": "wlan2" }], probed2).ok);
t("recheck: Kismet did not answer", !recheckAvailable("wlan2", met2, srcs2, null).ok);


// ---- Tags: radio type, LE subtype and evidence/workflow are separate; subtypes need evidence.
t("every tag in a known group, with text and help", TAGS.every(x => GROUPS.some(g => g[0] === x.group) && x.label && x.help));
t("no 'Possible body cam' tag", !TAGS.some(x => /possible/i.test(x.label)) && !TAG.bodycamtaser);
t("Learned is evidence, not a status colour", TAG.learned.group === "evidence" && markerOf([{ id: "learned" }], "wifi-client") === "wifi-client");
t("radio tags", radioTag("IEEE802.11", "Wi-Fi AP") === "wifi-ap" && radioTag("IEEE802.11", "Wi-Fi Client") === "wifi-client"
    && radioTag("IEEE802.11", "Wi-Fi Bridged") === "wifi-other" && radioTag("Bluetooth", "BTLE") === "ble" && radioTag("Bluetooth", "BR/EDR") === "btc" && radioTag("RTL433", "Sensor") === "other");
const axon = { mac: "00:25:DF:00:00:09", kind: "hardware", match_reason: "Hardware: Axon Enterprise, Inc. OUI 00:25:DF (IEEE MA-L)", category: "body cam / taser", type: "BTLE", name: "" };
t("vendor name from reason", vendorOf(axon) === "Axon");
t("Axon OUI alone: no subtype", subtypesOf(axon).length === 0);
t("rule category never becomes a subtype", subtypesOf({ ...axon, category: "body cam / taser" }).length === 0);
t("model name identifies body cam", subtypesOf({ ...axon, name: "Axon Body 3 X81234" }).join() === "bodycam");
t("model name identifies Taser", subtypesOf({ ...axon, name: "TASER 10" }).join() === "taser");
t("model name identifies in-car video", subtypesOf({ ...axon, name: "Axon Fleet 3" }).join() === "incarvideo");
// Regression (2026-10-23): an Axon-prefix access point was labelled "Police AP".
t("vendor-prefix AP: no Police AP, no equipment", subtypesOf({ ...axon, type: "Wi-Fi AP" }).length === 0
    && subtypesOf({ ...axon, type: "Wi-Fi Client" }, { type: "Wi-Fi AP" }).length === 0 && !TAG.policeap);
const tg = tagsFor({ mac: axon.mac, phy: "IEEE802.11", type: "Wi-Fi AP", name: "Axon Body 3 X1" }, axon, { why_might_be: "x", watch: true }, null, 0);
t("tag order: status, equipment, evidence, workflow", tg.map(x => x.id).join() === "confirmed,bodycam,vendor,review,watch");
t("no tag text claims police or confirmation", !TAGS.some(x => /police|confirmed/i.test(x.label)));
t("precedence: LE log > Watch > Review > radio", markerOf(tg, "wifi-ap") === "confirmed" && markerOf(tg.filter(x => x.id !== "confirmed"), "wifi-ap") === "watch"
    && markerOf([{ id: "review" }], "ble") === "review" && markerOf([{ id: "seen" }], "ble") === "ble");
t("operator and association evidence", tagsFor({ mac: "M" }, { ...axon, kind: "operator" }).some(x => x.id === "operator" && x.text === "Operator mark")
    && tagsFor({ mac: "M" }, { ...axon, kind: "learned" }).some(x => x.id === "learned" && x.text === "Associated"));
const hidePrefs = { ...DEFAULT_TAG_PREFS, confirmed: { show: false, color: "#000000" }, review: { show: false, color: "#a8995a" } };
t("hiding: locked LE log tag always shows; Review can be hidden", visibleTags(tg, hidePrefs).some(x => x.id === "confirmed") && !visibleTags(tg, hidePrefs).some(x => x.id === "review"));
t("old colours migrate only where changed", JSON.stringify(migrateColors({ le: "#ff0000", wifi: "#7d8b99", bodycam: "#123456" }, { le: "#c84a3c", wifi: "#7d8b99", bodycam: "#9343cc" })) === JSON.stringify({ confirmed: { color: "#ff0000" } }));
t("every default colour is readable", TAGS.every(x => readable(x.color)));
t("contrast check flags a dark colour", !readable("#202020") && tagContrast("#202020").marker < 3);

const rp = reasonParts("Hardware: Axon Enterprise, Inc. OUI 00:25:DF — Body cam / Taser [rule axon-oui, rules 5.0.1]");
t("reason: rule category split out, not shown as the device type", rp.text === "Axon Enterprise, Inc. OUI 00:25:DF [rule axon-oui, rules 5.0.1]" && rp.ruleCategory === "Body cam / Taser");
t("reason: operator text kept", reasonParts("Operator: marked LE by x. Note: seen on a cruiser").text === "marked LE by x. Note: seen on a cruiser");
t("vendor via Kismet lookup", vendorOf({ match_reason: "Hardware: Axon Enterprise, Inc. Kismet manufacturer lookup 00:25:DF — x" }) === "Axon");
t("BT nominal 2400 MHz is a band, not a channel", /nominal; no channel/.test(band({ phy: "Bluetooth", type: "BTLE", freq: 2400000 }).detail));

// ---- First-run account (Archimet's own setup screen; Kismet's stock setup page is never served).
const { setupProblem, accountProblem, SETUP_COPY, changeRefusal } = await import("../ui/js/ui/login.js");
t("setup: valid", setupProblem("archinet", "correct horse battery", "correct horse battery") === "");
t("setup: user rules", /User/.test(setupProblem("", "x".repeat(12), "x".repeat(12))) && /User/.test(setupProblem("a b", "x".repeat(12), "x".repeat(12))));
t("setup: short password", /at least 10/.test(setupProblem("a", "short", "short")));
t("setup: mismatch", /differ/.test(setupProblem("a", "x".repeat(12), "y".repeat(12))));
t("setup copy: only from the Pi itself / SSH tunnel", /SSH tunnel/.test(SETUP_COPY) && /cannot claim/.test(SETUP_COPY));
t("account policy: the default password is refused", accountProblem("owner", "archimet", "archimet") !== "");
t("account policy: long default-like still not the default string", accountProblem("owner", "archimet12345", "archimet12345") === "");
t("account policy: password equal to user name refused", /differ from the user name/.test(accountProblem("LongUserName1", "longusername1", "longusername1")));
t("change refusal shows the gateway's policy text", changeRefusal({ status: 422, body: { detail: "Password: at least 10 characters." } }) === "Password: at least 10 characters."
    && /sign in again/.test(changeRefusal({ status: 401 })));

// ---- Radio readings (audited on the Pi 2026-10-22): channel vs frequency HISTORY, not the last packet's tag.
const kmap = (o) => Object.fromEntries(Object.entries(o).map(([m, n]) => [String(m * 1000), n]));
const WR = (channel, lastMhz, map, adv = "") => radioInfo({ phy: "IEEE802.11", type: "Wi-Fi AP", channel, advChannel: adv, freq: lastMhz * 1000, freqMap: map ? kmap(map) : undefined });
// Genuine match.
t("match: ch 6 heard at 2437", WR("6", 2437, { 2437: 40 }).readings.state === "consistent" && WR("6", 2437, { 2437: 40 }).conflict === null);
t("match: 6 GHz ch 37", WR("37", 6135, { 6135: 5 }).conflict === null && WR("37W6", 6135, { 6135: 5 }).conflict === null);
t("match: HT40 suffix", WR("36HT40+", 5180, { 5180: 9 }).conflict === null);
// Real Pi case: AP on ch 1, 1115 packets at 2412 MHz, hopping tags on every 5 GHz channel, last tag 5580.
const pi1 = WR("1", 5580, { 2412: 1115, 5180: 17, 5580: 17, 5765: 12, 5825: 15 }, "1");
t("ch 1 with a 5 GHz last tag but heard on 2412: consistent, not a conflict", pi1.readings.state === "consistent" && pi1.conflict === null);
t("…band comes from the heard channel, not the last tag", pi1.short === "2.4 GHz" && pi1.mhz === 2412);
t("…the last-tag note explains hopping", /hops channels/.test(pi1.readings.note) && /1115 of/.test(pi1.readings.note));
t("…table text has no warning symbol", !/[⚠≠]/.test(radioText(pi1, "band") + radioText(pi1, "channel")));
// Real Pi case: WDS AP reports ch 128, last tag 2412, heard mostly on 5580-5640: 5640 MHz = ch 128.
const pi2 = WR("128", 2412, { 2412: 32, 5580: 197, 5600: 194, 5620: 493, 5640: 817 }, "128");
t("ch 128 vs last tag 2412: consistent via 5640 MHz history", pi2.readings.state === "consistent" && pi2.short === "5 GHz");
// Stale / neighbouring: Kismet says 10, beacon says 11, heard only at 2462 (= ch 11).
t("beacon channel resolves a stale channel field", WR("10", 2462, { 2462: 17 }, "11").conflict === null);
// A reported channel absent from packet tags is unverified, not a device conflict.
const gc = WR("3", 2412, { 2412: 2 });
t("unverified: no yellow conflict label", gc.readings.state === "unverified" && gc.conflict === null && radioText(gc, "band") === "Wi-Fi" && radioText(gc, "mhz") === "Wi-Fi");
t("…explanation keeps both values and hopping caveat", /channel 3/.test(radioTitle(gc)) && /2412 MHz/.test(radioTitle(gc)) && /channel hopping/.test(radioTitle(gc)));
t("…no band stated as fact", gc.mhz === 0 && /band unverified/.test(gc.detail));
t("different band, never heard there: unverified", WR("44", 2412, { 2412: 30 }).readings.state === "unverified" && WR("44", 2412, { 2412: 30 }).mhz === 0);
t("screenshot ch 44 vs 2412 has no warning symbol", !/[⚠≠]/.test(radioText(WR("44", 2412, { 2412: 30 }), "band")));
t("screenshot ch 60 vs 2412 is unverified, not conflicting", WR("60", 2412, { 2412: 8 }).readings.state === "unverified" && WR("60", 2412, { 2412: 8 }).conflict === null);
// Missing values: never a conflict.
t("no channel: unknown, not a conflict or asserted band", WR("", 5180, { 5180: 3 }).readings.state === "unknown" && WR("", 5180, { 5180: 3 }).conflict === null && WR("", 5180, { 5180: 3 }).mhz === 0);
t("no frequency at all: unknown", WR("36", 0, null).readings.state === "unknown");
t("no history, last tag matches: consistent", WR("36", 5180, null).conflict === null);
t("no history, last tag differs: unverified with weaker-evidence wording", /no frequency history/.test(WR("36", 5220, null).readings.why) && WR("36", 5220, null).conflict === null);
t("beacon channel 0 means unknown, never shown as a channel", !/channel 0/.test(WR("3", 2412, { 2412: 3 }, 0).readings.why));
t("legacy radioConflict wrapper does not mistake a hopping tag for a conflict", radioConflict("6", 2437000) === null && radioConflict("44", 2412000) === null);
// Multi-radio devices are separate Kismet records (newestByMac above); Bluetooth readings.
t("Bluetooth nominal 2400 fine", radioInfo({ phy: "Bluetooth", type: "BTLE", freq: 2400000 }).conflict === null);
t("Bluetooth outside its band: conflicting readings", radioInfo({ phy: "Bluetooth", type: "BTLE", freq: 5180000 }).conflict.text === "Conflicting readings");
t("history helpers", heardFrequencies(kmap({ 5180: 1, 2412: 9 }))[0][0] === 2412 && channelFrequencies("1").includes(2412) && channelFrequencies("1").includes(5955));
// ---- Radio audit 2026-10-23 (live Pi snapshot + saved 2026-10-22 records); each would fail on the code before.
const WC = (channel, lastMhz, map) => radioInfo({ phy: "IEEE802.11", type: "Wi-Fi Client", channel, freq: lastMhz * 1000, freqMap: map ? kmap(map) : undefined });
// Channel 44 / 60 beside a 2412 MHz tag, with and without frequency history.
t("ch 44, last tag 2412, history on 5220: consistent 5 GHz, no flag", WR("44", 2412, { 5220: 2566, 5240: 1995, 2412: 3 }, "44").short === "5 GHz" && !WR("44", 2412, { 5220: 9 }, "44").differ);
t("ch 60, last tag 2412, no history: unverified, never a conflict or a band", WR("60", 2412, null).readings.state === "unverified" && WR("60", 2412, null).conflict === null && WR("60", 2412, null).mhz === 0);
// Two independent reports that disagree: stated, not hidden (saved record: channel field 1, beacon 36, tags on 5180).
const dis = WR("1", 5240, { 5180: 176, 5200: 121, 5240: 65 }, "36");
t("AP beacon vs channel field disagree: flagged with both values", dis.differ && dis.differ.short === "1≠36" && /channel field says 1/.test(dis.differ.why) && /beacon says 36/.test(dis.differ.why));
t("…packet tags support the beacon, and the band follows the supported report", dis.readings.disagreement.supported === "beacon" && dis.short === "5 GHz" && dis.channel === "36");
t("…the explanation keeps the disagreement in the readings", /channel field says 1/.test(dis.readings.why));
t("…no alarm label: a disagreement is shown, not called a device conflict", dis.conflict === null && !/Conflicting/.test(radioText(dis, "band")));
const dis2 = WR("124", 5640, { 5640: 81, 5620: 9, 2412: 2 }, "128");
t("124 vs beacon 128, tags on 5640 (=128): beacon supported", dis2.differ && dis2.readings.disagreement.supported === "beacon" && dis2.channel === "128");
const dis3 = WR("40", 2412, { 2412: 5 }, "44");
t("disagreeing reports, tags support neither: unverified, both kept", dis3.readings.state === "unverified" && dis3.differ && dis3.readings.disagreement.supported === "neither" && dis3.mhz === 0);
t("same frequency written differently (36 vs 36HT40+) is not a disagreement", !WR("36HT40+", 5180, { 5180: 4 }, "36").differ);
// Clients have no beacon: their channel is Kismet's attribution only.
t("client ch 48 (5240) heard there among hopping tags: consistent", WC("48", 5200, { 5200: 5, 5180: 3, 5240: 2 }).readings.state === "consistent" && WC("48", 5200, { 5240: 5 }).short === "5 GHz");
t("client ch 48 never heard at 5240: unverified", WC("48", 5200, { 5200: 5, 5180: 3 }).readings.state === "unverified");
t("client ch 6 heard only on 2442: unverified, overlap explained", WC("6", 2442, { 2442: 7, 2462: 1 }).readings.state === "unverified"
    && WC("6", 2442, { 2442: 7 }).readings.overlap === true && /overlap/.test(WC("6", 2442, { 2442: 7 }).readings.why) && WC("6", 2442, { 2442: 7 }).mhz === 0);
t("client with no channel and no frequency: unknown", WC("", 0, null).readings.state === "unknown" && WC("", 0, null).short === "Wi-Fi");
// Ambiguous 6 GHz channel numbers: "37" is 5 GHz-invalid but 6 GHz 6135; "1" can be 2412 or 5955.
t("ch 1 with only a 5955 tag reads as 6 GHz, never 2.4", WR("1", 5955, { 5955: 4 }).short === "6 GHz");
t("ch 1 with only a 2412 tag reads as 2.4 GHz, never 6", WR("1", 2412, { 2412: 4 }).short === "2.4 GHz");
t("ch 37 with a 2412 tag: unverified (no 2.4 / 5 GHz channel 37; 6 GHz not heard)", WR("37", 2412, { 2412: 2 }).readings.state === "unverified");
// Bluetooth: Kismet's HCI source reports a nominal 2400 MHz and channel "FHSS" (live records, 59 of 59).
t("Bluetooth FHSS / nominal 2400: band only, no channel claimed", /nominal; no channel reported/.test(radioInfo({ phy: "Bluetooth", type: "BTLE", channel: "FHSS", freq: 2400000 }).detail));

// Heard status must not call a restored (pre-start) Kismet record "this run" (2026-10-23 audit).
{ const lk = { ok: true, kismetNow: 10000, kismetStart: 9000, last: new Map([["AA:AA:AA:AA:AA:01", 8500], ["AA:AA:AA:AA:AA:02", 9950]]) };
  t("record older than Kismet's start: before this run", heardStatus("AA:AA:AA:AA:AA:01", lk).state === "earlier" && /before this Kismet run/.test(heardStatus("AA:AA:AA:AA:AA:01", lk).label));
  t("record within the window: recent", heardStatus("AA:AA:AA:AA:AA:02", lk).state === "recent"); }
t("old stored reason wording is shown without 'confirmed'", reasonParts("Learned: associated client of confirmed LE AP 00:25:DF:00:00:01 (Vendor)").text === "associated client of LE-log AP 00:25:DF:00:00:01 (Vendor)");
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("ui tests passed");
