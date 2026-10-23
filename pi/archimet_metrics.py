#!/usr/bin/env python3
"""Archimet hardware metrics for the Pi (stdlib only, read-only).

collect() returns a snapshot: CPU temperature and clock, throttling / under-voltage flags,
memory, disk, USB devices, Wi-Fi interfaces and Kismet capture-helper processes. Every
reading that cannot be taken is reported as {"unavailable": reason}, never guessed.
No MAC addresses or observed-device data are included.

Sampler keeps a small, bounded history of hardware events (under-voltage start/end,
throttle flag changes, USB device added/removed, Wi-Fi interface re-created, capture helper
restarted) so they survive the volatile journal. The logger serves both, behind Kismet
authentication, at /archimet/metrics.json.

Run directly to print one snapshot as JSON (used by the local preview over ssh).
"""
import json
import os
import subprocess
import threading
import time
from collections import deque
from pathlib import Path

SYS = Path("/sys")
PROC = Path("/proc")

# vcgencmd get_throttled bits (Raspberry Pi firmware documentation).
THROTTLE_BITS = {
    0: ("undervoltage", "now"), 1: ("arm_freq_capped", "now"), 2: ("throttled", "now"), 3: ("soft_temp_limit", "now"),
    16: ("undervoltage", "since_boot"), 17: ("arm_freq_capped", "since_boot"), 18: ("throttled", "since_boot"),
    19: ("soft_temp_limit", "since_boot"),
}


def _read(path, default=None):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return default


def _num(path):
    v = _read(path)
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def unavailable(reason):
    return {"unavailable": reason}


def decode_throttled(raw):
    """0xd0000 -> {"now": {...}, "since_boot": {...}} with every flag present."""
    flags = {"now": {}, "since_boot": {}}
    for bit, (name, when) in THROTTLE_BITS.items():
        flags[when][name] = bool(raw >> bit & 1)
    return flags


