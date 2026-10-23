# SPDX-License-Identifier: GPL-2.0-only
"""Tests for pi/archimet-gateway, the only network-facing entry point. A fake Kismet models the one
account (default / changed / none), its sessions and set_password; a fake logger records what reaches
it. Non-loopback clients are simulated by patching is_loopback."""
import base64
import importlib.machinery
import importlib.util
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class FakeKismet:
    def __init__(self):
        self.seen, self.account, self.sessions, self.n = [], ("archimet", "archimet"), set(), 0
        up = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _auth(self):
                a = self.headers.get("Authorization") or ""
                if a.startswith("Basic ") and up.account:
                    return base64.b64decode(a[6:]).decode() == ":".join(up.account)
                c = re.search(r"KISMET=([^;]+)", self.headers.get("Cookie") or "")
                return bool(c and c.group(1) in up.sessions)

            def _out(self, code, obj, cookie=None):
                b = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                if cookie:
                    self.send_header("Set-Cookie", f"KISMET={cookie}; Path=/")
                self.end_headers()
                self.wfile.write(b)

            def _any(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(n) if n else b""
                up.seen.append({"method": self.command, "path": self.path, "body": body, "headers": dict(self.headers)})
                p = self.path.split("?")[0]
                if p == "/session/check_setup_ok":
                    return self._out(200 if up.account else 500, {})
                if p == "/session/set_password":
                    if up.account and not self._auth():
                        return self._out(403, {})
                    f = urllib.parse.parse_qs(body.decode())
                    up.account = (f["username"][0], f["password"][0])
                    return self._out(200, {})
                if not self._auth():
                    return self._out(401, {})
                cookie = None
                if p == "/session/check_login":
                    up.n += 1
                    cookie = f"s{up.n}"
                    up.sessions.add(cookie)
                return self._out(200, {"upstream": "kismet", "path": self.path}, cookie)
            do_GET = do_POST = _any

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_port}"


class FakeLogger:
    def __init__(self):
        self.seen = []
        up = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _any(self):
                n = int(self.headers.get("Content-Length") or 0)
                self.rfile.read(n) if n else b""
                up.seen.append({"path": self.path, "headers": dict(self.headers)})
                b = b'{"ok": true}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "http://evil.example")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)
            do_GET = do_POST = _any

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_port}"


def basic(u, p):
    return {"Authorization": "Basic " + base64.b64encode(f"{u}:{p}".encode()).decode()}


FORM = {"Content-Type": "application/x-www-form-urlencoded"}


