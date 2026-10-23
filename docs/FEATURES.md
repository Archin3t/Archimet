# Features and data sources

Archimet is a focused interface and data layer over Kismet, built around inspecting possible law enforcement equipment with explicit evidence and persistent history. The descriptions below refer to the local 5.3.0-1 candidate. See [release status](STATUS.md) before treating a feature as verified on a fresh Pi installation. [LE detection](LE-DETECTION.md) explains what every label can and cannot establish.

## Capture and device views

Kismet and its Linux Wi-Fi/Bluetooth helpers discover radio devices and expose their observations through an API. Archimet shows devices from **the current Kismet run**. Its default Devices order is newest last-heard time first; stronger signal breaks equal-time ties within a page. Search accepts names, SSIDs, manufacturers and MAC addresses in common formats. The view control combines radio/source scope with selectable categories, including Wi-Fi access points, Wi-Fi clients and Bluetooth devices. A source count is the number Kismet reports running, not a promise that every nearby transmission was received.

The inspector combines identity, radio readings, Wi-Fi relationships, Kismet names and notes, Archimet evidence, and available raw fields. A channel/frequency disagreement is labelled *band unverified* unless the measurements actually establish a conflict. An absent reading stays unknown. Devices without a recent observation are not called on air. Kismet's source, channel and alert endpoints drive the Sources, Channels and Alerts views; repeated alerts are grouped in the interface.

Wi-Fi capture needs a separate monitor-mode adapter. Kismet's Linux Bluetooth helper actively scans; Bluetooth operation is **not** fully passive. The Pi's onboard `wlan0` is reserved from capture, including when it serves a hotspot. Adapter capability, channel coverage, dwell time, interference and power all affect what appears. Archimet cannot guarantee that every device is detected.

## LE evidence and Review

The persistent LE log accepts three evidence types: an equipment-vendor MAC-prefix rule, an operator mark with a note, or a one-hop learned relationship with Kismet data-frame evidence. A vendor prefix identifies a manufacturer; it does **not** prove police ownership, use, or the exact product subtype. Equipment subtype tags such as Body cam or Taser require a model name broadcast by the device itself. Learned devices cannot teach further devices. Weak names, associations without data frames, and ambiguous fleet vendors enter Review instead of the LE log. Review records reasons, sightings, watch state and decisions. Operators can mark or unmark devices; the logger retains an audit trail. Older LE rows remain in LE History across Kismet restarts, while the main Devices list stays scoped to the current run.

The rules live in [`shared/le_rules.json`](../shared/le_rules.json). An automatic Review policy can deprioritize weak or stale leads and reopen a row when new evidence arrives. It does not infer certainty from a badge or vendor label. See [data layout](DATA.md) for the destinations of each record.

## Archive and logging

The Archive reads stored access-point, non-randomized Wi-Fi client, LE and Review tables through an authenticated, read-only API. The current **UI has individual table views** with search, sort and paging. The logger API has a combined-table search endpoint, but an arbitrary multi-table selection is not exposed in the current screen. A name/tag/notes store is maintained by Kismet separately. Archimet's logger keeps one row per MAC within each relevant log and updates changed values; a MAC in two different tables represents two distinct facts. Packet captures, payloads and handshakes are disabled in the Archimet Kismet configuration. Read [what is stored](DATA.md) before using the tool with real data.

## Operations and interface

The status strip and System screen combine Kismet server/PHY statistics with Pi CPU, memory, temperature, disk, USB and power flags when the hardware reports them. Missing sensors are labelled unavailable. Sources shows configured Kismet capture helpers, interface/driver state, packet counts and errors; supported source controls change Kismet's current source state. Settings cover display preferences, device markers, notifications, account actions, compatibility checks and About/credits. Column widths and panel layout are saved per browser. A fresh installation starts with a setup-only `archimet/archimet` account; the gateway blocks data and network clients until the password is changed. Existing Kismet accounts carry across upgrades. Local HTTPS is created when possible during install and required for network access; the hotspot is off by default.

## What the release still needs

The 5.3 candidate passed isolated package and API tests, but it has **not** been installed on the reference Pi or tested from a fresh Pi image. The live Pi remains on 5.2. Power undervoltage, a noisy `rtw88` channel-hop warning, real-phone layout, hotspot access and end-to-end HTTPS remain release gates. [Read the current status](STATUS.md). No feature in this page should be read as a claim that those gates have passed.
