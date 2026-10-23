# Updates: tested Kismet versions only

Archimet runs on the **upstream Kismet packages** from the official, signed Kismet repository. It
does not fork, patch, bundle or rebuild Kismet. Each Archimet release is tested against exact
Kismet package versions, and a Pi running that release stays on exactly those versions until a new
Archimet release has been tested with newer ones.

## Compatibility matrix

| Archimet | kismet-core | kismet-capture-linux-wifi | kismet-capture-linux-bluetooth | OS / arch | Status |
|---|---|---|---|---|---|
| 5.3.0-1 | 2025-09-R1 | 2025-09-R1 | 2025-09-R1 | Debian 13 "trixie" / Raspberry Pi OS (trixie), **arm64**, Raspberry Pi 3B+ | isolated arm64 tests passed; fresh Pi installation and 5.3 migration **not yet tested** |
| 5.3.0-1 | 2025-09-R1 | 2025-09-R1 | 2025-09-R1 | trixie amd64 | **not tested**; the upstream packages exist, Archimet is not built for amd64 |
| 5.3.0-1 | — | — | — | trixie armhf (32-bit) | **unavailable**: the Kismet trixie repository publishes amd64 and arm64 only |
| 5.3.0-1 | — | — | — | Debian 12 "bookworm" and older | **not tested**, not built |

Kismet 2025-09-R1 is git tag `kismet-2025-09-R1`, commit `b5d5a2d04`. The SHA-256 of each tested
upstream package, as published in the signed repository index, is in
`/usr/share/archimet/tested-kismet.sha256` (source: `packaging/tested-kismet.sha256`).

**The Kismet repository keeps only its newest version.** Once Kismet publishes a newer release, apt
can no longer download 2025-09-R1 from it. A future approved Archimet release must therefore make
the three exact, unmodified upstream `.deb` files it was tested with available, with hashes and matching source (NOTICE.md covers the GPL obligation). A missing
version is never replaced by "latest": the install stops (see *What apt does*).

## How the policy is enforced

| Layer | What | Where |
|---|---|---|
| Exact dependency | `Depends: kismet-core (= 2025-09-R1), kismet-capture-linux-wifi (= 2025-09-R1), kismet-capture-linux-bluetooth (= 2025-09-R1)` | the archimet package |
| apt pin | `Pin: version 2025-09-R1`, `Pin-Priority: 1000` for each of the three: keeps them when newer ones appear, never forces a downgrade (only > 1000 would) | `/etc/apt/preferences.d/archimet-kismet` (conffile) |
| apt hold | `apt-mark hold` on the three, applied by `archimet-hold apply` about 20 s after install (apt-mark cannot run inside dpkg), and only if the installed version **is** the tested one | dpkg selection state (survives reboots) |
| No metapackage | Archimet never depends on `kismet` (which pulls every capture helper) | |
| No recommended extras | `kismet-core` *recommends* a dozen other helpers and tools; install with `--no-install-recommends` (INSTALL.md). A package cannot block another package's Recommends, so `archimet-selftest` fails while any untested `kismet*` package is installed | `archimet-selftest` |

OS security updates are unaffected: the pin and the holds name only these three packages.

`archimet-hold status` shows the tested versions, what is installed, whether each is held, and a
**NOTICE** when the repository offers a newer Kismet. That notice is information only.

## What apt does

The measured results for each release are in its release report; this is the designed behaviour.

| Command | Result |
|---|---|
| `apt upgrade` with a newer Kismet in the repository | the three packages are *held back*; Kismet is not upgraded; Archimet stays |
| `apt full-upgrade` | same: held packages are not changed; Archimet is not removed |
| `apt install kismet-core` (explicit) | refused while held; with the holds removed, apt would have to remove archimet (exact `Depends`) and asks first |
| `apt install kismet` (metapackage) | needs the newer core: the same refusal |
| unattended-upgrades | not installed on the reference Pi; if installed, held packages are never upgraded and Kismet's origin is not in its default allowed origins |
| Clean install after 2025-09-R1 left the repository | `archimet : Depends: kismet-core (= 2025-09-R1) but <newer> is to be installed`: the install **stops**. Install the attached upstream `.deb` files first (INSTALL.md) |

`--allow-change-held-packages`, or removing the holds by hand, overrides all of this. Archimet cannot
stop an administrator from doing that; `archimet-selftest` then reports the mismatch.

## Adopting a new Kismet release (maintainers)

A new Kismet release is noted, not installed. Adopting it means a new Archimet release:

1. **Back up**: make and restore-test a private, consistent [off-Pi backup](DATA.md#backups) of the databases, Kismet account/configuration and exact package assets.
2. **Stage**: `apt-get download` the new upstream packages; record their SHA-256 from the signed
   index; set `TESTED` in `packaging/build-deb.sh` and update `packaging/tested-kismet.sha256`.
3. **Audit in isolation**: install the new engine and candidate package in a separate test environment. Run the repository unit tests, `archimet-compat`, apt-policy tests, and authenticated/anonymous route and write checks against that isolated instance. A contract failure means deliberate UI work, never a silent switch. Keep test credentials and captured data outside the repository.
4. **Test on the Pi**: back up; `sudo archimet-hold release`; install the new Kismet packages and the
   new Archimet package together; `sudo archimet-hold apply`; reboot; `sudo archimet-selftest`.
5. **Release** the new Archimet version with its compatibility-matrix row, the attached upstream
   packages and their hashes.
6. **Keep the previous packages** (old Archimet `.deb`, old upstream `.deb` files) for rollback
   (RECOVERY.md).

## Security cost of staying on a tested version

Holding Kismet means a Kismet security fix reaches the Pi only after a new Archimet release. The
exposure is reduced, not removed: Kismet's web server listens on 127.0.0.1 only and is reached
through `archimet-gateway`, which forwards a fixed list of API routes; remote capture is disabled.
The capture helpers still parse untrusted radio frames whatever the web settings. Watch
https://www.kismetwireless.net/ and its git log; treat a Kismet security release that affects the
capture helpers or a route in `pi/archimet-gateway` (`ROUTES`) as urgent.

## Upgrading Archimet itself

Make and verify a private off-Pi backup first ([Data](DATA.md#backups)), then install the tested
new package and run the self-test:

```sh
sudo apt install ./archimet_<new>_arm64.deb
sudo archimet-selftest
```

Archimet has no automatic updates. Database changes are additive (`CREATE TABLE IF NOT EXISTS`); the
logger never drops or rewrites stored rows. Downgrading: RECOVERY.md.
