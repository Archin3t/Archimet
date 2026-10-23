# Hotspot

Many Archimet Pis carry their own Wi-Fi hotspot so a phone or laptop can reach Archimet in the field.
Archimet treats a hotspot radio as **reserved**: it never captures on it, never puts it in monitor
mode, never lists it as a source and never sends test traffic on it.

## An existing hotspot is left alone

If the Pi already has a hotspot (for example a NetworkManager profile on `wlan0` with a watchdog
service), Archimet does not touch it: not the profile, the radio, its address, its password, or any
service that keeps it up. The package never runs `nmcli`. `archimet-setup detect` reports it:

```
archimet-setup detect
# "wlan0": {"role": "hotspot", "why": "NetworkManager access-point profile ..."}
# "wlan1": {"role": "capture", "why": "Kismet source in kismet_site.conf"}
```

`wlan0` is always treated as reserved, even without a hotspot profile. `archimet-selftest` fails if a
capture source names a hotspot radio.

After first account setup and certificate trust, reach Archimet over the hotspot at
`https://<the Pi's hotspot address>:2501/`. The gateway listens on every address **only when**
setup is complete and local HTTPS is active; otherwise it refuses network clients. If you enable
a new hotspot address after certificate creation, run `sudo archimet-tls renew` and verify its
coverage with `archimet-tls status`. See [HTTPS](HTTPS.md).

## Optional: let Archimet create a hotspot

Only if you want one and do not have one. It needs a **separate** radio that is neither a capture
source nor used by another access-point profile; Archimet refuses anything else.

```
sudo archimet-setup hotspot enable --iface wlan2 --ssid MyArchimet --band a --dry-run   # show what it would do
read -rsp 'WPA2 password: ' P; echo; printf '%s\n' "$P" | sudo archimet-setup hotspot enable --iface wlan2 --ssid MyArchimet --band a; unset P
archimet-setup hotspot status
```

- It creates exactly one NetworkManager profile, "Archimet Hotspot"
  (`/etc/NetworkManager/system-connections/archimet-hotspot.nmconnection`, mode 600), WPA2-PSK,
  address `10.10.0.1/24` shared (change with `--address`).
- The password is read from standard input, never taken as a command-line argument (which `ps`
  would show) and never typed into the shell history in the example above.
- The chosen radio is recorded in `/etc/archimet/hotspot.conf` and treated as reserved from then on.

## Turning it off (reversible)

```
sudo archimet-setup hotspot disable --dry-run
sudo archimet-setup hotspot disable
```

This takes down and deletes only the "Archimet Hotspot" profile and removes
`/etc/archimet/hotspot.conf`. Other profiles are never changed. Removing or purging the archimet
package does not touch any NetworkManager profile, including the one Archimet created; disable it
first if you want it gone.
