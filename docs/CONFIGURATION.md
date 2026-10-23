# Configuration reference

Archimet deliberately keeps package code, Pi configuration, Kismet configuration, server data and browser preferences in different places. Editing the web files is not how you configure a capture source or an account.

## Quick map

| Change | Where | Apply/check |
|---|---|---|
| Wi-Fi and Bluetooth capture sources | `/etc/kismet/kismet_site.conf` or Sources UI | `sudo systemctl restart kismet` after file edits; inspect Sources |
| Kismet engine settings used by Archimet | `/etc/archimet/kismet-archimet.conf` | Restart `kismet`; run `sudo archimet-selftest` |
| Service account, data path and listener URLs | `/etc/default/archimet` | Restart affected services; run self-test |
| LE vendor rules in a source checkout | `shared/le_rules.json` | Build/deploy a reviewed package; the logger loads installed `/usr/share/archimet/le_rules.json` |
| User name and password | Settings account action; Kismet owns the account file | Sign in again; `sudo archimet-account status` |
| Local HTTPS certificates | `sudo archimet-tls init`, `renew`, `status` | Check second-device browser trust |
| Optional new hotspot | `archimet-setup hotspot` commands | Inspect `sudo archimet-setup hotspot status`; keep a separate capture radio |
| Tag colours, columns, panel layout, notification switches | Web Settings and table controls | Saved per browser; no service restart |
| Kismet version policy | Archimet package version, apt pin and hold | `sudo archimet-hold status`; see [Updates](UPDATES.md) |

## Capture sources

Run `sudo archimet-setup detect` before naming an interface. In `/etc/kismet/kismet_site.conf`, use only a dedicated capture interface; do not select the onboard `wlan0` or the interface carrying the hotspot/network connection. The package does not rewrite this file. A source can also be added or opened from Sources, subject to Kismet's API and authentication. Sources lists detected hardware separately from active Kismet sources. [Hardware](HARDWARE.md) gives examples.

## Runtime settings

`/etc/default/archimet` is created once and retained on package upgrades. On a fresh install it identifies the service account (`ARCHIMET_USER`), storage directory (`ARCHIMET_OUT`), Kismet account file (`ARCHIMET_CREDS`), rules (`ARCHIMET_RULES`), and loopback addresses for Kismet (`ARCHIMET_API` / `ARCHIMET_KISMET_URL`) and logger (`ARCHIMET_HTTP` / `ARCHIMET_LOGGER_URL`). The gateway binds port `2501` via `ARCHIMET_GATEWAY_BIND`. Do not expose Kismet or the logger directly to the network. A migrated Pi can have different user and data paths; read its actual file.

The package's Kismet override at `/etc/archimet/kismet-archimet.conf` sets its loopback web server and Archimet web root, disables packet/handshake logging, and applies session/remote-capture settings. The systemd drop-in loads it with Kismet's `--override`; the package does not edit upstream-owned Kismet configuration files. Changes here can affect security and data collection, so inspect the file and rerun self-test after an edit.

## Account and first use

The fresh-install default is `archimet/archimet`, but it is **setup-only**. While that password still works, the gateway accepts setup only on the Pi's loopback interface (or an SSH tunnel), blocks data routes and refuses LAN/hotspot clients. Choose a different password of at least 10 characters; the user name can also change. After setup, HTTPS must be active before the gateway serves network clients. An upgrade retains an existing Kismet account. `sudo archimet-account status` reports whether setup finished without printing secrets; `sudo archimet-account reset` returns to setup mode and ends sessions. The password is stored in Kismet's private account file, not in browser preferences. See [Security](SECURITY.md) and [Install](INSTALL.md).

## HTTPS and hotspot

The package attempts to create a local CA and server certificate once during installation. `sudo archimet-tls status` shows the covered names/IP addresses; `sudo archimet-tls renew` handles a changed address or renewal. Trust the public CA certificate on each device that browses the Pi. If TLS setup fails, the gateway remains loopback-only. [HTTPS](HTTPS.md) has the procedure. The optional hotspot is disabled by default and never takes over an existing profile; see [Hotspot](HOTSPOT.md).

## Stored data and browser-only settings

`ARCHIMET_OUT` contains selected SQLite metadata logs and event history. Kismet keeps its own device names/notes and account under the service user's `.kismet` directory. Archimet does not store packet captures in its shipped configuration. The Archive shows saved rows; a database file should be backed up with SQLite's backup API before direct inspection. UI preferences such as tag colours and column widths live in browser storage. Clearing them resets appearance, not Pi databases. See [Data](DATA.md).
