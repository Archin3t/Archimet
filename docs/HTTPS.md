# Local HTTPS

Archimet is designed for a local LAN or optional Pi hotspot. It does not need a public domain, router port forwarding or an internet connection. HTTPS protects the password, session cookie and observations between the browser and Pi.

## What the package creates

On install, Archimet attempts `archimet-tls init` once. It creates a **private local certificate authority (CA)** and a Pi server certificate under `/etc/archimet/tls/`. The server certificate covers `localhost`, the Pi's host name and `.local` name, and private IPv4 addresses present at creation time, including configured hotspot addresses. The systemd gateway unit passes the server certificate/key as protected credentials. Kismet and the logger remain on loopback HTTP behind the gateway.

If certificate creation fails, the gateway serves **loopback clients only**; it does not expose a plain-HTTP login to the LAN/hotspot. After first account setup, other devices need HTTPS. Check:

```sh
archimet-tls status
sudo archimet-tls init      # if not configured; keeps an existing CA
```

## Trust the Pi on your devices

Only the public `/etc/archimet/tls/ca.crt` should leave the Pi. The gateway can also serve it as `https://<pi>:2501/archimet-ca.crt`, but an untrusted browser connection should be verified by comparing the CA's SHA-256 fingerprint shown by `archimet-tls status` over SSH or at the Pi. Import the CA as trusted on each phone/computer you control, then reopen a covered address at `https://<pi-address>:2501/`. The exact import steps differ among operating systems and browsers. A certificate warning means setup is not complete.

The private `ca.key` and `server.key` stay on the Pi. Never put them in a repository, release asset or support log. The CA is constrained to local names and private addresses; it cannot sign public Internet names.

## Changed Pi address or certificate renewal

```sh
archimet-tls status
sudo archimet-tls renew
archimet-tls status
```

`renew` makes a new Pi certificate using the existing CA and current names/addresses; devices that already trust the CA keep that trust. If the CA is lost and recreated, every browser must trust the new public certificate. Check the actual new address in the certificate before signing in from another device. See [Security](SECURITY.md), [Installation](INSTALL.md) and [Hotspot](HOTSPOT.md).
