// SPDX-License-Identifier: GPL-2.0-or-later
/* Kismet REST API (2025.09). Every endpoint the UI uses is listed here and in contract.json. */

import { request } from "./http.js";

const P = "";   // same origin: Archimet is Kismet's web root

export const FIELDS_ROW = [
    "kismet.device.base.key",
    "kismet.device.base.macaddr",
    "kismet.device.base.commonname",
    "kismet.device.base.name",
    "kismet.device.base.type",
    "kismet.device.base.phyname",
    "kismet.device.base.manuf",
    "kismet.device.base.channel",
    "kismet.device.base.frequency",
    "kismet.device.base.crypt",
    "kismet.device.base.first_time",
    "kismet.device.base.last_time",
    "kismet.device.base.packets.total",
    ["kismet.device.base.signal/kismet.common.signal.last_signal", "signal"],
    ["dot11.device/dot11.device.num_associated_clients", "clients"],
    ["dot11.device/dot11.device.last_beaconed_ssid_record/dot11.advertisedssid.ssid", "ssid"],
    // What lets the UI say *why* a device has no name (see classify.identity).
    "kismet.device.base.username",
    ["dot11.device/dot11.device.last_beaconed_ssid_record/dot11.advertisedssid.cloaked", "cloaked"],
    ["dot11.device/dot11.device.last_beaconed_ssid_record/dot11.advertisedssid.ssidlen", "ssidlen"],
    ["dot11.device/dot11.device.last_beacon_timestamp", "beacon_ts"],
    ["dot11.device/dot11.device.last_probed_ssid_record/dot11.probedssid.ssid", "probe"],
    // Radio readings: the beacon's own channel and the per-frequency packet history (see lib/band.js).
    ["dot11.device/dot11.device.last_beaconed_ssid_record/dot11.advertisedssid.channel", "adv_channel"],
    ["kismet.device.base.freq_khz_map", "freq_map"],
];

export const SORT_DESC = "asc";   // see devices(): Kismet 2025.09 quirk
export const SORT_ASC = "desc";

/* Sort columns Kismet can sort server-side. */
export const SORTS = {
    last: "kismet.device.base.last_time",
    name: "kismet.device.base.commonname",
    signal: "kismet.device.base.signal/kismet.common.signal.last_signal",
    channel: "kismet.device.base.channel",
    type: "kismet.device.base.type",
    manuf: "kismet.device.base.manuf",
    packets: "kismet.device.base.packets.total",
    first: "kismet.device.base.first_time",
    band: "kismet.device.base.frequency",
};

/* Kismet 2025.09 answers 500 when the MAC's colons are percent-encoded, so the MAC is validated
 * strictly and sent with literal colons. */
/* Literal, case-insensitive regex for an SSID search ("a.b" matches only "a.b"). */
export function ssidPattern(text) {
    return "(?i)" + String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function byMacPath(mac) {
    const m = String(mac || "").toUpperCase();
    if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(m)) throw new Error("bad MAC");
    return `${P}/devices/by-mac/${m}/devices.json`;
}

export const session = {
    check: () => request(P + "/session/check_session", { auth: false }),
    /* Credentials go once, in the Authorization header, to Kismet's login check.
     * Kismet answers with its session cookie; nothing is stored by Archimet. */
    login: (user, password) => request(P + "/session/check_login", {
        auth: false,
        headers: { Authorization: "Basic " + btoa(unescape(encodeURIComponent(`${user}:${password}`))) },
    }),
    setupOk: () => request(P + "/session/check_setup_ok", { auth: false }),
    /* Changes the account (user name and password together; Kismet keeps one account). Needs a
     * session; archimet-gateway checks the password policy and then ends every session. */
    setPassword: (user, password) => request(P + "/session/set_password", { form: { username: user, password } }),
    /* No account at all (only reachable from the Pi itself / an SSH tunnel; the gateway refuses others). */
    firstAccount: (user, password) => request(P + "/session/set_password", { auth: false, form: { username: user, password } }),
    /* Ends this browser's session at the gateway (the cookie is HttpOnly: scripts cannot clear it). */
    logout: () => request(P + "/archimet-session/logout", { method: "POST", auth: false }),
};

