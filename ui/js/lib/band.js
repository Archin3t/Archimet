/* Radio band, channel and frequency: the one place they are derived (Devices, inspector, Channels).
 * Pure functions (tests/test_ui.mjs). Only what Kismet observed is used.
 *
 * What Kismet's fields mean (audited on the Pi, 2026-10-22):
 *   kismet.device.base.channel     the channel Kismet attributes to the device (for an AP, normally
 *                                  the channel its beacons announce)
 *   dot11 ... advertisedssid.channel   the channel in the AP's last beacon
 *   kismet.device.base.frequency   the frequency tag of the LAST packet: the channel the hopping
 *                                  capture radio was tuned to, which right after a channel switch is
 *                                  often not where the frame was really sent
 *   kismet.device.base.freq_khz_map    packets counted per frequency tag over this capture run
 * So a channel / last-frequency disagreement is usually a hopping artefact, not two transmissions.
 * Packet frequency tags may follow a hopping capture radio rather than the device. A missing
 * match therefore leaves the band unverified; it does not establish a device conflict. */

/* Wi-Fi band of a frequency in MHz: "2.4" | "5" | "6" | "". */
export function bandOfMhz(mhz) {
    return mhz >= 2400 && mhz < 2500 ? "2.4" : mhz >= 4900 && mhz < 5925 ? "5" : mhz >= 5925 && mhz <= 7125 ? "6" : "";
}

/* The 802.11 channel whose centre is exactly this frequency -> { band, ch } | null. */
export function wifiChannel(mhz) {
    mhz = Math.round(Number(mhz) || 0);
    const at = (band, ch) => Number.isInteger(ch) ? { band, ch } : null;
    if (mhz === 2484) return { band: "2.4", ch: 14 };
    if (mhz >= 2412 && mhz <= 2472) return at("2.4", (mhz - 2407) / 5);
    if (mhz >= 4915 && mhz <= 4980) return at("5", (mhz - 4000) / 5);        // 4.9 GHz, ch 183-196
    if (mhz >= 5160 && mhz <= 5885) return at("5", (mhz - 5000) / 5);
    if (mhz === 5935) return { band: "6", ch: 2 };
    if (mhz >= 5955 && mhz <= 7115) return at("6", (mhz - 5950) / 5);
    return null;
}

/* Short label for a frequency in kHz: "6", "44", "6G 37", or "" when it is no Wi-Fi channel. */
export function channelLabel(khz) {
    const w = wifiChannel((Number(khz) || 0) / 1000);
    return !w ? "" : w.band === "6" ? `6G ${w.ch}` : String(w.ch);
}

/* Every centre frequency (MHz) a channel string can mean (6 GHz numbers overlap 2.4 / 5 GHz ones). */
export function channelFrequencies(channel) {
    const m = /^\s*(\d+)/.exec(String(channel || ""));
    if (!m) return [];
    const ch = Number(m[1]), six = /6e|6g|w6/i.test(String(channel));
    const out = [];
    if (!six) {
        if (ch >= 1 && ch <= 13) out.push(2407 + 5 * ch);
        if (ch === 14) out.push(2484);
        if (ch >= 32 && ch <= 177) out.push(5000 + 5 * ch);
        if (ch >= 183 && ch <= 196) out.push(4000 + 5 * ch);
    }
    if (ch === 2) out.push(5935);
    if (ch >= 1 && ch <= 233) out.push(5950 + 5 * ch);
    return out;
}