def throttled():
    try:
        out = subprocess.run(["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=3).stdout
        raw = int(out.strip().split("=", 1)[1], 16)
    except (OSError, subprocess.SubprocessError, IndexError, ValueError):
        return unavailable("vcgencmd get_throttled did not answer")
    return {"raw": hex(raw), **decode_throttled(raw)}


def undervoltage_now():
    """The firmware's live under-voltage alarm (raspberrypi_hwmon), None if absent."""
    for d in sorted(SYS.glob("class/hwmon/hwmon*")):
        if _read(d / "name") == "rpi_volt":
            v = _num(d / "in0_lcrit_alarm")
            return None if v is None else bool(v)
    return None


def cpu():
    t = _num(SYS / "class/thermal/thermal_zone0/temp")
    f = _num(SYS / "devices/system/cpu/cpu0/cpufreq/scaling_cur_freq")
    fmax = _num(SYS / "devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq")
    load = (_read(PROC / "loadavg") or "").split()[:3]
    return {
        "temp_c": round(t / 1000, 1) if t is not None else unavailable("no thermal zone"),
        "freq_mhz": f // 1000 if f else unavailable("no cpufreq"),
        "max_freq_mhz": fmax // 1000 if fmax else None,
        "load": [float(x) for x in load] if load else unavailable("no /proc/loadavg"),
        "cpus": os.cpu_count(),
    }


def memory():
    m = {}
    for line in (_read(PROC / "meminfo") or "").splitlines():
        k, _, v = line.partition(":")
        if k in ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree"):
            m[k] = int(v.split()[0]) * 1024
    if not m:
        return unavailable("no /proc/meminfo")
    return {"total": m.get("MemTotal"), "available": m.get("MemAvailable"),
            "swap_total": m.get("SwapTotal"), "swap_free": m.get("SwapFree")}


def disks(paths):
    out, seen = [], set()
    for label, p in paths:
        try:
            st = os.statvfs(p)
        except OSError:
            out.append({"label": label, "path": str(p), **unavailable("not mounted or not readable")})
            continue
        key = (st.f_fsid if hasattr(st, "f_fsid") else None, st.f_blocks)
        if key in seen:
            continue
        seen.add(key)
        out.append({"label": label, "path": str(p), "total": st.f_blocks * st.f_frsize, "free": st.f_bavail * st.f_frsize})
    return out


def usb():
    devs = []
    for d in sorted(SYS.glob("bus/usb/devices/*")):
        if not (d / "idVendor").exists() or ":" in d.name:
            continue
        drivers = sorted({Path(os.readlink(i / "driver")).name for i in d.glob(d.name + ":*") if (i / "driver").exists()})
        mp = (_read(d / "bMaxPower") or "").replace("mA", "")
        devs.append({
            "port": d.name, "id": f"{_read(d / 'idVendor')}:{_read(d / 'idProduct')}",
            "product": _read(d / "product"), "manufacturer": _read(d / "manufacturer"),
            "speed_mbps": _num(d / "speed"), "max_power_ma": int(mp) if mp.isdigit() else None,
            "devnum": _num(d / "devnum"), "power_control": _read(d / "power/control"), "drivers": drivers,
        })
    return devs


def wifi():
    out = []
    for n in sorted(SYS.glob("class/net/wlan*")):
        dev = n / "device"
        drv = Path(os.readlink(dev / "driver")).name if (dev / "driver").exists() else None
        usbp = None
        try:
            real = os.path.realpath(dev)
            usbp = next((part.split(":")[0] for part in real.split("/") if part.count("-") == 1 and ":" in part), None)
        except OSError:
            pass
        # ARPHRD type 803 = radiotap: the interface is in monitor mode, i.e. already capturing.
        out.append({"iface": n.name, "ifindex": _num(n / "ifindex"), "operstate": _read(n / "operstate"),
                    "driver": drv, "usb_port": usbp, "phy": _read(n / "phy80211/name"),
                    "monitor": _num(n / "type") == 803})
    return out


def cpu_times():
    """(total, idle) jiffies across all CPUs from /proc/stat."""
    f = [int(x) for x in (_read(PROC / "stat") or "cpu 0").splitlines()[0].split()[1:]]
    return sum(f[:8]), f[3] + (f[4] if len(f) > 4 else 0)


PROC_GROUPS = (("kismet", lambda comm, cmd: comm == "kismet"),
               ("capture helpers", lambda comm, cmd: comm.startswith("kismet_cap")),
               ("archimet logger", lambda comm, cmd: "kismet-device-logger" in cmd))


def proc_times():
    """Group -> summed utime+stime jiffies of its processes."""
    out = {g: 0 for g, _ in PROC_GROUPS}
    for p in PROC.glob("[0-9]*"):
        try:
            comm = (p / "comm").read_text().strip()
            cmd = (p / "cmdline").read_bytes().replace(b"\x00", b" ").decode(errors="replace")
            st = (p / "stat").read_text().rsplit(")", 1)[1].split()
        except (OSError, IndexError):
            continue
        for g, match in PROC_GROUPS:
            if match(comm, cmd):
                out[g] += int(st[11]) + int(st[12])
    return out


def cpu_usage(prev=None, window=0.4):
    """Total CPU % and each group's share of total CPU capacity, measured between two
    readings (prev from a sampler, or a fresh `window`-second measurement)."""
    fresh = prev is None
    if fresh:
        prev = (cpu_times(), proc_times())
        time.sleep(window)
    (t0, i0), p0 = prev
    (t1, i1), p1 = cpu_times(), proc_times()
    dt = max(1, t1 - t0)
    return {"total_pct": round(100 * (1 - (i1 - i0) / dt), 1),
            "processes_pct": {g: round(100 * max(0, p1[g] - p0.get(g, 0)) / dt, 1) for g in p1},
            "window_s": window if fresh else None}, ((t1, i1), p1)


def _boot_time():
    for line in (_read(PROC / "stat") or "").splitlines():
        if line.startswith("btime "):
            return int(line.split()[1])
    return None


def helpers():
    """Kismet capture helpers (one per open source) and when each started."""
    bt, hz, out = _boot_time(), os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100, []
    for p in PROC.glob("[0-9]*"):
        comm = _read(p / "comm") or ""
        if not comm.startswith("kismet_cap"):
            continue
        try:
            stat = (p / "stat").read_text()
            start = int(stat.rsplit(")", 1)[1].split()[19]) / hz
        except (OSError, IndexError, ValueError):
            start = None
        out.append({"name": comm, "pid": int(p.name), "started": round(bt + start) if bt and start is not None else None})
    return sorted(out, key=lambda x: x["name"])


def bluetooth():
    """Bluetooth controllers (hci*) and how they are attached: usb, or uart/sdio for on-board radios."""
    out = []
    for d in sorted(SYS.glob("class/bluetooth/hci*")):
        if ":" in d.name:
            continue
        real = os.path.realpath(d / "device") if (d / "device").exists() else ""
        bus = "usb" if "/usb" in real else "uart" if ("serial" in real or "tty" in real) else "sdio" if "mmc" in real else "other"
        drv = Path(os.readlink(d / "device" / "driver")).name if (d / "device" / "driver").exists() else None
        out.append({"iface": d.name, "bus": bus, "driver": drv})
    return out


def addresses():
    """The Pi's own IPv4 addresses per interface (from `ip`), loopback excluded."""
    out = subprocess.run(["ip", "-o", "-4", "addr", "show"], capture_output=True, text=True, timeout=3).stdout
    res = []
    for line in out.splitlines():
        f = line.split()
        if len(f) >= 4 and f[1] != "lo" and f[2] == "inet":
            res.append({"iface": f[1], "ipv4": f[3].split("/")[0]})
    return res


def nm_devices():
    """Interfaces NetworkManager manages (e.g. the hotspot on wlan0): never offered as capture sources."""
    out = subprocess.run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"], capture_output=True, text=True, timeout=3).stdout
    res = []
    for line in out.splitlines():
        f = line.split(":")
        if len(f) >= 4 and f[1] == "wifi":
            res.append({"iface": f[0], "state": f[2], "connection": f[3] or None})
    return res


def _safe(fn, *a):
    try:
        return fn(*a)
    except Exception as e:  # noqa: BLE001 - one bad reading must not hide the others
        return unavailable(f"{type(e).__name__} while reading")


def host():
    up = (_read(PROC / "uptime") or "0").split()[0]
    return {"model": (_read(PROC / "device-tree/model") or "").rstrip("\x00") or None,
            "uptime_s": int(float(up)), "boot_time": _boot_time()}


def collect(data_dir=None, usage=None):
    """usage: the sampler's latest cpu_usage() result; measured here when not given."""
    paths = [("root", "/")] + ([("logger data", data_dir)] if data_dir else [])
    if usage is None:
        usage = _safe(lambda: cpu_usage()[0])
    return {
        "time": int(time.time()),
        "host": _safe(host),
        "cpu": _safe(cpu),
        "cpu_usage": usage,
        "throttled": _safe(throttled),
        "undervoltage_now": _safe(undervoltage_now),
        "memory": _safe(memory),
        "disks": _safe(disks, paths),
        "usb": _safe(usb),
        "wifi": _safe(wifi),
        "capture_helpers": _safe(helpers),
        "bluetooth": _safe(bluetooth),
        "addresses": _safe(addresses),
        "networkmanager": _safe(nm_devices),
    }


class Sampler:
    """Background sampler: records hardware transitions into a bounded, persisted list."""

    def __init__(self, path, interval=5, keep=500, trend_every=60, trend_keep=1440):
        self.path, self.interval = Path(path), interval
        self.events = deque(maxlen=keep)
        # One measured point per minute, kept in memory from logger start (max 24 h).
        self.trend = deque(maxlen=trend_keep)
        self.trend_every, self.trend_at = trend_every, 0
        self.usage, self._cpu_prev, self._cpu_at = None, None, 0
        self.lock = threading.Lock()
        self.prev = None
        try:
            self.events.extend(json.loads(self.path.read_text()))
        except (OSError, ValueError):
            pass

    def _add(self, kind, detail):
        self.events.append({"t": int(time.time()), "kind": kind, "detail": detail})

    def _measure(self):
        now = time.time()
        try:
            if self._cpu_prev is not None:
                u, self._cpu_prev = cpu_usage(self._cpu_prev)
                u["window_s"] = round(now - self._cpu_at, 1)
                self.usage = u
            else:
                self._cpu_prev = (cpu_times(), proc_times())
            self._cpu_at = now
        except Exception:  # noqa: BLE001
            pass
        if self.usage and now - self.trend_at >= self.trend_every:
            self.trend_at = now
            c, m = cpu(), memory()
            self.trend.append({
                "t": int(now), "cpu_pct": self.usage["total_pct"],
                "temp_c": c["temp_c"] if isinstance(c.get("temp_c"), float) else None,
                "freq_mhz": c["freq_mhz"] if isinstance(c.get("freq_mhz"), int) else None,
                "mem_used": (m["total"] - m["available"]) if isinstance(m, dict) and m.get("total") else None,
                "undervoltage": undervoltage_now(),
            })

    def step(self):
        self._measure()
        uv = undervoltage_now()
        th = throttled()
        cur = {
            "uv": uv,
            "th": th.get("raw"),
            "usb": {d["port"]: (d["id"], d["devnum"], d["product"]) for d in usb()},
            "wifi": {w["iface"]: w["ifindex"] for w in wifi()},
            "helpers": {h["name"]: h["pid"] for h in helpers()},
        }
        p = self.prev
        changed = False
        with self.lock:
            if p is not None:
                if cur["uv"] is not None and cur["uv"] != p["uv"]:
                    self._add("undervoltage_start" if cur["uv"] else "undervoltage_end", {})
                    changed = True
                if cur["th"] and cur["th"] != p["th"]:
                    self._add("throttle_flags", {"from": p["th"], "to": cur["th"]})
                    changed = True
                for port in p["usb"].keys() - cur["usb"].keys():
                    self._add("usb_removed", {"port": port, "id": p["usb"][port][0], "product": p["usb"][port][2]})
                    changed = True
                for port in cur["usb"].keys() - p["usb"].keys():
                    self._add("usb_added", {"port": port, "id": cur["usb"][port][0], "product": cur["usb"][port][2]})
                    changed = True
                for port in cur["usb"].keys() & p["usb"].keys():
                    if cur["usb"][port][1] != p["usb"][port][1]:
                        self._add("usb_reenumerated", {"port": port, "id": cur["usb"][port][0], "product": cur["usb"][port][2]})
                        changed = True
                for ifc, idx in cur["wifi"].items():
                    if ifc in p["wifi"] and p["wifi"][ifc] != idx:
                        self._add("wifi_interface_recreated", {"iface": ifc})
                        changed = True
                for name, pid in cur["helpers"].items():
                    if name in p["helpers"] and p["helpers"][name] != pid:
                        self._add("capture_helper_restarted", {"helper": name})
                        changed = True
                for name in p["helpers"].keys() - cur["helpers"].keys():
                    self._add("capture_helper_stopped", {"helper": name})
                    changed = True
            self.prev = cur
            if changed:
                self._save()

    def _save(self):
        tmp = self.path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(list(self.events)))
            os.replace(tmp, self.path)
        except OSError:
            pass

    def history(self):
        with self.lock:
            return list(self.events)

    def trend_points(self):
        return list(self.trend)

    def run(self):
        while True:
            try:
                self.step()
            except Exception:  # noqa: BLE001 - the sampler must never take the logger down
                pass
            time.sleep(self.interval)


if __name__ == "__main__":
    print(json.dumps(collect()))
