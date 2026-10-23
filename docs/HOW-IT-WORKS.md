# How Archimet works

Archimet is an application around upstream Kismet, not a replacement radio decoder. [Kismet's Linux Wi-Fi helper](https://www.kismetwireless.net/docs/readme/datasources/wifi-linux/) reads frames from a supported monitor-mode adapter. [Kismet's Linux Bluetooth helper](https://www.kismetwireless.net/docs/readme/datasources/bluetooth-hci-bluetooth/) actively scans a Bluetooth controller and reports discovered attributes. Kismet merges observations into its in-memory device list and provides REST APIs. Archimet reads those APIs, presents its own interface, and writes selected metadata to its own databases.

## The path from a radio to the screen

1. A capture source is configured in `/etc/kismet/kismet_site.conf` or opened through the Sources UI. A detected USB adapter alone is **not** an active Kismet source. Kismet reports each source's state, packet count and errors through its [datasource API](https://www.kismetwireless.net/docs/api/datasources/).
2. Kismet's capture helpers provide radio observations to Kismet. Archimet does not decode raw frames independently. Source capabilities, channel hopping, dwell, device transmission and reception quality determine what Kismet can see.
3. The web UI requests [current-run Kismet device views](https://www.kismetwireless.net/docs/api/devices/) through the Archimet gateway. That is why Devices, SSIDs and other live views reset when Kismet restarts. A remembered record does not become an on-air device merely because it is in a database.
4. Archimet's logger polls Kismet, classifies LE equipment evidence and Review leads, and updates selected SQLite metadata logs. It also exposes a read-only Archive API and collects Pi hardware metrics. LE History and Archive survive Kismet restarts.
5. The gateway on port `2501` serves Archimet's web files and forwards an allowlist of API routes. Kismet's own API on `127.0.0.1:2500` and the logger on `127.0.0.1:2502` are not network-facing. Kismet's stock web pages are not served by the gateway.

## Responsibilities

| Component | Owns | Does not own |
|---|---|---|
| Upstream `kismet-core` and Linux capture helpers | Radio capture, protocol parsing, live device/source/alert APIs, account and names/notes | Archimet screens, LE classification and Archimet SQLite logs |
| `pi/kismet-device-logger` | Selected AP/client history, LE and Review evidence, Archive API, hardware events | Packet capture or raw-frame decoding |
| `pi/archimet-gateway` | HTTPS, setup gate, UI delivery and allowed API proxy | Kismet's credential store or radio control logic |
| `ui/` | Devices, LE History, Review, Archive, radio, System and Settings views | Durable server data or capture |
| `pi/archimet-setup` | Optional hotspot operations and radio role detection | Changes to an existing hotspot during package install |

## What persists

Archimet's AP, client, LE and Review records live under `ARCHIMET_OUT`, set in `/etc/default/archimet`. Kismet separately stores its account and operator names/notes. Display preferences such as columns and tag colours live in each browser. [Data layout](DATA.md) lists exact files, screens and retention.

## Kismet upgrades

Archimet depends on three **exact tested** upstream Kismet package versions. The package applies apt pins and holds so routine apt upgrades do not silently replace the engine. A maintainer must test a newer Kismet release, update Archimet's compatibility requirements and publish a new Archimet package. This prevents an untested engine from silently taking over, but it also delays upstream fixes until adopted. [Update policy](UPDATES.md) explains the tradeoff and recovery path.

## Scope and limits

Archimet specializes in inspecting Wi-Fi and Bluetooth observations. It cannot reveal a radio that never transmits in a receivable way, overcome unsupported hardware, or establish who owns a device from a vendor prefix. A source count reports Kismet's source state, not guaranteed coverage. LE labels describe an evidence trail; read [LE detection](LE-DETECTION.md) before interpreting them.
