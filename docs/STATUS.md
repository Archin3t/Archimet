# Release status

**[v5.3.0-2](https://github.com/Archin3t/Archimet/releases/tag/v5.3.0-2) is the current release.** Its assets (Archimet `.deb`, the three exact upstream Kismet 2025-09-R1 packages, `SHA256SUMS`, Kismet source and licence notice) are what the install guide uses. Published assets are never replaced under the same version; fixes ship as a new version.

v5.3.0-1 (prerelease) was superseded after its installation trial on the reference Pi found two faults, both fixed in 5.3.0-2: the logger crashed on a fresh install (a developer home-folder path), and a Wi-Fi lock file left in `/tmp` by an older Kismet running as another account blocked capture. The self-test also now reports the setup lock correctly instead of as many failures.

The 5.3 candidate passed isolated arm64 apt-policy tests, gateway write tests, account / setup-lock / HTTPS tests against a real Kismet, an unauthenticated route audit and an API compatibility check. These are valuable checks, but they do not prove a fresh user installation on Pi hardware.

Still open on hardware: stable capture power without under-voltage over several days; the `rtw88` channel-hop warnings on 5 GHz channel 165; real-phone layout review; hotspot failover (on when Ethernet is unplugged, off when it returns); local HTTPS from a second device; and a clean install on a freshly imaged Pi (the reference Pi was cleaned of the old installation, not reimaged).

Each release should carry exact package versions, checksums, test results and known limits. Current private Pi measurements and backup details remain outside the proposed public repository.

## Files required for an installable release

An installable GitHub Release must contain the tested Archimet arm64 `.deb` and its SHA-256 checksum. It must identify the exact three Kismet package versions and their verified hashes. If those versions are no longer downloadable from the signed Kismet repository, the release must also provide the corresponding unmodified upstream `.deb` files and matching source information. The release notes must state the supported Pi/OS, fresh-install and migration results, known limits, and a rollback path. The [installation guide](INSTALL.md) must be checked against those actual assets before the release is called installable.
