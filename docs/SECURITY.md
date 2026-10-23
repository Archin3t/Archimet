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

- **Account**: Kismet's own login. Archimet stores no password; the browser holds Kismet's
  `KISMET` session cookie. Sign-in sends HTTP Basic once to `/session/check_login`.
- **First run**: a fresh package provisions Kismet's `archimet/archimet` account. The gateway treats
  it as **setup-only**: only loopback clients (including an SSH tunnel) can see setup, every data
  route is blocked, and LAN/hotspot clients are refused until the password is changed. A new user
  name is optional; a new password is mandatory and must meet the gateway policy. An existing
  Kismet account is preserved on upgrade.
- **Every data route** (Kismet and logger) needs a session; anonymous requests are refused. During
  first setup, even a default-account session cannot read data; only the setup routes are allowed.
  The gateway serves a small health response and its static files as required by that state.
- **Session lifetime**: Kismet's `httpd_session_timeout` (7200 s), renewed by activity. Sessions do
  not survive a Kismet restart. Kismet has no logout endpoint; Archimet's gateway has
  `POST /archimet-session/logout`, which revokes its issued session and clears the browser cookie.
- **Logger writes** (mark, unmark, Review decisions) need a valid Kismet session, a JSON body, the
  `X-Archimet` header (forces a CORS preflight) and an `Origin` on the same host.

## Gateway hardening

Runs as a throwaway `DynamicUser` with `ProtectSystem=strict`, `ProtectHome`, `NoNewPrivileges`,
no capabilities, 96 MB memory cap. It holds no account password; systemd gives it only the HTTPS
certificate/key as service credentials.
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

## Local HTTPS

The package attempts to create a local CA and server certificate on install. LAN/hotspot clients
are served only after first setup finishes **and** the gateway has HTTPS; without a certificate it
stays loopback-only. Run `archimet-tls status`, or `sudo archimet-tls init` if generation failed.
Install the public `/etc/archimet/tls/ca.crt` on each device after comparing its fingerprint over
SSH or at the Pi. Keep `ca.key` and `server.key` private. The local CA is name-constrained, the
gateway requires TLS 1.2 or newer, and no internet, public domain or port forwarding is needed.
Unit tests cover systemd-provided credentials and stalled TLS handshakes. A second-device Pi test
is still an outstanding release gate. See [HTTPS](HTTPS.md).

## Known limits

- Kismet does not set the desired cookie attributes itself. Archimet's gateway rewrites the
  `KISMET` cookie with `HttpOnly` and `SameSite=Strict`, adds `Secure` when TLS is active, and
  accepts only sessions it issued. Loopback setup can use a local connection; network use requires HTTPS.
- Kismet stays on its tested version until a new Archimet release (UPDATES.md: security cost).
- A user with root on the Pi can read the login file and all data; protect SSH access.
- Backups contain the login and captured data: keep them private and outside this repository.

## Verification

The release report should list, for each release, the route audit (Kismet and logger routes,
anonymous and signed-in, over Ethernet and hotspot), isolated write tests, default-account
setup/credential-change tests, TLS checks and `archimet-selftest`.