export const kismet = {
    status: () => request(P + "/system/status.json"),
    views: () => request(P + "/devices/views/all_views.json"),
    devices: (view, { page = 0, length = 50, search = "", sort = "last", dir = "desc", regex = null, fields = FIELDS_ROW } = {}) => {
        const j = { fields };
        if (regex) j.regex = regex;
        /* Kismet 2025.09 orders "asc" newest/largest first and anything else the other way.
         * Map Archimet's direction here; contract check "sort_dir" detects a change. */
        const form = { json: JSON.stringify(j), page, length, sort: SORTS[sort] || SORTS.last, sort_dir: dir === "desc" ? SORT_DESC : SORT_ASC };
        if (search) form.search = search;
        return request(`${P}/devices/views/${encodeURIComponent(view)}/devices.json`, { form });
    },
    device: (key) => request(`${P}/devices/by-key/${encodeURIComponent(key)}/device.json`),
    deviceByMac: (mac, fields = ["kismet.device.base.key", "kismet.device.base.phyname"]) => request(byMacPath(mac),
        { form: { json: JSON.stringify({ fields }) } }),
    multimac: (macs, fields) => request(`${P}/devices/multimac/devices.json`,
        { form: { json: JSON.stringify({ devices: macs, fields }) } }),
    multikey: (keys, fields) => request(`${P}/devices/multikey/devices.json`,
        { form: { json: JSON.stringify({ devices: keys, fields }) } }),
    setName: (key, name) => request(`${P}/devices/by-key/${encodeURIComponent(key)}/set_name.cmd`, { form: { json: JSON.stringify({ username: name }) } }),
    setTag: (key, tag, value) => request(`${P}/devices/by-key/${encodeURIComponent(key)}/set_tag.cmd`,
        { form: { json: JSON.stringify({ tagname: tag, tagvalue: value }) } }),
    alerts: (since = 0) => request(`${P}/alerts/last-time/${since}/alerts.json`),
    alertDefs: () => request(P + "/alerts/definitions.json"),
    messages: (since = 0) => request(`${P}/messagebus/last-time/${since}/messages.json`),
    sources: () => request(P + "/datasource/all_sources.json"),
    sourceTypes: () => request(P + "/datasource/types.json"),
    /* Interfaces Kismet could capture on (a probe; nothing is opened or changed). */
    listInterfaces: () => request(P + "/datasource/list_interfaces.cmd", { timeout: 45000 }),
    /* Add a capture source, e.g. "wlan2:type=linuxwifi,name=USB_WLAN2" (passive Wi-Fi). Server-wide. */
    addSource: (definition) => request(P + "/datasource/add_source.cmd", { form: { json: JSON.stringify({ definition }) }, timeout: 60000 }),
    /* Receive-only tuning, same payloads as Kismet's own UI. */
    lockChannel: (uuid, channel) => request(`${P}/datasource/by-uuid/${encodeURIComponent(uuid)}/set_channel.cmd`,
        { form: { json: JSON.stringify({ cmd: "lock", channel, uuid }) } }),
    /* Resume hopping on the source's existing channel list (Kismet's set_hop.cmd). Re-sending the
     * whole list through set_channel.cmd fails on the Alfa's 89-entry list (verified 2026-10-21). */
    hopChannels: (uuid) => request(`${P}/datasource/by-uuid/${encodeURIComponent(uuid)}/set_hop.cmd`,
        { form: { json: JSON.stringify({}) } }),
    openSource: (uuid) => request(`${P}/datasource/by-uuid/${encodeURIComponent(uuid)}/open_source.cmd`),
    closeSource: (uuid) => request(`${P}/datasource/by-uuid/${encodeURIComponent(uuid)}/close_source.cmd`),
    channels: () => request(P + "/channels/channels.json"),
    gps: () => request(P + "/gps/location.json"),
    packetStats: () => request(P + "/packetchain/packet_stats.json"),
    phys: () => request(P + "/phy/all_phys.json"),
    plugins: () => request(P + "/plugins/all_plugins.json"),
    /* Kismet 2025.09 ignores a "search" field on this view (verified: every search returned every
     * SSID); its regex filter works, so the text is matched literally and case-insensitively. */
    ssids: ({ page = 0, length = 50, search = "" } = {}) => {
        const j = search ? { regex: [["dot11.ssidgroup.ssid", ssidPattern(search)]] } : {};
        return request(P + "/phy/phy80211/ssids/views/ssids.json", { form: { json: JSON.stringify(j), page, length } });
    },
    apiKeys: () => request(P + "/auth/apikey/list.json"),
};