/* Frequency history {kHz: packets} -> [[MHz, packets], ...], most packets first. */
export function heardFrequencies(freqMap) {
    return Object.entries(freqMap || {}).map(([k, n]) => [Math.round(Number(k) / 1000), Number(n) || 0])
        .filter(([f, n]) => f > 0 && n > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

/* What the Wi-Fi radio readings say, with provenance. r: { channel, advChannel, freq (kHz), freqMap }
 * -> { state: "consistent" | "unverified" | "unknown", channelMhz, lastMhz, dominantMhz, heard, why, note } */
export function radioReadings(r) {
    const channel = r.channel == null ? "" : String(r.channel).trim();
    // Kismet reports beacon channel 0 when the beacon carried none: that is "unknown", not a channel.
    const adv = r.advChannel == null || String(r.advChannel).trim() === "0" ? "" : String(r.advChannel).trim();
    const lastMhz = Math.round((Number(r.freq) || 0) / 1000);
    const heard = heardFrequencies(r.freqMap);
    const dominantMhz = heard.length ? heard[0][0] : 0;
    const total = heard.reduce((s, [, n]) => s + n, 0);
    const chF = channelFrequencies(channel), advF = channelFrequencies(adv);
    const cands = [...new Set([...chF, ...advF])];
    const base = { lastMhz, dominantMhz, heard, channel, advChannel: adv, disagreement: null };
    if (!cands.length || (!lastMhz && !heard.length)) {
        return { ...base, state: "unknown", channelMhz: 0, why: !cands.length ? "Kismet reports no channel for this device." : "Kismet reports no frequency for this device.", note: "" };
    }
    // Two independent channel reports that name different frequencies (Kismet's channel field, which
    // follows captured packets, and the AP's own beacon). Never hidden: both are stated, with what the
    // packet tags support. For an AP the beacon is the AP's own announcement.
    const count = (fs) => heard.filter(([f]) => fs.includes(f)).reduce((s, [, n]) => s + n, 0);
    if (chF.length && advF.length && !chF.some(f => advF.includes(f))) {
        const k = count(chF), b = count(advF);
        const supported = b > k ? "beacon" : k > b ? "kismet" : "neither";
        base.disagreement = { kismet: channel, beacon: adv, supported, kismetPackets: k, beaconPackets: b,
            text: `Kismet's channel field says ${channel}; the AP's own beacon says ${adv}. `
                + (supported === "neither" ? "Packet tags support neither more than the other."
                    : `Packet tags support the ${supported === "beacon" ? "beacon" : "channel field"} (${Math.max(k, b)} of ${total} packets).`) };
    }
    const prefix = base.disagreement ? base.disagreement.text + " " : "";
    const match = heard.filter(([f]) => cands.includes(f)).sort((a, b) => b[1] - a[1])[0];
    if (match) {
        const [f, n] = match;
        const note = lastMhz && lastMhz !== f
            ? `The last packet carries a ${lastMhz} MHz tag: the capture radio hops channels, and frames caught around a switch take the new channel's tag. ${n} of ${total} packets were tagged ${f} MHz.`
            : "";
        const which = advF.includes(f) && !chF.includes(f) ? adv : channel || adv;
        return { ...base, state: "consistent", channelMhz: f,
            why: `${prefix}The reported channel (${which}) is ${f} MHz, and the device was heard there (${n} of ${total} packets).`, note };
    }
    if (!heard.length && cands.includes(lastMhz)) {
        return { ...base, state: "consistent", channelMhz: lastMhz, why: `${prefix}The reported channel matches the last packet's frequency (${lastMhz} MHz).`, note: "" };
    }
    // 2.4 GHz channels are 20-22 MHz wide and 5 MHz apart: a radio tuned to a neighbouring channel can
    // hear the device. Tags within 10 MHz are compatible with the report, but a few hopping tags can
    // still be artefacts, so the band stays unverified; the explanation says why.
    const near = cands.filter(c => c < 2500).map(c => [c, heard.filter(([f]) => f < 2500 && Math.abs(f - c) <= 10)])
        .filter(([, hs]) => hs.length).sort((a, b) => b[1].reduce((s, [, n]) => s + n, 0) - a[1].reduce((s, [, n]) => s + n, 0))[0];
    if (near) {
        const [c, hs] = near;
        return { ...base, state: "unverified", channelMhz: 0, overlap: true,
            why: `${prefix}Kismet reports channel ${channel || adv} (${c} MHz); the device was heard only on neighbouring 2.4 GHz frequencies (${hs.map(([f, n]) => `${f} MHz ×${n}`).join(", ")}). 2.4 GHz channels overlap, so this is compatible with the report, but with channel hopping it does not confirm it. The band is unverified.`,
            note: "" };
    }
    const reported = [channel && `channel ${channel} (Kismet)`, adv && adv !== channel && `channel ${adv} (beacon)`].filter(Boolean).join(" and ");
    return { ...base, state: "unverified", channelMhz: 0,
        why: prefix + (heard.length
            ? `Kismet reports ${reported}; packet frequency tags in this capture run are ${heard.slice(0, 4).map(([f, n]) => `${f} MHz (${n})`).join(", ")}${heard.length > 4 ? ", …" : ""}. None confirms the reported channel. With channel hopping, those tags do not prove the device transmitted at those frequencies. The band is unverified.`
            : `Kismet reports ${reported}; its only frequency reading is the last packet's ${lastMhz} MHz tag (no frequency history). With channel hopping, that tag cannot confirm or disprove the reported channel. The band is unverified.`),
        note: "" };
}

const isBt = (phy) => /bluetooth|btle/i.test(String(phy || ""));
const isWifi = (phy) => /802\.11/.test(String(phy || ""));

/* Radio band from what Kismet observed (band of the matched / dominant / last frequency). */
export function band(r) {
    const phy = String(r.phy || ""), type = String(r.type || "");
    const khz = Number(r.freq) || 0;
    const mhz = Math.round(khz / 1000);
    if (isBt(phy)) {
        // Kismet's HCI Bluetooth source reports a nominal 2400 MHz for every device: the band, not a channel.
        const f = mhz === 2400 ? " · 2.4 GHz band (nominal; no channel reported)" : mhz ? ` · ${mhz} MHz` : "";
        if (/BTLE/i.test(type)) return { id: "ble", short: "BLE", detail: "Bluetooth Low Energy" + f, mhz };
        if (/BR\/EDR/i.test(type)) return { id: "btc", short: "BT Classic", detail: "Bluetooth Classic (BR/EDR)" + f, mhz };
        return { id: "bt", short: "Bluetooth", detail: "Bluetooth, mode not reported", mhz };
    }
    if (isWifi(phy)) {
        const g = bandOfMhz(mhz);
        if (!g) return { id: "unknown", short: "Unknown", detail: mhz ? `Wi-Fi · ${mhz} MHz, not a 2.4 / 5 / 6 GHz frequency` : "Wi-Fi, no frequency observed", mhz: 0 };
        return { id: "w" + g, short: `${g} GHz`, detail: `Wi-Fi ${g} GHz · ${mhz} MHz`, mhz };
    }
    return { id: "unknown", short: "Unknown", detail: "Not enough data from Kismet" };
}

/* Everything a screen shows about a device's radio. For Wi-Fi the band is shown only when
 * a reported channel has a matching frequency tag, never from a lone hopping tag. */
export function radioInfo(r) {
    if (!isWifi(r.phy)) {
        const b = band(r);
        const mhz = Math.round((Number(r.freq) || 0) / 1000);
        const conflict = isBt(r.phy) && mhz && !(mhz >= 2400 && mhz <= 2484)
            ? { text: "Conflicting readings", why: `Bluetooth uses 2402-2480 MHz, but Kismet reports ${mhz} MHz for this device. Neither value is taken as fact.` } : null;
        return { ...b, channel: r.channel == null ? "" : String(r.channel), readings: null, conflict };
    }
    const rd = radioReadings(r);
    if (rd.state !== "consistent") {
        // A hopping packet tag alone cannot establish the device's band.
        return { id: "unknown", short: "Wi-Fi", detail: rd.state === "unverified" ? "Wi-Fi · band unverified" : "Wi-Fi · band unknown", mhz: 0,
            channel: rd.channel, readings: rd, conflict: null, differ: differOf(rd) };
    }
    const b = band({ ...r, freq: rd.channelMhz * 1000 });
    // The channel shown is the one the evidence supports (for a disagreeing AP, usually its beacon).
    const shown = rd.disagreement && rd.disagreement.supported === "beacon" ? rd.advChannel : rd.channel || rd.advChannel;
    return { ...b, channel: shown, readings: rd, conflict: null, differ: differOf(rd) };
}

/* Two channel reports that disagree: a compact flag for lists; the full text is in the readings. */
function differOf(rd) {
    if (!rd.disagreement) return null;
    const d = rd.disagreement;
    return { text: "Channel reports differ", short: `${d.kismet}≠${d.beacon}`, why: d.text };
}

/* The Devices "Radio" column text for a format ("band" | "channel" | "mhz"). */
export function radioText(info, format) {
    if (info.conflict) return info.conflict.text;
    if (format === "mhz" && info.mhz) return `${info.short} · ${info.mhz}`;
    if (format === "channel" && info.mhz) return `${info.short} · ${info.channel || "?"}`;
    return info.short;
}

/* Tooltip: the band detail plus the readings' explanation. */
export function radioTitle(info) {
    const r = info.readings;
    return [info.detail, info.conflict ? info.conflict.why : r && r.why, r && r.note].filter(Boolean).join("\n");
}

/* Kept for older callers: a lone hopping frequency tag is not a device conflict. */
export function radioConflict(_channel, _khz) {
    return null;
}
