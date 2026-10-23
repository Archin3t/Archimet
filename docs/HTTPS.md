# Local HTTPS

Archimet does not need a public domain, port forwarding, internet access or any public certificate
service. HTTPS protects the password, the session cookie and the device data between your browser and
the Pi on a LAN or hotspot. Other devices are served **only over HTTPS**; plain `http://` on port 2501
only redirects. **Second-device HTTPS on real hardware is still a release gate** (see STATUS.md).

## What the package sets up

At install, `archimet-tls init` creates, in `/etc/archimet/tls/`:

| File | What | Share it? |
|---|---|---|
| `ca.crt` | the Pi's own small certificate authority (10 years) | yes: install it on your computer and phone |
| `ca.key` | that authority's key (mode 600) | **never**; it stays on the Pi |
| `server.crt`, `server.key` | the Pi's certificate (397 days), handed to the gateway by systemd | no |

The certificate covers `localhost`, the Pi's host name and `<hostname>.local`, `127.0.0.1`, every current
IPv4 address of the Pi, and the address of the hotspot profile (read only; nothing is changed). The
authority is **name-constrained**: it can only sign local names and private / loopback addresses, so
even a stolen `ca.key` could not impersonate any public web site to a device that trusts it.

Check it at any time:

```
archimet-tls status          # names covered, expiry, CA fingerprint, addresses NOT covered
```

## Trust the Pi on each device (once)

1. On the Pi, note the fingerprint: `archimet-tls status` prints `CA SHA-256 fingerprint: AB:CD:…`.
2. Get `ca.crt` onto the device: open `https://<pi-address>:2501/archimet-ca.crt` (the browser warns
   once, because it does not trust the Pi yet; continue only to download this file), or copy it with
   `scp <user>@<pi>:/etc/archimet/tls/ca.crt .`
3. Compare the fingerprint the device shows for the file with the one from step 1. **Stop if they differ.**
4. Install it as a trusted authority:
   - **Windows**: double-click `archimet-ca.crt` › *Install Certificate* › *Current User* ›
     *Place all certificates in the following store* › *Trusted Root Certification Authorities* › Finish.
     Restart the browser. (Firefox: Settings › Privacy & Security › Certificates › View Certificates ›
     Authorities › Import, tick "websites".)
   - **Android**: Settings › Security › More security settings › Encryption & credentials › Install a
     certificate › *CA certificate* › choose the file. (Menu names vary by maker.)
   - **iPhone / iPad**: open the file (AirDrop, Files or Mail) › Settings › *Profile Downloaded* › Install;
     then Settings › General › About › Certificate Trust Settings › switch on *Archimet local CA*.
5. Open `https://<pi-address>:2501/`. The browser must show a secure connection **without** a warning
   before you sign in. A warning means the device does not trust the CA, or the address is not covered.

## When addresses change, and renewal

```
sudo archimet-tls renew       # new Pi certificate for today's addresses, same CA: no device needs re-trusting
```

Run it when `archimet-tls status` lists an address as NOT covered (new LAN, new hotspot address) and
before the certificate expires (it warns 30 days ahead). `archimet-selftest` fails while the certificate
is missing, expired or does not cover the Pi's addresses.

## Recovery

- **Pi reinstalled, CA lost**: `sudo archimet-tls init` makes a new CA; install the new `ca.crt` on every
  device and remove the old one there. To avoid that, keep `/etc/archimet/tls/` in your private,
  encrypted off-Pi backup (`tools/offpi_backup.py` includes `/etc/archimet`) and restore it before
  `archimet-tls init`.
- **CA key exposed**: delete `/etc/archimet/tls/`, run `sudo archimet-tls init`, re-trust the new CA, and
  remove the old CA from every device. The name constraint limits what an old key could sign.
- **Locked out of the network** (no certificate): the gateway then serves only the Pi itself; use
  `ssh -L 2501:127.0.0.1:2501 <user>@<pi>` and `https://localhost:2501/` or run `sudo archimet-tls init`.

## Limits

The session cookie is Archimet's own (`ARCHIMET`: HttpOnly, SameSite=Strict, Secure under HTTPS). HSTS is
not sent, so that a device is not locked out if HTTPS is ever turned off for repair. TLS 1.2 or newer.
The CA is trusted only by devices where you installed it.
