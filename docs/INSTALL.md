# Installation guide

**Current release: [v5.3.0-1 (prerelease, installation trial)](https://github.com/Archin3t/Archimet/releases/tag/v5.3.0-1).**
It is published for testing on real hardware; it becomes a normal release only after the release gates in
[STATUS.md](STATUS.md) pass. Everything you need is attached to that release: the Archimet package, the three
exact upstream Kismet packages it was tested with, one checksum file, and the Kismet source and licence notice.

## Before you start

- Raspberry Pi 3B+ (other Pi models with 64-bit OS are expected to work but are not yet validated), **Raspberry Pi OS
  Lite 64-bit / Debian 13 "trixie", arm64**, with internet access for apt (it fetches ordinary Debian libraries).
- A **separate** monitor-mode Wi-Fi adapter for capture (the reference Pi uses an Alfa AWUS036ACH). The onboard
  `wlan0` stays for networking or a hotspot and is never used for capture. Bluetooth capture is optional and is an
  active scan. Stable power: a 5.1 V / 2.5 A supply, and a powered USB hub for a high-power adapter. [Hardware](HARDWARE.md).
- SSH access to the Pi (Ethernet recommended for setup).
- If the Pi already has Kismet or Archimet: a verified private backup first (section 0).

## 0. Replacing an older installation (skip on a new Pi)

Back up first ([RECOVERY.md](RECOVERY.md)); this section deletes the old application data. It never touches the OS,
your login, SSH, NetworkManager or a hotspot profile.

```sh
sudo systemctl stop archimet-gateway archimet-logger archimet-engine kismet 2>/dev/null; true
dpkg -l | grep -E '^ii +(archimet|kismet)'          # what is installed
sudo apt purge archimet                             # also removes a 5.2 package's bundled engine
sudo apt purge kismet kismet-core kismet-capture-linux-wifi kismet-capture-linux-bluetooth   # only those listed above
```

Then remove old **application** data one path at a time (check each exists and is what you expect; adjust the
account / paths to yours, `sed -n 's/^ARCHIMET_OUT=//p' /etc/default/archimet` shows the data folder if that file is
still there):

```sh
sudo rm -r --one-file-system -- /etc/kismet /etc/archimet /var/lib/archimet /var/log/kismet
sudo rm -f -- /etc/default/archimet /etc/apt/preferences.d/archimet-kismet
sudo rm -r --one-file-system -- /etc/systemd/system/kismet.service.d /etc/systemd/system/archimet-logger.service.d
rm -r --one-file-system -- ~/kismet-logs ~/.kismet        # the old Kismet account and logs of that user
sudo systemctl daemon-reload
```

## 1. Download and verify

```sh
mkdir -p ~/archimet-5.3.0-1 && cd ~/archimet-5.3.0-1
base=https://github.com/Archin3t/Archimet/releases/download/v5.3.0-1
for f in SHA256SUMS archimet_5.3.0-1_arm64.deb kismet-core_2025-09-R1_arm64.deb \
         kismet-capture-linux-wifi_2025-09-R1_arm64.deb kismet-capture-linux-bluetooth_2025-09-R1_arm64.deb; do
    wget -q --show-progress "$base/$f" || echo "MISSING: $f"
done
sha256sum -c SHA256SUMS --ignore-missing      # all four .deb lines must say OK; stop otherwise
```

The three Kismet files are the **unmodified** upstream packages (release 2025-09-R1: git tag `kismet-2025-09-R1` = commit `7a3b5d2`; the binaries report their build revision `b5d5a2d04`, the tag's parent, and the tag adds only the generated `version.c`); their hashes match the Kismet project's signed repository index. The release also carries
the matching Kismet source archive and licence notice (GPL v2). Archimet adds no apt repository.

## 2. Install

```sh
sudo apt install --no-install-recommends ./kismet-core_2025-09-R1_arm64.deb \
    ./kismet-capture-linux-wifi_2025-09-R1_arm64.deb ./kismet-capture-linux-bluetooth_2025-09-R1_arm64.deb \
    ./archimet_5.3.0-1_arm64.deb
```

Read apt's list before accepting: it should install these four plus ordinary Debian libraries, and nothing else
named `kismet*`. `--no-install-recommends` keeps Kismet's other capture helpers out. Kismet may ask whether to
install its capture helpers setuid: answer **Yes** (Archimet runs Kismet as a normal account in group `kismet`).

What the package does: creates the account `archimet` for the services (unless an older Archimet setting names
another), runs Kismet on loopback only (port 2500) with Archimet's settings, starts `archimet-logger` (loopback
2502) and `archimet-gateway` (2501, the only web entry point), makes the local HTTPS certificate, creates the web
account `archimet` / `archimet` (setup-only, below), and holds the three Kismet packages at the tested version
(about 20 s after install). It adds no capture source and turns on no hotspot.

## 3. Capture sources

```sh
archimet-setup detect                      # radios and their roles; wlan0 is always reserved
```

Create `/etc/kismet/kismet_site.conf` with your **capture** radios only (check the names `detect` printed):

```sh
printf 'source=wlan1:type=linuxwifi,name=wifi-capture\nsource=hci0:type=linuxbluetooth,name=bluetooth\n' \
  | sudo tee /etc/kismet/kismet_site.conf
sudo systemctl restart kismet
```

Leave out the Bluetooth line if an active scan is unsuitable. Never list `wlan0` or a hotspot radio.

## 4. First sign-in (setup-only default account)

The web account starts as **`archimet` / `archimet`**. Until you change that password, Archimet serves **only the
Pi itself** and shows no data; other devices get a "setup not finished" page. From your computer:

```sh
ssh -L 2501:127.0.0.1:2501 <your-pi-user>@<pi-address>      # keep it open
```

Open `https://localhost:2501/` (accept the certificate warning for this one local step, or trust the CA first,
section 5), sign in as `archimet` / `archimet`, and choose your own password (10+ characters, not the default, not
the user name). Changing the user name is optional; both can be changed later in Settings › Account. This web
account is separate from your Linux login.

## 5. Use it from other devices (local HTTPS)

```sh
archimet-tls status          # names / addresses covered and the CA fingerprint
```

Install the Pi's CA certificate once on each computer or phone (download `https://<pi>:2501/archimet-ca.crt`,
compare the fingerprint, trust it as an authority: [HTTPS.md](HTTPS.md)), then open `https://<pi>:2501/`. If the
Pi's name or address changes: `sudo archimet-tls renew`.

## 6. Check

```sh
sudo archimet-selftest       # must end in ALL PASS
archimet-hold status         # the three Kismet packages: tested version, held
```

Open Sources: each capture source should say **capturing** (packet count rising). Reboot once and run the self-test
again. Watch power: `vcgencmd get_throttled` should stay `0x0` under capture load.

The optional [hotspot](HOTSPOT.md) needs a separate radio and stays off unless you enable it.

## Build from source (maintainers)

`python tools/package.py` stages the reviewed files; `bash packaging/build-deb.sh <stage> packaging <out> arm64`
builds the package on Debian. A source build is not a tested release. [Repository map](REPOSITORY.md),
[Updates](UPDATES.md), [Status](STATUS.md).
