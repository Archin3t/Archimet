// SPDX-License-Identifier: GPL-2.0-or-later
/* Devices default order. Kismet pages by last_time; resolve equal-second readings
 * by signal within each returned page, keeping devices without a reading last. */
export function newestThenSignal(a, b) {
    const last = (Number(b["kismet.device.base.last_time"]) || 0)
        - (Number(a["kismet.device.base.last_time"]) || 0);
    if (last) return last;
    const strength = (r) => {
        const n = r.signal;
        return n == null || n === 0 || !Number.isFinite(Number(n)) ? -Infinity : Number(n);
    };
    const signal = strength(b) - strength(a);
    if (Number.isNaN(signal)) return 0; // both missing
    return signal;
}
