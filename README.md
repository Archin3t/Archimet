# Archimet

**A Raspberry Pi radio monitor with a focused workflow for finding and examining signals from law enforcement equipment.** Archimet combines the [Kismet](https://www.kismetwireless.net/) capture engine with its own web interface, evidence rules, persistent history, review tools, and Pi health monitoring. It is made by [Archinet](https://github.com/archin3t).

Archimet grew from a practical gap: general radio monitoring could show nearby Wi-Fi and Bluetooth devices, but it did not provide a clear way to collect, revisit, and assess *possible law enforcement equipment* across capture runs. Archimet organizes those observations and shows why each device was flagged. It does not identify an officer, prove ownership, or promise to detect every device.

> **Release status:** The 5.3.0-1 package in this repository is a local candidate. It has passed isolated tests, but a clean installation and migration on the reference Pi, capture-power retest, phone layout, hotspot and second-device HTTPS checks remain open. There is no public release yet. See [release status](docs/STATUS.md).

## What it does

- **Monitor nearby radios:** current-run Wi-Fi access points, Wi-Fi clients, Bluetooth LE and Classic devices from Kismet's configured sources. Search, filter, sort, inspect and resize the views; Devices starts with the most recently heard devices, then stronger signal for ties.
- **Investigate equipment evidence:** distinguish an equipment-vendor MAC prefix, a model name actually advertised by a device, an operator mark, and a data-frame-backed association. The LE log keeps the evidence and history. Weaker or ambiguous leads go to Review.
- **Keep useful history:** LE History and selected access-point/client logs persist across restarts. Archive offers authenticated, read-only browsing of each stored table. The main Devices list remains scoped to the current Kismet run.
- **Operate the Pi:** see configured and detected capture sources, channel activity, grouped alerts, hardware status, temperatures, power warnings and storage. A newly plugged-in adapter is shown as hardware; capture begins only after a Kismet source is added and opened.
- **Use it locally:** Archimet serves its own interface over a local HTTPS gateway. An optional hotspot can provide field access and is disabled by default. A dedicated capture adapter keeps the Pi's onboard networking/hotspot radio out of monitor mode.

[Explore the screens](docs/USER-GUIDE.md) · [How LE evidence works](docs/LE-DETECTION.md) · [Full feature list](docs/FEATURES.md)

## How it works

```text
Wi-Fi adapter / Bluetooth controller
             │
             ▼
Upstream Kismet engine + capture helpers ── current-run devices and radio data
             │  loopback API (:2500)
             ├──────────────────────────────► Archimet gateway (:2501) ◄── browser
             │                                      ▲
             ▼                                      │
Archimet logger ── selected SQLite metadata ──────┘
                 loopback API (:2502)
```

Kismet handles radio capture and decoding. Archimet adds the web UI, classification and review workflow, selected logs, hardware metrics, and a gateway that exposes only the API routes it uses. The package depends on **exact tested Kismet versions**; it contains no forked Kismet engine or stock Kismet web UI. Kismet updates are held until an Archimet release tests and adopts them. [Read the architecture](docs/HOW-IT-WORKS.md) and [comparison with Kismet](docs/COMPARISON.md).

## Hardware and first installation

The current target is a **Raspberry Pi 3B+ running 64-bit Raspberry Pi OS / Debian 13 (trixie)**, a stable power supply, and a separate monitor-mode Wi-Fi adapter for Wi-Fi capture. A Linux Bluetooth controller is optional; Kismet's Bluetooth source performs **active scanning**. GPS is optional. Other boards, radios and OS versions need their own validation. [Hardware and radio guide](docs/HARDWARE.md).

The proposed installation uses a downloadable Archimet `.deb` plus the exact tested upstream Kismet packages. It does not add an Archimet apt feed or upgrade Kismet automatically. On a fresh install, `archimet/archimet` is a **setup-only** account: sign in locally or through an SSH tunnel and change the password before the gateway opens to LAN/hotspot clients. Network access also requires a local HTTPS certificate. [Installation guide](docs/INSTALL.md).

## Start reading

| Need | Guide |
|---|---|
| Install or build | [Installation](docs/INSTALL.md) · [Hardware](docs/HARDWARE.md) |
| Understand the components and repository | [How it works](docs/HOW-IT-WORKS.md) · [File map](docs/REPOSITORY.md) |
| Use the interface | [User guide](docs/USER-GUIDE.md) · [Features](docs/FEATURES.md) |
| Understand LE labels and limits | [LE detection](docs/LE-DETECTION.md) · [Kismet comparison](docs/COMPARISON.md) |
| Configure account, radios, data and display | [Configuration](docs/CONFIGURATION.md) · [Data](docs/DATA.md) |
| Configure field access | [Hotspot](docs/HOTSPOT.md) · [Local HTTPS](docs/HTTPS.md) |
| Maintain or troubleshoot | [Updates](docs/UPDATES.md) · [Recovery](docs/RECOVERY.md) · [FAQ](docs/FAQ.md) |
| Review safety and release readiness | [Security model](docs/SECURITY.md) · [Release status](docs/STATUS.md) · [Security reports](SECURITY.md) |

## Credits and licence

Archimet is by Archinet. The upstream Kismet engine and capture helpers are by Mike Kershaw (Dragorn) and contributors. See [NOTICE.md](NOTICE.md) for the component boundary and [LICENSE](LICENSE) for Archimet's GPL v2 licence text. No upstream Kismet files are copied into this repository's package candidate.
