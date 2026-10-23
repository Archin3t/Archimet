# Data layout

Archimet keeps its data outside every path a Kismet package owns, so Kismet upgrades, Archimet
upgrades and package removal (even purge) never delete it.

## What is stored, and where

`ARCHIMET_OUT` comes from `/etc/default/archimet`: `~<account>/kismet-logs` when that directory
already exists (the reference Pi: `/home/kismetpi/kismet-logs`), otherwise `~<account>/archimet-logs`.

| File | Contents | Written by | Kept on remove / purge |
|---|---|---|---|
| `$ARCHIMET_OUT/access_points.sqlite` | One row per access point MAC ever logged (`access_points`) | logger | yes |
| `$ARCHIMET_OUT/wifi_clients.sqlite` | Non-randomised Wi-Fi clients (`wifi_clients`); randomised MACs are skipped | logger | yes |
| `$ARCHIMET_OUT/law_enforcement.sqlite` | The LE log, confirmed rows only (`law_enforcement`) | logger, operator marks | yes |
| `$ARCHIMET_OUT/archimet_review.sqlite` | Review (`review`), operator marks (`overrides`), `audit`, `sightings`, `observed`, Review decisions (`resolution`, `resolution_log`), `migration` | logger, operator actions | yes |
| `$ARCHIMET_OUT/le_history.json` | Private JSON copy of the LE log; served only through the signed-in API | logger | yes |
| `$ARCHIMET_OUT/hardware_events.json` | The last 500 power, USB and capture-source events | logger | yes |
| `~<account>/.kismet/kismet_httpd.conf` | The login (Kismet's own account) | Kismet | yes |
| `~<account>/.kismet/devicetracker.db3` | Kismet's device names, tags and notes | Kismet | yes |

The three logs keep their file names, schemas and meanings. They are separate on purpose (different
purposes and retention): a MAC in two of them is two facts, not a duplicate. Schema changes are
additive only (`CREATE TABLE IF NOT EXISTS`, new columns); the logger never drops or rewrites stored
rows.

What is **not** stored: packets, pcap files, payloads, handshakes (`enable_logging=false`,
`dot11_keep_eapol=false` in `/etc/archimet/kismet-archimet.conf`). Kismet's in-memory device list
lasts one capture run (until Kismet restarts).

## Where each screen reads from

| Screen | Source | Scope |
|---|---|---|
| Devices, SSIDs, Channels, Alerts, Messages | Kismet API (through the gateway) | **this capture run** only |
| LE History | `law_enforcement.sqlite` via the logger API, with Kismet's last-heard time | persistent, all runs |
| Review | `archimet_review.sqlite` via the logger API | rows heard in this capture run; the rest are linked to the Archive |
| Archive | each stored table above through an authenticated read-only UI; the logger also has a combined-table API | everything stored, all runs |
| Server / Radios hardware | logger metrics and `hardware_events.json` | live + last 500 events |

"Last observed" is a real observation time: Kismet's `last_time` in this run, or the logger's
minute-precision record. Old rows that only have a date are shown as *date only*; a time is never
invented.

## Configuration (package-managed, survives Kismet upgrades)

| Path | What | On upgrade |
|---|---|---|
| `/etc/archimet/kismet-archimet.conf` | Kismet settings for Archimet (loopback web server, web root, retention), loaded with `--override` | conffile: your edits kept, dpkg asks on conflict |
| `/etc/apt/preferences.d/archimet-kismet` | apt pin to the tested Kismet versions | conffile |
| `/etc/default/archimet` | account, data path, ports | written once, kept; migrated additively (marker `archimet-defaults v2`) |
| `/etc/archimet/tls/` | local CA and Pi HTTPS certificate; private keys stay on Pi | generated once, kept; server certificate can be renewed |
| `/etc/archimet/hotspot.conf` | the radio of an Archimet-created hotspot (optional) | kept |
| `/etc/systemd/system/kismet.service.d/10-archimet-user.conf`, `/etc/systemd/system/archimet-logger.service.d/10-user.conf` | the account the services run as | regenerated from `/etc/default/archimet` |
| `/usr/lib/systemd/system/kismet.service.d/archimet.conf` | vendor drop-in: runs Kismet with `--override /etc/archimet/kismet-archimet.conf` | replaced |
| `/etc/kismet/kismet_site.conf` | capture sources | **never touched** by Archimet |
| `/etc/kismet/*.conf` | Kismet's own configuration | owned by kismet-core; never edited by Archimet |

## Installed program files (replaced on upgrade)

`/usr/share/archimet/www/` (web interface), `/usr/share/archimet/le_rules.json`,
`/usr/share/archimet/tested-kismet.txt` and `tested-kismet.sha256`,
`/usr/share/archimet/no-user-web-root/` (empty: disables Kismet's per-user web root),
`/usr/lib/archimet/` (logger, gateway, metrics,
`archimet-compat`, `archimet-setup`, `archimet-hold`, `archimet-selftest`, `archimet-tls`, `archimet-account`; the admin tools are linked in
`/usr/sbin`), `/lib/systemd/system/archimet-{logger,gateway}.service`,
`/usr/share/doc/archimet/`. The full list ships with each release (`.contents.txt`).

## Backups

Back up the directory named by `ARCHIMET_OUT`, the Kismet account and device-name files, capture
source configuration, TLS CA/key, and the exact installed package assets. Make consistent SQLite
copies with SQLite's backup API while the logger is running, or stop the services before copying.
Keep the archive **off the Pi**, verify its checksums and perform a test restore. It contains the
login and captured metadata, so encrypt it and never commit it to this repository.
