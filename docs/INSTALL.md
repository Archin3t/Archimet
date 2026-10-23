# Installation guide

**Current state:** The public GitHub Release contains source archives, but no approved installable `.deb`. Archimet 5.3.0-1 remains a local package candidate. This guide describes the intended installation from a future approved release. Do not treat isolated tests as proof of a fresh Pi installation; see [Release status](STATUS.md). If you test on your only Pi, first verify an off-Pi backup and a way to restore the previous system.

## Before you start

- Raspberry Pi 3B+, 64-bit Raspberry Pi OS / Debian 13 (trixie), arm64. Other targets are not yet validated.
- Stable power for the Pi and USB radio. For Wi-Fi capture, use a **separate monitor-mode-capable adapter**; reserve onboard `wlan0` for networking or a hotspot. Bluetooth is optional and actively scans when configured. [Hardware guide](HARDWARE.md).
- Ethernet or another reliable way to reach the Pi over SSH during first setup. A browser on the Pi itself also works.
- The approved Archimet `.deb` and checksum, plus the **exact tested** upstream Kismet packages and their hashes if the signed Kismet repository no longer provides that version. No Archimet apt repository is added.
- A private backup if the Pi already has Kismet or Archimet data. Never use a live production SD card as your only migration test.

## 1. Verify the upstream engine version

For 5.3.0-1 the exact dependencies are `kismet-core`, `kismet-capture-linux-wifi` and `kismet-capture-linux-bluetooth`, each version `2025-09-R1`. Archimet does not need the `kismet` metapackage or the other capture helpers. The official Kismet [package page](https://www.kismetwireless.net/packages/) is the authoritative source for its current signing-key and apt setup. For its Debian Trixie **release** repository, it currently gives:

```sh
wget -O - https://www.kismetwireless.net/repos/kismet-release.gpg.key --quiet \
  | gpg --dearmor | sudo tee /usr/share/keyrings/kismet-archive-keyring.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/kismet-archive-keyring.gpg] https://www.kismetwireless.net/repos/apt/release/trixie trixie main' \
  | sudo tee /etc/apt/sources.list.d/kismet.list >/dev/null
sudo apt update
apt-cache policy kismet-core kismet-capture-linux-wifi kismet-capture-linux-bluetooth
```

All three must offer the exact release version. If the repository has moved on, the approved Archimet release must provide the **unmodified** upstream `.deb` assets, hashes and matching source information. Check the hashes first; never silently use a newer Kismet because it happens to be available. See [Updates](UPDATES.md).

## 2. Install the packages

Verify the Archimet asset's published checksum, then install the local file:

```sh
sha256sum -c archimet_<version>_arm64.deb.sha256
sudo apt install --no-install-recommends ./archimet_<version>_arm64.deb
```

If the three tested Kismet files were downloaded separately and verified against the release hash list, install **all four** local `.deb` files in one `sudo apt install --no-install-recommends ./kismet-core_...deb ./kismet-capture-linux-wifi_...deb ./kismet-capture-linux-bluetooth_...deb ./archimet_...deb` command. Apt must stop if the exact dependencies are missing. **Read apt's proposed changes before accepting**; stop if it wants an unplanned downgrade, a different engine version or removal of unrelated software. `--no-install-recommends` prevents Kismet's unrelated recommended capture helpers from being pulled in.

The package installs Archimet's UI and services, configures Kismet to listen on loopback, creates `/etc/default/archimet` on a fresh Pi, attempts local HTTPS certificate setup and schedules holds on the three tested Kismet packages. It does not add a capture source or turn on a hotspot. Existing Kismet credentials, source configuration and data paths are preserved.

## 3. Configure capture sources

Identify interfaces and their roles:

```sh
archimet-setup detect
```

Put only a dedicated capture radio into `/etc/kismet/kismet_site.conf`, for example **after confirming the actual interface names**:

```text
source=wlan1:type=linuxwifi,name=wifi-capture
source=hci0:type=linuxbluetooth,name=bluetooth
```

Omit Bluetooth if active scanning is unsuitable. Do not configure `wlan0` or any radio serving your network/hotspot as a capture source. Restart Kismet after file changes: `sudo systemctl restart kismet`. An attached adapter is merely detected hardware until Kismet opens it as a source. [Hardware](HARDWARE.md) and [Configuration](CONFIGURATION.md).

## 4. Finish the account locally

On a **fresh** install the account begins as `archimet` / `archimet`. It is **setup-only**: until the password changes, the gateway blocks data and all LAN/hotspot clients. Browse from the Pi itself at `https://localhost:2501/`, or make an SSH tunnel from your computer:

```sh
ssh -L 2501:127.0.0.1:2501 <pi-ssh-user>@<pi-address>
```

With the tunnel open, browse `https://localhost:2501/`, sign in with the setup credentials and choose a new password of at least 10 characters. You may also change the user name. A local certificate is generated during install when possible; the browser may need to trust the Pi's local CA first. **Do not use the shared default as an operating password.** On an upgrade, sign in with the existing Kismet account; the package does not overwrite it. `archimet-account status` reports whether setup is complete. [HTTPS](HTTPS.md) explains certificate trust.

## 5. Connect from another local device

Check `archimet-tls status`. If certificate creation failed, run `sudo archimet-tls init`; without a usable certificate the gateway stays loopback-only. Install the public local CA certificate on each phone or computer you use, compare its SHA-256 fingerprint to `archimet-tls status`, and open `https://<covered Pi name or address>:2501/`. If an address changed, run `sudo archimet-tls renew`. No public domain or internet-facing port is required. [HTTPS](HTTPS.md).

The optional [hotspot](HOTSPOT.md) remains off unless you enable it on a **separate** suitable radio. Existing hotspot profiles are left alone.

## 6. Verify capture and the installation

```sh
archimet-hold status
sudo archimet-selftest
archimet-tls status
```

The self-test should end in `ALL PASS`. Inspect Sources for an opened helper, correct interface, packet/error changes and absence of the hotspot radio. Inspect Devices using a known nearby test radio. Reboot, rerun self-test and confirm the HTTPS login still works. A green source count alone does not prove RF coverage. Check the Pi's power flags and adapter behavior before relying on a field run. [User guide](USER-GUIDE.md) and [Recovery](RECOVERY.md).

## Build from source (maintainers)

The source tree contains `tools/package.py` to stage reviewed files and `packaging/build-deb.sh` to construct the arm64 `.deb` on a Debian build host with `dpkg-deb`. The package builder pins the three tested Kismet versions in its Debian control metadata and apt policy. A source build still needs real-hardware validation, a clean-install test, checksums and a public release report before it becomes an installable release for others. [Repository map](REPOSITORY.md), [Updates](UPDATES.md), [Status](STATUS.md).
