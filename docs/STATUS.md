# Release status

**The public GitHub Release is a source preview, not an approved installer.** Archimet 5.3.0-1 remains a local package candidate; do not publish its `.deb` or treat it as production ready yet. The reference Pi still runs Archimet 5.2.0-2. The candidate uses upstream Kismet 2025-09-R1 packages as exact dependencies.

The 5.3 candidate passed isolated arm64 apt-policy tests, gateway write tests, first-run setup tests, an unauthenticated route audit and an API compatibility check. These are valuable checks, but they do not prove a fresh user installation on Pi hardware. The source implements a setup-only `archimet/archimet` account, mandatory password change and local HTTPS gate; those flows still need real-device verification.

The outstanding release gates are: a clean install from documented assets on a freshly imaged supported Pi; migration and reboot on the reference Pi; stable capture power without under-voltage; investigation of the `rtw88` channel-hop warnings; real-phone layout; hotspot separation; local HTTPS from another device; and review of the public source/package for secrets, licensing and install reproducibility. The Archive UI currently exposes individual tables; its combined-table API is not yet a multi-select UI. Do not claim that interface feature is complete.

Each release should carry exact package versions, checksums, test results and known limits. Current private Pi measurements and backup details remain outside the proposed public repository.
