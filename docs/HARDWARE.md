# Hardware and radio setup

## Tested target and requirements

The 5.3 package targets a **Raspberry Pi 3B+ with 64-bit Raspberry Pi OS / Debian 13 (trixie), arm64**. It has passed isolated arm64 tests but not yet the full clean-install and field checks listed in [Status](STATUS.md). Other boards and Linux versions may work, but are not claimed as tested targets.

For the intended Wi-Fi workflow you need:

- A stable Pi power supply with enough current for the Pi **and** attached USB radios. Under-voltage can interrupt or distort capture; check the System power flags and `sudo archimet-selftest`. A powered USB hub may help a power-hungry adapter, but does not replace proper Pi input power.
- A Linux Wi-Fi adapter and driver that support monitor mode, **separate** from the Pi's networking/hotspot radio. The reference setup uses a USB Alfa adapter as `wlan1`; that model and driver are not a guarantee for every board or kernel. Confirm actual Linux interface names with `sudo archimet-setup detect`.
- Storage for Raspberry Pi OS, Kismet and Archimet's selected metadata logs. Retention grows with observations; monitor free space in System and plan private off-Pi backups.
- A browser on the Pi's local Ethernet, Wi-Fi or optional hotspot network. First account setup requires a browser on the Pi or an SSH tunnel and then local HTTPS trust for other devices.

A Linux Bluetooth controller is optional. [Kismet's Linux Bluetooth source](https://www.kismetwireless.net/docs/readme/datasources/bluetooth-hci-bluetooth/) actively scans; it is not a passive packet sniffer. GPS is optional; without it Archimet reports no fix and does not invent positions.

## Reserve the networking radio

The Pi's onboard `wlan0` is reserved for networking or a hotspot and must not be a capture source. The installer does not reconfigure an existing hotspot. An optional Archimet hotspot also needs its own free radio, separate from a capture adapter. `sudo archimet-setup detect` reports detected interface roles; `archimet-selftest` checks for a configured hotspot/capture collision. See [Hotspot](HOTSPOT.md).

## Make a source actually capture

Run `sudo archimet-setup detect` to identify the interface. Add a Kismet source to `/etc/kismet/kismet_site.conf` or use Sources in the UI. For example, **only after checking the real interface names and their roles**:

```text
source=wlan1:type=linuxwifi,name=wifi-capture
source=hci0:type=linuxbluetooth,name=bluetooth
```

Restart Kismet after editing the file: `sudo systemctl restart kismet`. In Sources, verify the helper is running and packets or Bluetooth observations change. The Sources screen distinguishes **detected hardware** from **configured capture sources**. Plugging an adapter in does not automatically configure it, open it, or guarantee a device will appear. [Kismet's Wi-Fi source documentation](https://www.kismetwireless.net/docs/readme/datasources/wifi-linux/) explains monitor-mode driver requirements.

## Coverage and troubleshooting

Wi-Fi capture hears only channels the adapter visits and frames it can receive. A phone hotspot can be visible to another phone yet be missed during short dwell periods, use a channel the adapter does not cover, or be hidden by distance and interference. Check source state, channel plan, driver errors and power before assuming an Archimet filter is broken. Bluetooth advertisements can appear without the Wi-Fi hotspot being seen. Archimet's Devices list cannot create an observation Kismet never received.

Check `vcgencmd get_throttled` on supported Pi hardware, the System power panel, `journalctl -u kismet -u archimet-logger --since today`, and `sudo archimet-selftest`. A past under-voltage flag means it happened since boot; current power and adapter behavior need a fresh measurement. Do not interpret a channel/frequency warning as a confirmed RF conflict without checking the underlying fields. The reference Pi's `rtw88` channel-hop warning remains a release gate in [Status](STATUS.md).