class Gateway(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="archimet-gw-"))
        www = cls.tmp / "www"
        (www / "js").mkdir(parents=True)
        (www / "index.html").write_text("<title>Archimet</title>")
        (www / "js" / "app.js").write_text("export {};")
        (www / ".hidden").write_text("no")
        (cls.tmp / "secret.txt").write_text("outside the web root")
        try:
            os.symlink(cls.tmp / "secret.txt", www / "link.txt")
            cls.symlink = True
        except OSError:
            cls.symlink = False
        cls.kismet, cls.logger = FakeKismet(), FakeLogger()
        os.environ.update(ARCHIMET_KISMET_URL=cls.kismet.url, ARCHIMET_LOGGER_URL=cls.logger.url, ARCHIMET_WWW=str(www),
                          ARCHIMET_TLS_CERT=str(cls.tmp / "none.crt"), ARCHIMET_TLS_KEY=str(cls.tmp / "none.key"))
        loader = importlib.machinery.SourceFileLoader("gw", str(ROOT / "pi" / "archimet-gateway"))
        spec = importlib.util.spec_from_loader("gw", loader)
        cls.G = importlib.util.module_from_spec(spec)
        loader.exec_module(cls.G)
        cls.srv = cls.G.make_server("127.0.0.1:0")
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_port}"
        cls.real_loopback = staticmethod(cls.G.is_loopback)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.kismet.seen.clear()
        self.logger.seen.clear()
        self.kismet.account = ("owner", "a-long-owner-pass")
        self.G.is_loopback = self.real_loopback
        self.G.SESSIONS.drop()
        self.G.SETUP.state(force=True)

    def set_account(self, acct):
        self.kismet.account = acct
        self.G.SETUP.state(force=True)

    def remote(self, yes=True):
        self.G.is_loopback = (lambda a: False) if yes else self.real_loopback

    def call(self, path, method="GET", body=None, headers=None, base=None, ctx=None):
        req = urllib.request.Request((base or self.base) + path, data=body, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
                return r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            with e:
                return e.code, e.read(), e.headers

    def login(self, u="owner", p="a-long-owner-pass", base=None, ctx=None):
        code, _, h = self.call("/session/check_login", headers=basic(u, p), base=base, ctx=ctx)
        c = h.get_all("Set-Cookie") or []
        return code, (re.search(r"KISMET=([^;]*)", c[0]).group(1) if c else None), c

    # ---------------------------------------------------------------- files and routes
    def test_serves_archimet_and_config(self):
        code, body, h = self.call("/")
        self.assertEqual((code, body), (200, b"<title>Archimet</title>"))
        self.assertEqual(h["X-Frame-Options"], "DENY")
        self.assertEqual(self.call("/js/app.js")[0], 200)
        cfg = json.loads(self.call("/archimet-config.json")[1])
        self.assertEqual((cfg["apiBase"], cfg["setup"], cfg["tls"]), ("/archimet/", "", False))

    def test_stock_kismet_pages_never_reach_kismet(self):
        for p in ("/js/kismet.ui.js", "/js/kismet.ui.base.js", "/css/kismet.css", "/images/kismet_logo.png",
                  "/dynamic.js", "/plugin/lehighlight/js/lehighlight.js", "/index.html.bak", "/setup.html",
                  "/pcap/all_packets.pcapng", "/logging/active.json", "/devices/views/all/devices.pcapng",
                  "/eventbus/events.ws", "/system/ui.json", "/kismet/index.html"):
            self.assertEqual(self.call(p)[0], 404, p)
        self.assertEqual([s for s in self.kismet.seen if s["path"] not in ("/session/check_setup_ok", "/session/check_session")], [])

    def test_traversal_and_hidden_files_refused(self):
        for p in ("/../secret.txt", "/js/../../secret.txt", "/%2e%2e/secret.txt", "/.hidden", "//etc/passwd",
                  "/js/..%2f..%2fsecret.txt", "/js\\..\\..\\secret.txt"):
            code, body, _ = self.call(p)
            self.assertEqual(code, 404, p)
            self.assertNotIn(b"outside", body)
        if self.symlink:
            self.assertEqual(self.call("/link.txt")[0], 404)

    def test_method_must_match(self):
        self.assertEqual(self.call("/devices/by-key/4202770D00000000_ABCDEF/set_name.cmd")[0], 404)
        self.assertEqual(self.call("/session/set_password")[0], 404)

    def test_bad_methods_and_sizes(self):
        self.assertEqual(self.call("/", "PUT", b"x")[0], 405)
        self.assertEqual(self.call("/", "DELETE")[0], 405)
        req = urllib.request.Request(self.base + "/devices/multimac/devices.json", data=b"x" * (self.G.MAX_BODY + 1), method="POST")
        try:
            urllib.request.urlopen(req, timeout=10)
            code = 200
        except urllib.error.HTTPError as e:
            code = e.code
            e.close()
        except (urllib.error.URLError, ConnectionError):
            code = 413
        self.assertEqual(code, 413)

    def test_upstream_down_is_502(self):
        saved = self.G.LOGGER
        self.G.LOGGER = "http://127.0.0.1:9"
        try:
            self.assertEqual(self.call("/archimet/health")[0], 502)
        finally:
            self.G.LOGGER = saved

    def test_every_ui_and_contract_route_is_allowed(self):
        contract = json.loads((ROOT / "ui" / "js" / "api" / "contract.json").read_text())
        for e in contract["endpoints"]:
            self.assertTrue(self.G.kismet_route(e["method"], e["path"]), e["path"])
        src = (ROOT / "ui" / "js" / "api" / "kismet.js").read_text()
        fixed = re.findall(r'P \+ "(/[^"]+)"', src)
        self.assertGreater(len(fixed), 15)
        for p in fixed:
            # Logout is a gateway-owned route, not a Kismet route. Its behavior is tested below.
            if p == "/archimet-session/logout":
                continue
            self.assertTrue(self.G.kismet_route("GET", p) or self.G.kismet_route("POST", p), p)
        for m, p in (("GET", "/datasource/by-uuid/x/close_source.cmd"), ("GET", "/devices/by-mac/00-25-DF-12-34-56/devices.json"),
                     ("POST", "/datasource/by-uuid/5FE308BD-0000-0000-0000-00C0CA9C4E7C/pause_source.cmd")):
            self.assertFalse(self.G.kismet_route(m, p), p)

    # ---------------------------------------------------------------- sessions
    def test_session_cookie_flags_and_forwarding(self):
        code, sid, cookies = self.login()
        self.assertEqual(code, 200)
        self.assertIn("HttpOnly", cookies[0])
        self.assertIn("SameSite=Strict", cookies[0])
        self.assertNotIn("Secure", cookies[0])                     # plain HTTP here (loopback); Secure under TLS
        code, _, _ = self.call("/devices/views/all/devices.json", "POST", b"page=0", {**FORM, "Cookie": f"KISMET={sid}"})
        self.assertEqual(code, 200)
        self.assertEqual(self.kismet.seen[-1]["headers"].get("Cookie"), f"KISMET={sid}")

    def test_unknown_or_forged_cookie_is_not_forwarded(self):
        self.kismet.sessions.add("made-elsewhere")
        code, _, _ = self.call("/system/status.json", headers={"Cookie": "KISMET=made-elsewhere"})
        self.assertEqual(code, 401)
        self.assertNotIn("Cookie", self.kismet.seen[-1]["headers"])

    def test_logout_ends_the_session_at_the_gateway(self):
        _, sid, _ = self.login()
        code, _, h = self.call("/archimet-session/logout", "POST", b"", {"Cookie": f"KISMET={sid}"})
        self.assertEqual(code, 200)
        self.assertIn("Max-Age=0", h.get_all("Set-Cookie")[0])
        self.assertEqual(self.call("/system/status.json", headers={"Cookie": f"KISMET={sid}"})[0], 401)

    def test_credential_change_ends_every_session(self):
        _, a, _ = self.login()
        _, b, _ = self.login()
        body = urllib.parse.urlencode({"username": "owner2", "password": "another-long-pass"}).encode()
        code, _, _ = self.call("/session/set_password", "POST", body, {**FORM, "Cookie": f"KISMET={a}"})
        self.assertEqual(code, 200)
        for sid in (a, b):
            self.assertEqual(self.call("/system/status.json", headers={"Cookie": f"KISMET={sid}"})[0], 401)
        self.assertEqual(self.login("owner", "a-long-owner-pass")[0], 401)       # old credentials fail
        self.assertEqual(self.login("owner2", "another-long-pass")[0], 200)      # new ones work

    def test_password_policy_enforced_on_the_server(self):
        _, sid, _ = self.login()
        for user, pw in (("owner", "short"), ("owner", "archimet"), ("longusername", "LongUserName"), ("bad user", "a-long-pass-123")):
            body = urllib.parse.urlencode({"username": user, "password": pw}).encode()
            code, out, _ = self.call("/session/set_password", "POST", body, {**FORM, "Cookie": f"KISMET={sid}"})
            self.assertEqual((code, json.loads(out)["error"]), (422, "policy"), (user, pw))
        self.assertEqual(self.kismet.account, ("owner", "a-long-owner-pass"))

    # ---------------------------------------------------------------- setup lock
    def test_default_account_locks_data_until_changed(self):
        self.set_account(("archimet", "archimet"))
        cfg = json.loads(self.call("/archimet-config.json")[1])
        self.assertEqual((cfg["setup"], cfg["defaultUser"]), ("default", "archimet"))
        code, sid, _ = self.login("archimet", "archimet")
        self.assertEqual(code, 200)                                              # sign-in works (loopback)
        for p in ("/system/status.json", "/devices/views/all_views.json", "/datasource/all_sources.json"):
            self.assertEqual(self.call(p, headers={"Cookie": f"KISMET={sid}"})[0], 403, p)
            self.assertEqual(self.call(p, headers=basic("archimet", "archimet"))[0], 403, p)
        for p in ("/archimet/state.json", "/archimet/le_history.json", "/archimet/archive.json"):
            self.assertEqual(self.call(p, headers={"Cookie": f"KISMET={sid}"})[0], 403, p)
        self.assertEqual(self.logger.seen, [])
        # The forced change: a username change is optional, the password must change.
        body = urllib.parse.urlencode({"username": "archimet", "password": "archimet"}).encode()
        self.assertEqual(self.call("/session/set_password", "POST", body, {**FORM, "Cookie": f"KISMET={sid}"})[0], 422)
        body = urllib.parse.urlencode({"username": "archimet", "password": "now-a-strong-one"}).encode()
        self.assertEqual(self.call("/session/set_password", "POST", body, {**FORM, "Cookie": f"KISMET={sid}"})[0], 200)
        self.assertEqual(json.loads(self.call("/archimet-config.json")[1])["setup"], "")
        self.assertEqual(self.call("/system/status.json", headers={"Cookie": f"KISMET={sid}"})[0], 401)  # old session ended
        _, sid2, _ = self.login("archimet", "now-a-strong-one")
        self.assertEqual(self.call("/system/status.json", headers={"Cookie": f"KISMET={sid2}"})[0], 200)

    def test_network_clients_cannot_use_or_claim_the_default(self):
        self.set_account(("archimet", "archimet"))
        self.remote()
        for p, m in (("/", "GET"), ("/archimet-config.json", "GET"), ("/session/check_login", "GET"),
                     ("/session/set_password", "POST"), ("/system/status.json", "GET")):
            code, body, _ = self.call(p, m, b"username=x&password=yyyyyyyyyyyy" if m == "POST" else None,
                                      {**FORM, **basic("archimet", "archimet")})
            self.assertEqual(code, 403, p)
            self.assertIn(b"not open to the network", body)
        self.assertEqual(self.kismet.account, ("archimet", "archimet"))
        self.assertFalse([s for s in self.kismet.seen if s["path"] not in ("/session/check_setup_ok", "/session/check_session")])

    def test_unconfigured_kismet_only_claimable_locally(self):
        self.set_account(None)
        body = urllib.parse.urlencode({"username": "owner", "password": "a-long-owner-pass"}).encode()
        self.remote()
        self.assertEqual(self.call("/session/set_password", "POST", body, FORM)[0], 403)
        self.assertIsNone(self.kismet.account)
        self.remote(False)
        self.assertEqual(self.call("/session/set_password", "POST", body, FORM)[0], 200)
        self.assertEqual(self.kismet.account, ("owner", "a-long-owner-pass"))

    def test_network_needs_https_even_after_setup(self):
        self.remote()
        code, body, _ = self.call("/")
        self.assertEqual(code, 403)
        self.assertIn(b"HTTPS is not configured", body)

    def test_kismet_down_fails_closed(self):
        saved = self.G.KISMET
        self.G.KISMET = "http://127.0.0.1:9"
        try:
            self.assertEqual(self.G.SETUP.state(force=True), "unknown")
            self.remote()
            self.assertEqual(self.call("/")[0], 403)
        finally:
            self.G.KISMET = saved
            self.G.SETUP.state(force=True)

    def test_logger_proxied_without_upstream_cors(self):
        _, sid, _ = self.login()
        code, _, h = self.call("/archimet/review", "POST", b"{}", {"Content-Type": "application/json", "X-Archimet": "1",
                                                                     "Origin": "http://pi.local:2501", "Cookie": f"KISMET={sid}"})
        s = self.logger.seen[-1]
        self.assertEqual((s["path"], s["headers"]["Origin"], s["headers"]["X-Archimet"], s["headers"]["Cookie"]),
                         ("/archimet/review", "http://pi.local:2501", "1", f"KISMET={sid}"))
        self.assertIsNone(h.get("Access-Control-Allow-Origin"))

    # ---------------------------------------------------------------- TLS
    def test_tls_network_access_redirect_and_stall(self):
        openssl = shutil.which("openssl")
        if not openssl:
            self.skipTest("openssl not available")
        creds = self.tmp / "creds"
        creds.mkdir(exist_ok=True)
        r = subprocess.run([openssl, "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-noenc",
                            "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
                            "-keyout", str(creds / "server.key"), "-out", str(creds / "server.crt")], capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        saved = {k: os.environ.get(k) for k in ("ARCHIMET_TLS_CERT", "ARCHIMET_TLS_KEY", "CREDENTIALS_DIRECTORY")}
        os.environ.update(ARCHIMET_TLS_CERT="server.crt", ARCHIMET_TLS_KEY="server.key", CREDENTIALS_DIRECTORY=str(creds))
        try:
            srv = self.G.make_server("127.0.0.1:0")
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"https://127.0.0.1:{srv.server_port}"
        ctx = ssl.create_default_context(cafile=str(creds / "server.crt"))
        try:
            self.remote()                                              # a phone on the LAN / hotspot
            self.assertEqual(self.call("/", base=base, ctx=ctx)[:2], (200, b"<title>Archimet</title>"))
            code, _, cookies = self.login(base=base, ctx=ctx)
            self.assertEqual(code, 200)
            self.assertIn("Secure", cookies[0])
            # Plain HTTP on the HTTPS port: a redirect, not a TLS error.
            with socket.create_connection(("127.0.0.1", srv.server_port)) as s:
                s.sendall(b"GET /devices HTTP/1.1\r\nHost: kismetpi.local:2501\r\n\r\n")
                head = s.recv(4096).decode()
            self.assertTrue(head.startswith("HTTP/1.1 301"), head)
            self.assertIn("Location: https://kismetpi.local:", head)
            # A client that connects and never sends anything does not block anyone else.
            stall = socket.create_connection(("127.0.0.1", srv.server_port))
            try:
                self.assertEqual(self.call("/", base=base, ctx=ctx)[0], 200)
            finally:
                stall.close()
        finally:
            srv.shutdown()
            srv.server_close()

    def test_policy_unit(self):
        P = self.G.policy_problem
        self.assertEqual(P("owner", "correct-horse-battery"), "")
        self.assertTrue(P("owner", "archimet"))
        self.assertTrue(P("owner", "123456789"))
        self.assertTrue(P("Owner12345", "owner12345"))
        self.assertTrue(P("", "correct-horse-battery"))


if __name__ == "__main__":
    unittest.main()
