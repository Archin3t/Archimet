# Release status

**[v5.3.0-1](https://github.com/Archin3t/Archimet/releases/tag/v5.3.0-1) is a prerelease for an installation trial, not a production release.** Its assets (Archimet `.deb`, the three exact upstream Kismet 2025-09-R1 packages, `SHA256SUMS`, Kismet source and licence notice) are what the install guide uses. A failed trial is fixed in a new version (5.3.0-2, …); published assets are never replaced under the same version.

The 5.3 candidate passed isolated arm64 apt-policy tests, gateway write tests, account / setup-lock / HTTPS tests against a real Kismet, an unauthenticated route audit and an API compatibility check. These are valuable checks, but they do not prove a fresh user installation on Pi hardware.

The outstanding release gates are: a clean install from documented assets on a freshly imaged supported Pi; migration and reboot on the reference Pi; stable capture power without under-voltage; investigation of the `rtw88` channel-hop warnings; real-phone layout; hotspot separation; local HTTPS from another device; and review of the public source/package for secrets, licensing and install reproducibility. The requested `archimet`/`archimet` initial login with a forced password change is implemented and tested in isolation; it still needs the fresh-install hardware test.

Each release should carry exact package versions, checksums, test results and known limits. Current private Pi measurements and backup details remain outside the proposed public repository.

## Files required for an installable release

An installable GitHub Release must contain the tested Archimet arm64 `.deb` and its SHA-256 checksum. It must identify the exact three Kismet package versions and their verified hashes. If those versions are no longer downloadable from the signed Kismet repository, the release must also provide the corresponding unmodified upstream `.deb` files and matching source information. The release notes must state the supported Pi/OS, fresh-install and migration results, known limits, and a rollback path. The [installation guide](INSTALL.md) must be checked against those actual assets before the release is called installable.
