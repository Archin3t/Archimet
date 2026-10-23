# Repository map

This directory is the **public source tree** intended for GitHub. It contains Archimet code, packaging, tests and documentation. It is not a Pi backup, a capture archive, or a place for credentials. The `.gitignore` is an allowlist: new files are not tracked until reviewed and explicitly added.

| Path | Purpose | Where it goes when packaged |
|---|---|---|
| `README.md`, `LICENSE`, `NOTICE.md`, `SECURITY.md` | Project entry point, licence, upstream credits and vulnerability reporting | Documentation |
| `docs/` | Installation, operation, design, evidence, security and maintenance guides | Selected guides in `/usr/share/doc/archimet/` |
| `ui/index.html`, `ui/css/`, `ui/js/`, `ui/assets/` | The entire browser interface | `/usr/share/archimet/www/` |
| `ui/js/views/` | Screens: Devices, LE, Review, Archive, Sources, Channels, System, Settings | Inside the web root |
| `ui/js/api/` | Gateway/Kismet/Archimet API clients and compatibility contract | Inside the web root |
| `ui/js/lib/` and `ui/js/ui/` | Classification display, filters, sorting, tags, charts, tables, inspector, login and layout | Inside the web root |
| `pi/kismet-device-logger` | Polls Kismet, classifies LE/Review evidence, writes selected SQLite logs and serves the logger API | `/usr/lib/archimet/` |
| `pi/archimet-gateway` | HTTPS entry point, setup gate, sessions, static UI and narrow API proxy | `/usr/lib/archimet/` |
| `pi/archimet_metrics.py` | Pi CPU, thermal, power, storage and USB readings | `/usr/lib/archimet/` |
| `pi/archimet-setup`, `pi/archimet-tls`, `pi/archimet-account`, `pi/archimet-hold`, `pi/archimet-selftest`, `pi/archimet-compat` | Setup, certificates, account recovery, version holds and diagnostics | `/usr/lib/archimet/`, with admin command links in `/usr/sbin/` |
| `shared/le_rules.json` | Versioned equipment-vendor rules | `/usr/share/archimet/le_rules.json` |
| `packaging/` | Debian control scripts, systemd units, Kismet override, tested-version hashes, `.deb` builder | Used to build the package |
| `tools/package.py` | Stages only reviewed source, UI and docs for a package build | Development tool; not a browser feature |
| `tests/` | Unit and behavior checks for the gateway, logger, UI and setup | Test source; not a runtime service |

## Installed layout

```text
/usr/share/archimet/www/                 Archimet web UI
/usr/share/archimet/le_rules.json       equipment rules
/usr/lib/archimet/                      gateway, logger, metrics and admin programs
/etc/archimet/kismet-archimet.conf      Kismet override for Archimet
/etc/default/archimet                   account, data directory and service addresses
/etc/kismet/kismet_site.conf            capture sources (Kismet file; Archimet does not rewrite it)
/etc/archimet/tls/                      private local CA and HTTPS certificate
/var/lib/archimet/                      default service account home on a fresh install
```

Data is normally in the account home's `archimet-logs/`, or an existing `kismet-logs/`, as set by `ARCHIMET_OUT`. A migrated installation can use a different account and location. Check `/etc/default/archimet` on the actual Pi rather than assuming a path. See [Configuration](CONFIGURATION.md) and [Data](DATA.md).

## Code path for a common change

- **A web label or layout:** edit `ui/`, then run the relevant UI tests and package staging. Browser preferences are separate from server configuration.
- **An LE vendor rule:** edit `shared/le_rules.json`; inspect rule tests and the logger's rule validation before distributing it. Rules are evidence definitions, not owner-identification claims.
- **Capture sources:** edit `/etc/kismet/kismet_site.conf` on the Pi or use the Sources UI, then verify Kismet reports them running. Never select the radio carrying networking or the hotspot.
- **An installed service setting:** change `/etc/default/archimet` or `/etc/archimet/kismet-archimet.conf` as documented; restart the affected service and run `archimet-selftest`.
- **A new Kismet version:** follow [Updates](UPDATES.md), update exact package requirements and hashes, run compatibility tests, and publish a new Archimet release only after hardware verification.

The package excludes the stock Kismet UI and leaves upstream Kismet-owned files alone. Removing a `.deb` does not mean deleting your separate databases; follow [Recovery](RECOVERY.md) for backups and rollback.
