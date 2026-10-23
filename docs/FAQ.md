# Frequently asked questions

## Is Archimet a fork of Kismet?

No. Archimet installs its own UI, gateway, logger and tools alongside the exact tested upstream `kismet-core`, `kismet-capture-linux-wifi` and `kismet-capture-linux-bluetooth` packages. Kismet still captures and decodes radio traffic. [Architecture](HOW-IT-WORKS.md) and [Comparison](COMPARISON.md) show the boundary.

## What is actually better or different?

Archimet adds a workflow for examining possible law enforcement equipment: evidence tags, persistent LE history, Review decisions, one-hop associations, selected logs, a focused current-run Devices view, and Pi power/source diagnostics. These are Archimet features, not an improvement to Kismet's underlying RF sensitivity or protocol decoders. Kismet remains preferable when you need its broader protocol and capture/export tools.

## Can it tell me that police are nearby?

No. It can show radio observations and reasons a device may match an LE-equipment rule. An OUI says something about the registered manufacturer, not the owner or use. A model-name tag is only as reliable as what the radio advertised. An old LE record is not proof of present activity. [LE detection](LE-DETECTION.md) explains the evidence levels.

## Why did a phone or hotspot not appear?

A source may not be running; the adapter may be on another channel, unable to receive the band, out of range, underpowered or receiving no relevant frames. A phone may broadcast Bluetooth while its Wi-Fi hotspot is missed. First verify Sources, power and channel coverage. A running source does not guarantee every nearby device will appear. [Hardware](HARDWARE.md).

## Is capture passive?

Wi-Fi monitor-mode capture is passive in the shipped configuration. Kismet's Linux Bluetooth helper performs **active scanning**. Leave the Bluetooth source unconfigured if you need a Wi-Fi-only passive setup. [Kismet Bluetooth documentation](https://www.kismetwireless.net/docs/readme/datasources/bluetooth-hci-bluetooth/).

## Does Archimet use the Pi's hotspot radio for capture?

It reserves onboard `wlan0` and detected hotspot radios. Capture requires a separate adapter. The optional hotspot is disabled by default, and installation does not alter an existing hotspot profile. [Hotspot](HOTSPOT.md).

## What survives a restart?

Devices, SSIDs, Channels and Alerts reflect Kismet's current run. LE History, Review and Archive read Archimet's stored metadata across runs. Kismet stores its own device names/notes separately. A prior record can be marked "seen before" without being on air now. [Data](DATA.md).

## Where are settings and data?

Capture sources: `/etc/kismet/kismet_site.conf`. Archimet service settings: `/etc/default/archimet`. Kismet override: `/etc/archimet/kismet-archimet.conf`. Data directory: the actual `ARCHIMET_OUT` value. Browser visual preferences: Settings in that browser. [Configuration](CONFIGURATION.md) and [Repository map](REPOSITORY.md).

## What are the first credentials?

A fresh package provisions `archimet/archimet` **only for setup**. You must connect from the Pi or an SSH tunnel and change the password (and optionally the user name) before network clients can use the gateway. The package attempts local HTTPS setup; a trusted HTTPS connection is required for LAN/hotspot use. Existing Kismet accounts are kept on upgrade. [Install](INSTALL.md) and [HTTPS](HTTPS.md).

## Will a Kismet update restore its old UI or break Archimet?

Routine apt upgrades hold the exact tested Kismet packages and Archimet's UI is served by its own gateway. A deliberate administrator override can still change packages. To adopt a new Kismet version, test it with Archimet and release a new Archimet package. No project can guarantee compatibility with an untested future engine. [Updates](UPDATES.md).

## Does a `.deb` make it public on the internet?

No. A `.deb` is an installable file. Archimet's gateway is intended for local networking or an optional local hotspot; publishing a file on GitHub does not open a Pi to the internet. Do not configure router port forwarding to the Pi. [Security](SECURITY.md).

## Can I search the databases?

The Archive screen provides authenticated, read-only search, sort and paging **per table**. The logger API has a combined-table search endpoint, but the current UI has no arbitrary multi-table selector. Direct SQLite inspection is possible from a private backup. [Data](DATA.md).

## Is this release ready to install from GitHub?

Yes: [v5.3.0-2](https://github.com/Archin3t/Archimet/releases/tag/v5.3.0-2) has the `.deb`, the exact Kismet packages and checksums, and the [Install](INSTALL.md) guide uses only those. [Status](STATUS.md) lists the hardware checks still open.
