# Recovery

Every procedure here aims to keep your data. Before a recovery, make and verify a private,
consistent [off-Pi backup](DATA.md#backups) whenever the Pi still answers. This repository does
not include the reference Pi's backup utility or credentials.

## First look

```
sudo archimet-selftest                    # what is wrong, check by check
systemctl status kismet archimet-logger archimet-gateway
journalctl -u kismet -u archimet-logger -u archimet-gateway --since -1h
archimet-hold status                      # tested vs installed Kismet versions, holds
```

| Symptom | Likely cause | Action |
|---|---|---|
| Page does not load on :2501 | gateway stopped | `sudo systemctl restart archimet-gateway`; journal |
| Page loads, every panel "not answering" (502) | Kismet or the logger is down | `sudo systemctl restart kismet archimet-logger` |
| Kismet keeps restarting | a capture source fails, or the configuration is wrong | `journalctl -u kismet`; check `source=` lines in `/etc/kismet/kismet_site.conf` (never a hotspot radio) |
| Kismet's stock interface appears | the Archimet drop-in is missing (archimet removed?) | `systemctl cat kismet` must show `--override /etc/archimet/kismet-archimet.conf`; reinstall archimet, or `sudo systemctl disable --now kismet` |
| `archimet-compat` fails | Kismet is not the tested version | `archimet-hold status`; go back to the tested version (below) |
| Logger: 401 from Kismet | account changed or credentials file moved | `ARCHIMET_CREDS` in `/etc/default/archimet`; the logger re-reads it each poll |
| Capture adapter drops out | power (under-voltage), USB or driver | Check System power flags and kernel/Kismet logs; use a proper Pi supply and consider a powered USB hub for the adapter |
| LAN/hotspot page says setup is unfinished | default account still active | From the Pi or an SSH tunnel, sign in as `archimet/archimet` and choose a new password; `archimet-account status` |
| LAN/hotspot page is unavailable after setup | missing/expired HTTPS certificate or address mismatch | `archimet-tls status`; `sudo archimet-tls init` or `renew`; trust the public CA on the browser device |

## Kismet was upgraded outside the policy

If someone overrode the holds and Kismet is now an untested version:

```
sudo archimet-hold release                  # apt refuses to change held packages, even downwards
sudo apt install --allow-downgrades ./kismet-core_2025-09-R1_arm64.deb \
     ./kismet-capture-linux-wifi_2025-09-R1_arm64.deb ./kismet-capture-linux-bluetooth_2025-09-R1_arm64.deb
sudo archimet-hold apply
sudo archimet-selftest
```

Use verified `.deb` assets from the matching approved release; a future release should include
their checksums and a rollback copy. A downgrade is always deliberate: the pin never downgrades
on its own. There is no approved public 5.3 installer yet; the current GitHub Release is a source preview.

## Going back to the previous Archimet release

Release the holds with `sudo archimet-hold release`, then install the previous Archimet `.deb`
**together with its exact tested Kismet `.deb` files** in one apt command. Use
`--allow-downgrades` only after reading apt's proposed changes. Finally run
`sudo archimet-hold apply` and `sudo archimet-selftest`.

Data stays as it is. The logger only ever adds tables and columns, so an older logger reads newer
databases (it ignores what it does not know).

## Forgotten password

The account is Kismet's. The recovery command preserves an owner-only copy of the old credential
file, resets to the setup-only default, and restarts Kismet and the gateway:

```
sudo archimet-account reset
archimet-account status
```

The gateway now blocks network clients until the default password is changed. From a browser on
the Pi or an SSH tunnel to `https://localhost:2501/`, sign in as `archimet/archimet`, choose a new
password and optionally a new user name. Names, notes and logs are untouched.

## Restoring data from a backup (same or new Pi)

There is no universal restore command because `ARCHIMET_OUT`, the service account, and backup
layout can differ. Verify the archive's checksum and inspect its paths **before** writing to the
Pi. Install the matching Kismet and Archimet versions; stop `archimet-gateway`, `archimet-logger`
and `kismet`; restore consistent SQLite copies to the directory in `/etc/default/archimet`; and
restore the relevant Kismet account/names files and `/etc/kismet/kismet_site.conf` with correct
ownership and private file modes. Restore the TLS CA/key only from a trusted private backup.
Start the services, run `sudo archimet-selftest`, inspect database `PRAGMA integrity_check`, and
test login and a known source. Keep the original backup until the restore is verified.

## Removing Archimet

`sudo apt remove archimet` stops the gateway and logger, **stops and disables `kismet.service`**
(without Archimet's drop-in it would serve Kismet's stock interface on the network) and keeps all
data. `purge` also removes `/etc/default/archimet` and the service drop-ins; data,
Kismet and Kismet's per-user files are still kept. The Kismet packages stay installed and held:
`sudo apt-mark unhold kismet-core kismet-capture-linux-wifi kismet-capture-linux-bluetooth` if you
want them to update.

## Migration from Archimet 5.2 (engine bundled) to 5.3 (upstream Kismet)

Archimet 5.2 shipped Kismet's binaries in its own package. 5.3 depends on the upstream packages
instead. The step should be recorded in the 5.3 release report. Keep the earlier package assets
and a verified off-Pi data backup until migration is validated.
