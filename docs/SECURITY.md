# Archimet security model

## Listeners

| Port | Service | Bound to | Serves |
|---|---|---|---|
| 2501 | `archimet-gateway` | every address (`ARCHIMET_GATEWAY_BIND`) | Archimet's web files; an allowlist of Kismet API routes; `/archimet/*` to the logger. Nothing else (404). |
| 2500 | `kismet` (upstream kismet-core) | **127.0.0.1** (`httpd_bind_address`) | Kismet's REST API, for the gateway and the logger only |
| 2502 | `archimet-logger` | **127.0.0.1** (`ARCHIMET_HTTP`) | Archimet's API (LE History, Review, Archive, marks, metrics) |

Kismet's stock web interface is never reachable: Kismet listens on loopback, its `httpd_home` is
Archimet's web root, its per-user static root (`httpd_user_home`) points at an empty directory, and
the gateway forwards only the routes Archimet uses (`ROUTES` in `pi/archimet-gateway`): no static
Kismet pages, plugin paths, pcap or log downloads, logging controls, websockets or setup pages.
`archimet-selftest` checks this on every address of the Pi.

## Authentication

- **Account**: the engine's single login (Kismet stores it). Archimet stores no password. Sign-in sends
  HTTP Basic once to `/session/check_login`; the gateway then gives the browser its **own** random
  session token (cookie `ARCHIMET`: HttpOnly, SameSite=Strict, Secure under HTTPS) and keeps Kismet's
  session to itself. Kismet 2025-09-R1 re-issues the same session token to every sign-in with the same
  credentials and keeps it after a credential change (measured), so only gateway tokens can be revoked.
- **First run (setup lock, enforced by the gateway)**: a fresh install provisions `archimet` / `archimet`.
  While that default still signs in (or the engine has no account at all), only clients on the Pi itself
  (loopback, e.g. an SSH tunnel) are served, and only sign-in and the credential change pass; every data
  route answers 403, including with HTTP Basic. Other LAN / hotspot clients get a "setup not finished"
  page and cannot claim the default. A Kismet restart during setup does not lift the lock.
- **Network access** needs setup finished **and** HTTPS active; without a certificate the gateway serves
  loopback only. Plain HTTP on the HTTPS port is redirected and carries no data.
- **Password policy** (server side, every change): at least 10 characters, not the default, not the user
  name. User name: 1-32 letters, digits, dot, dash, underscore.
- **Every data route** (Kismet and logger) needs a session; anonymous requests get 401. Without a
  session only the web files, `/session/check_setup_ok` and the logger's version (`/archimet/health`)
  answer.
- **Sessions end** on sign-out (`POST /archimet-session/logout`, revoked at the gateway), after 2 hours
  without use, when the account changes (all sessions), and when the gateway or Kismet restarts.
- **Logger writes** (mark, unmark, Review decisions) need a valid Kismet session, a JSON body, the
  `X-Archimet` header (forces a CORS preflight) and an `Origin` on the same host.

## Gateway hardening

Runs as a throwaway `DynamicUser` with `ProtectSystem=strict`, `ProtectHome`, `NoNewPrivileges`,
no capabilities, 96 MB memory cap. Holds no account credentials; the TLS key reaches it as a systemd
credential.
Files are served only from inside the web root (no `..`, dot-files, backslashes or symlinks out).
Request bodies above 1 MiB → 413; PUT / DELETE / PATCH / OPTIONS → 405. No request log (URLs carry
MAC addresses). Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`; the page carries
a CSP with `connect-src 'self'`.

## Capture and retention

Wi-Fi capture is passive (monitor mode, nothing transmitted). Kismet's `linuxbluetooth` source is
an **active scan** (Kismet's documentation), not passive. Kismet's packet and session logs are off
(`enable_logging=false`), handshakes are not kept (`dot11_keep_eapol=false`), remote capture is off.
The capture helpers run with the privileges Kismet's packages give them (group `kismet`).

## HTTPS

Other devices are served **only over HTTPS**; until a certificate exists the gateway serves the Pi
itself (loopback) only, and plain `http://` on port 2501 is redirected without data. The package runs
`archimet-tls init` at install: a local CA and the Pi's certificate in `/etc/archimet/tls`, handed to the
gateway by systemd (`LoadCredential=`), no manual unit edits. `archimet-tls status` shows the names
covered and the CA fingerprint; `sudo archimet-tls renew` re-issues the certificate for new addresses with
the same CA. The CA is name-constrained to local names and private / loopback addresses, `ca.key` stays
on the Pi (mode 600), and no internet, ACME or OCSP is needed. TLS 1.2 or newer. Trusting the CA on each
device: [HTTPS.md](HTTPS.md). Unit tests cover TLS from systemd credentials, the plain-HTTP redirect and a
handshake-stalling client; whether TLS was tested end to end on the Pi is stated in each release report.

## Known limits

- Kismet does not set the desired cookie attributes itself. Archimet's gateway rewrites the
  `KISMET` cookie with `HttpOnly` and `SameSite=Strict`, adds `Secure` when TLS is active, and
  accepts only sessions it issued. Over plain HTTP the cookie cannot have `Secure`; configure
  local HTTPS before signing in across a network.
- Kismet stays on its tested version until a new Archimet release (UPDATES.md: security cost).
- A user with root on the Pi can read the login file and all data; protect SSH access.
- Backups (`tools/offpi_backup.py`) contain the login and captured data: keep them private.

## Verification

The release report lists, for each release, the route audit (every Kismet and logger route,
anonymous and signed-in, over Ethernet and the hotspot), the write tests on an isolated instance,
the account / setup-lock / HTTPS test against a real Kismet (`tools/account_tls_test.py`), and
`archimet-selftest`.
