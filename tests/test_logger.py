# SPDX-License-Identifier: GPL-2.0-or-later
"""Tests for pi/kismet-device-logger against fixtures and a fake Kismet API.

  python -m unittest tests/test_logger.py -v
"""
import base64
import importlib.machinery
import importlib.util
import json
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = ROOT / "shared" / "le_rules.json"
CRADLE =["00:30:44:00:00:15", "00:30:44:00:00:14", "00:30:44:00:00:13", "00:30:44:00:00:16", "00:30:44:00:00:17"]
NOW = time.time()
GOOD = "Basic " + base64.b64encode(b"kismet:secret").decode()


def load_logger():
    loader = importlib.machinery.SourceFileLoader("kdl", str(ROOT / "pi" / "kismet-device-logger"))
    spec = importlib.util.spec_from_loader("kdl", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


K = load_logger()


def dev(mac, typ="Wi-Fi Client", manuf="Unknown", name="", ssid="", phy=None, assoc_to=None, clients=None,
        probed=(), first=NOW - 60, last=NOW - 5, signal=-60, data=True, probe_bssid=""):
    """A Kismet record in the slim field-list shape the logger requests."""
    phy = phy or ("BTLE" if typ == "BTLE" else "IEEE802.11")
    d = {
        "kismet.device.base.key": f"{phy}_{mac}", "kismet.device.base.macaddr": mac, "kismet.device.base.type": typ,
        "kismet.device.base.phyname": "Bluetooth" if phy == "BTLE" else phy,
        "kismet.device.base.commonname": name or ssid or mac, "kismet.device.base.name": name or ssid or mac,
        "kismet.device.base.manuf": manuf, "kismet.device.base.crypt": "WPA2", "kismet.device.base.channel": "6",
        "kismet.device.base.first_time": int(first), "kismet.device.base.last_time": int(last),
        "kismet.common.signal.last_signal": signal,
    }
    if phy == "IEEE802.11":
        d["dot11.advertisedssid.ssid"] = ssid
        d["dot11.device.last_bssid"] = next(iter(assoc_to), "") if assoc_to else ""
        d["dot11.device.client_map"] = {b: {"dot11.client.bssid": b, "dot11.client.first_time": int(first),
                                            "dot11.client.last_time": int(last), "dot11.client.type": 0,
                                            "dot11.client.datasize": 0, "dot11.client.datasize_retry": 1500 if data else 0,
                                            "dot11.client.num_fragments": 0, "dot11.client.num_retries": 3 if data else 0}
                                        for b in (assoc_to or [])}
        d["dot11.device.associated_client_map"] = {c: "key" for c in (clients or [])}
        d["dot11.device.probed_ssid_map"] = [{"dot11.probedssid.ssid": s, "dot11.probedssid.bssid": probe_bssid or "00:00:00:00:00:00"}
                                             for s in probed]
    return d


GOOD_COOKIE = "test-session-0123456789abcdef"


class FakeKismet:
    """Serves /devices/last-time, /devices/by-mac and /session/check_session."""

    def __init__(self):
        self.devices = []
        self.up = True
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _reply(self, code, obj):
                body = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == "/session/check_session":
                    ok = self.headers.get("Authorization") == GOOD or self.headers.get("Cookie") == "KISMET=" + GOOD_COOKIE
                    return self._reply(200 if ok else 401, {})
                self._reply(404, {})

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                self.rfile.read(n)
                if self.headers.get("Authorization") != GOOD:
                    return self._reply(401, {})
                if "/devices/by-mac/" in self.path:
                    mac = self.path.split("/")[3]
                    return self._reply(200, [d for d in fake.devices if d["kismet.device.base.macaddr"] == mac])
                if "/devices/last-time/" in self.path:
                    return self._reply(200, fake.devices)
                self._reply(404, {})

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_port}"

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="archimet-test-"))
        (self.tmp / "plugin").mkdir()
        K.LE_HISTORY = self.tmp / "plugin" / "le_history.json"
        K.RULES_PATH = RULES
        self.kismet = FakeKismet()
        K.API = self.kismet.url
        self.rules = K.Rules.load(RULES)
        self.logs = K.Logs(self.rules, self.tmp)

    def tearDown(self):
        self.logs.close()
        self.kismet.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def poll(self, devices, logs=None):
        logs = logs or self.logs
        self.kismet.devices = devices
        parsed = [K.parse(d) for d in devices]
        merged = K.merge_by_mac(parsed)          # as run(): per-record AP/client rows, per-MAC LE/Review
        with logs.lock:
            n = sum(logs.log_device(d) for d in parsed if d["mac"])
            n += sum(logs.classify(d) for d in merged)
            n += logs.learn(merged, lambda m: K.fetch_mac(GOOD, m))
            logs.commit()
        return n

    def le(self, mac):
        return self.logs._get("law_enforcement.sqlite", "law_enforcement", mac)

    def rv(self, mac):
        return self.logs._get("rv", "rv.review", mac)

    def count(self, table):
        return self.logs.le.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def operator(self, mac, note="field-confirmed in-car router"):
        res = self.logs.mark(mac, note, "test operator", "127.0.0.1", lambda m: K.fetch_mac(GOOD, m))
        self.assertTrue(res["ok"])


AXON_BT = dev("00:25:DF:12:34:56", "BTLE", "Axon Enterprise, Inc.")
E110_A = dev("00:30:44:00:00:17", "Wi-Fi AP", "CradlePoint, Inc", ssid="E110-t01")
BRK = dev("0A:18:D6:00:10:01", "Wi-Fi AP", "Ubiquiti Inc", ssid="CityPolice")
HOMELAND = dev("80:AB:4D:00:10:04", "Wi-Fi AP", "Nokia Solutions and Networks GmbH & Co. KG", ssid="HomelandTest")
POPE = dev("4C:AB:F8:00:10:03", "Wi-Fi AP", "ASKEY COMPUTER CORP", ssid="TownPatrol")


class Rules(Base):
    def test_rules_file_valid_and_versioned(self):
        self.assertEqual(self.rules.version, "5.0.2")
        self.assertEqual(len(self.rules.sha), 64)
        raw = json.loads(RULES.read_text(encoding="utf-8"))
        for r in raw["rules"]:
            self.assertTrue(r.get("source"), r["id"])
            self.assertTrue(r.get("basis"), r["id"])
        self.assertNotIn("70B3D5178", self.rules.prefix)      # Gamber-Johnson, not ELSAG
        self.assertIn("70B3D51C5", self.rules.prefix)

    def test_fleet_vendors_are_not_device_class(self):
        for mac in ["00:30:44:00:00:01", "00:A0:D5:00:00:01", "00:04:7D:00:00:01", "00:15:FF:00:00:01",
                    "00:11:6E:00:00:01", "9C:83:BF:00:00:01", "12:20:13:00:00:01"]:
            rule, _ = self.rules.mac_rule(mac)
            self.assertIsNotNone(rule, mac)
            self.assertNotEqual(rule["class"], "device", mac)

    def test_manuf_text_is_not_independent(self):
        sigs = self.rules.signals(K.parse(AXON_BT))
        self.assertEqual([s["evidence"] for s in sigs if s["class"] == "device"], ["oui"])

    def test_bad_rules_file_keeps_last_good(self):
        bad = self.tmp / "bad.json"
        bad.write_text('{"rules": [{"id": "x", "class": "device", "category": "nope"}]}')
        K.RULES_PATH = bad
        kept, _ = K.load_rules_or_keep(self.rules, 0)
        self.assertIs(kept, self.rules)
        K.RULES_PATH = RULES


class Classification(Base):
    def test_axon_bodycam_is_hardware(self):
        self.poll([AXON_BT])
        r = self.le("00:25:DF:12:34:56")
        self.assertEqual(r["category"], "body cam / taser")
        self.assertTrue(r["match_reason"].startswith("Hardware: Axon Enterprise, Inc. OUI 00:25:DF"))
        self.assertEqual(r["radio"], "Bluetooth")

    def test_unconfirmed_cradlepoint_goes_to_review(self):
        self.poll([dev("00:30:44:11:22:33", "Wi-Fi AP", "CradlePoint, Inc", ssid="IBR900-123")])
        self.assertIsNone(self.le("00:30:44:11:22:33"))
        r = self.rv("00:30:44:11:22:33")
        self.assertEqual(r["status"], "open")
        self.assertIn("A vendor OUI names the maker only", r["why_might_not"])
        self.assertIn("same vendor", r["why_might_not"])
        self.assertIn("CradlePoint", r["why_might_be"])

    def test_agency_names_stay_in_review(self):
        phones = [dev(f"AA:BB:CC:00:00:0{i}", manuf="Apple, Inc.", assoc_to=[ap["kismet.device.base.macaddr"]])
                  for i, ap in enumerate([BRK, HOMELAND, POPE])]
        self.poll([BRK, HOMELAND, POPE] + phones)
        for ap in (BRK, HOMELAND, POPE):
            mac = ap["kismet.device.base.macaddr"]
            self.assertIsNone(self.le(mac), mac)
            self.assertIn("agency word", self.rv(mac)["why_might_be"])
            self.assertIn("not hardware evidence", self.rv(mac)["why_might_not"])
        for p in phones:
            self.assertIsNone(self.le(p["kismet.device.base.macaddr"]))
            self.assertIsNone(self.rv(p["kismet.device.base.macaddr"]))
        self.assertEqual(self.count("law_enforcement"), 0)

    def test_agency_word_plus_fleet_oui_is_still_review(self):
        self.poll([dev("00:04:7D:01:02:03", "Wi-Fi AP", "Motorola Solutions Inc.", ssid="SheriffNet")])
        self.assertIsNone(self.le("00:04:7D:01:02:03"))
        self.assertEqual(self.rv("00:04:7D:01:02:03")["status"], "open")


class Learning(Base):
    def test_randomized_client_of_confirmed_ap_is_learned(self):
        self.poll([E110_A])
        self.operator("00:30:44:00:00:17")
        rnd = dev("DA:A1:19:00:00:01", manuf="Unknown", assoc_to=["00:30:44:00:00:17"])
        self.poll([E110_A, rnd])
        r = self.le("DA:A1:19:00:00:01")
        self.assertTrue(r["match_reason"].startswith("Learned: associated client of LE-log AP 00:30:44:00:00:17"))
        self.assertIn("evidence: Kismet client record for BSSID 00:30:44:00:00:17 shows 3 retried data frames", r["match_reason"])
        self.assertEqual(K.parent_of(r["match_reason"]), "00:30:44:00:00:17")
        self.assertEqual(r["category"], "associated (learned)")
        # The general client log still excludes randomized MACs.
        self.assertIsNone(self.logs._get("wifi_clients.sqlite", "wifi_clients", "DA:A1:19:00:00:01"))

    def test_hardware_client_teaches_its_ap_but_no_cascade(self):
        cam = dev("00:25:DF:11:22:33", "Wi-Fi Client", "Axon Enterprise, Inc.", assoc_to=["10:20:30:40:50:60"])
        ap = dev("10:20:30:40:50:60", "Wi-Fi AP", "Cisco", ssid="Unit12-Net", clients=["00:25:DF:11:22:33", "AA:00:00:00:00:01"])
        bystander = dev("AA:00:00:00:00:01", manuf="Apple, Inc.", assoc_to=["10:20:30:40:50:60"])
        self.poll([cam, ap, bystander])
        self.poll([cam, ap, bystander])
        self.assertTrue(self.le("00:25:DF:11:22:33")["match_reason"].startswith("Hardware:"))
        a = self.le("10:20:30:40:50:60")
        self.assertTrue(a["match_reason"].startswith("Learned: access point joined by LE-log device 00:25:DF:11:22:33"))
        self.assertIsNone(self.le("AA:00:00:00:00:01"))     # learned AP is not a parent

    def test_shared_or_public_ap_is_not_learned(self):
        cam = dev("00:25:DF:11:22:34", "Wi-Fi Client", "Axon Enterprise, Inc.",
                  assoc_to=["10:20:30:40:50:61", "10:20:30:40:50:62"])
        public = dev("10:20:30:40:50:61", "Wi-Fi AP", "Cisco", ssid="xfinitywifi")
        busy = dev("10:20:30:40:50:62", "Wi-Fi AP", "Cisco", ssid="CafeNet",
                   clients=[f"AA:00:00:00:01:{i:02X}" for i in range(20)])
        self.poll([cam, public, busy])
        for m in ("10:20:30:40:50:61", "10:20:30:40:50:62"):
            self.assertIsNone(self.le(m), m)
            self.assertIn("looks shared", self.rv(m)["why_might_not"])

    def test_similar_rssi_without_relationship_is_not_promoted(self):
        twin = dev("AC:DE:48:00:11:22", "BTLE", "Unknown", signal=-41, first=NOW - 60, last=NOW - 5)
        axon = dev("00:25:DF:12:34:56", "BTLE", "Axon Enterprise, Inc.", signal=-41, first=NOW - 60, last=NOW - 5)
        self.poll([axon, twin])
        self.assertIsNone(self.le("AC:DE:48:00:11:22"))
        self.assertIsNone(self.rv("AC:DE:48:00:11:22"))

    def test_probe_of_confirmed_ssid_is_review_only(self):
        self.poll([E110_A])
        self.operator("00:30:44:00:00:17")
        prober = dev("DA:00:00:00:00:02", probed=["E110-t01"])
        self.poll([E110_A, prober])
        self.assertIsNone(self.le("DA:00:00:00:00:02"))
        self.assertIn("names an SSID, not a particular access point", self.rv("DA:00:00:00:00:02")["why_might_not"])

    def test_confirmed_hardware_probe_does_not_promote_ap(self):
        cam = dev("00:25:DF:11:22:35", "Wi-Fi Client", "Axon Enterprise, Inc.", probed=["Unit12"])
        unit = dev("02:00:00:00:00:0A", "Wi-Fi AP", ssid="Unit12")
        self.poll([cam, unit])
        self.assertIsNone(self.le("02:00:00:00:00:0A"))
        self.assertIn("probed for this AP's SSID", self.rv("02:00:00:00:00:0A")["why_might_be"])
        self.assertIn("does not identify", self.rv("02:00:00:00:00:0A")["why_might_not"])

    def test_learned_cap(self):
        self.poll([E110_A])
        self.operator("00:30:44:00:00:17")
        cl = [dev(f"DA:00:00:00:02:{i:02X}", assoc_to=["00:30:44:00:00:17"]) for i in range(14)]
        self.poll([E110_A] + cl)
        learned = self.logs.le.execute("SELECT COUNT(*) FROM law_enforcement WHERE match_reason LIKE 'Learned:%'").fetchone()[0]
        self.assertEqual(learned, self.rules.max_clients)
        self.assertEqual(self.logs.le.execute("SELECT COUNT(*) FROM rv.review WHERE signals LIKE '%parent-full%'").fetchone()[0], 2)

    def test_adjacent_mac_is_review(self):
        self.poll([E110_A])
        self.operator("00:30:44:00:00:17")
        sib = dev("00:30:44:00:00:16", "Wi-Fi AP", "CradlePoint, Inc", ssid="")
        self.poll([E110_A, sib])
        self.assertIsNone(self.le("00:30:44:00:00:16"))
        self.assertIn("adjacent", self.rv("00:30:44:00:00:16")["why_might_be"])


class Persistence(Base):
    def test_strongest_reason_kept(self):
        self.poll([E110_A])
        self.operator("00:30:44:00:00:17")
        cam = dev("00:25:DF:44:55:66", "Wi-Fi Client", "Axon Enterprise, Inc.", assoc_to=["00:30:44:00:00:17"])
        self.poll([E110_A, cam])
        self.assertTrue(self.le("00:25:DF:44:55:66")["match_reason"].startswith("Hardware:"))
        # learned first, then operator, then a later learned attempt
        c = dev("DA:00:00:00:03:01", assoc_to=["00:30:44:00:00:17"])
        self.poll([E110_A, c])
        self.assertTrue(self.le("DA:00:00:00:03:01")["match_reason"].startswith("Learned:"))
        self.operator("DA:00:00:00:03:01", "seen in the cruiser")
        self.logs.learned_seen.clear()
        self.poll([E110_A, c])
        self.assertTrue(self.le("DA:00:00:00:03:01")["match_reason"].startswith("Operator:"))
        # marking a hardware device keeps the hardware reason
        self.operator("00:25:DF:44:55:66", "also marked")
        self.assertTrue(self.le("00:25:DF:44:55:66")["match_reason"].startswith("Hardware:"))

    def test_repeated_polls_and_restart_do_not_duplicate_or_write(self):
        fixture = [AXON_BT, E110_A, BRK, HOMELAND, POPE, dev("AA:00:00:00:00:09", manuf="Apple, Inc.")]
        self.assertGreater(self.poll(fixture), 0)
        before = {f: (self.tmp / f).stat().st_mtime_ns for f in K.SCHEMA}
        hist = K.LE_HISTORY.stat().st_mtime_ns
        changes = sum(c.total_changes for c in self.logs.db.values())
        self.assertEqual(self.poll(fixture), 0)
        self.assertEqual(self.poll(fixture), 0)
        self.assertEqual(sum(c.total_changes for c in self.logs.db.values()), changes)
        self.assertEqual(K.LE_HISTORY.stat().st_mtime_ns, hist)
        self.assertEqual({f: (self.tmp / f).stat().st_mtime_ns for f in K.SCHEMA}, before)
        counts = (self.count("law_enforcement"), self.count("rv.review"))
        # "service restart": a new process over the same files
        logs2 = K.Logs(self.rules, self.tmp)
        self.assertEqual(self.poll(fixture, logs2), 0)
        self.assertEqual((logs2.le.execute("SELECT COUNT(*) FROM law_enforcement").fetchone()[0],
                          logs2.le.execute("SELECT COUNT(*) FROM rv.review").fetchone()[0]), counts)
        logs2.close()

    def test_first_seen_is_earliest_and_last_seen_is_a_date(self):
        old = dev("00:25:DF:12:34:57", "BTLE", "Axon Enterprise, Inc.", first=NOW - 86400 * 3, last=NOW - 86400 * 3)
        self.poll([old])
        new = dev("00:25:DF:12:34:57", "BTLE", "Axon Enterprise, Inc.", first=NOW - 30, last=NOW - 5)
        self.poll([new])
        r = self.le("00:25:DF:12:34:57")
        self.assertEqual(r["first_seen"], K.ts(NOW - 86400 * 3))
        self.assertEqual(r["last_seen"], K.day(NOW - 5))

    def test_failed_poll_rolls_back_everything(self):
        self.poll([E110_A])
        orig = self.logs.learn
        hist = K.LE_HISTORY.read_text()

        def boom(*a, **k):
            raise sqlite3.OperationalError("disk I/O error (simulated)")
        self.logs.learn = boom
        parsed = [K.parse(d) for d in [AXON_BT, BRK]]
        with self.assertRaises(sqlite3.OperationalError):
            with self.logs.lock:
                try:
                    for d in parsed:
                        self.logs.record(d)
                    self.logs.learn(parsed)
                    self.logs.commit()
                except Exception:
                    self.logs.rollback()
                    raise
        self.logs.learn = orig
        self.assertIsNone(self.le("00:25:DF:12:34:56"))
        self.assertIsNone(self.rv("0A:18:D6:00:10:01"))
        self.assertEqual(K.LE_HISTORY.read_text(), hist)

    def test_interrupted_json_export_leaves_old_file(self):
        self.poll([AXON_BT])
        good = K.LE_HISTORY.read_text()
        real = os.replace

        def fail(*a):
            raise OSError("power cut (simulated)")
        K.os.replace = fail
        try:
            with self.assertRaises(OSError):
                self.logs.le_dirty = True
                self.logs.commit()
        finally:
            K.os.replace = real
        self.assertEqual(K.LE_HISTORY.read_text(), good)
        self.assertEqual([p.name for p in K.LE_HISTORY.parent.iterdir()], ["le_history.json"])
        json.loads(K.LE_HISTORY.read_text())


def make_le_fixture(path):
    """A synthetic pre-migration LE log with the same shape as a real one: one hardware row,
    five CradlePoint rows and eleven agency-keyword rows. All MACs, names and times are invented
    (vendor OUIs are real public IEEE assignments so the manufacturer rules still apply)."""
    con = sqlite3.connect(path)
    con.execute(K.SCHEMA["law_enforcement.sqlite"])
    cp = ("in-car router / MDT", "Wi-Fi", "Wi-Fi AP")
    kw = ("agency keyword", "Wi-Fi", "Wi-Fi AP")
    rows = [("00:25:DF:12:34:56", "body cam / taser", "Bluetooth", "BTLE", "", "Axon Enterprise, Inc.",
             "mac prefix: 00:25:DF; manufacturer: Axon Enterprise, Inc.", "", "2026-01-15 11:38:58", "2026-01-15")]
    for mac, name, t in (("00:30:44:00:00:13", "", "18:02:54"), ("00:30:44:00:00:14", "E110-t02", "18:01:20"),
                         ("00:30:44:00:00:15", "E110-t02", "17:45:35"), ("00:30:44:00:00:16", "E110-t01", "18:07:48"),
                         ("00:30:44:00:00:17", "E110-t01", "18:08:01")):
        rows.append((mac, *cp, name, "CradlePoint, Inc", "manufacturer: CradlePoint, Inc", "WPA2 WPA2-PSK AES-CCMP", f"2026-01-15 {t}", "2026-01-15"))
    for mac, ssid, manuf, t in (("0A:18:D6:00:10:01", "CityPolice", "Ubiquiti Inc", "17:40:28"),
                                ("3C:37:86:00:10:02", "CityPolice-5", "NETGEAR", "11:32:19"),
                                ("4C:AB:F8:00:10:03", "TownPatrol", "ASKEY COMPUTER CORP", "18:06:40"),
                                ("80:3F:5D:00:10:05", "HomelandTest_EXT2.4G", "Winstars Technology Ltd", "17:44:05"),
                                ("80:3F:5D:00:10:06", "HomelandTest_EXT5G", "Winstars Technology Ltd", "18:01:56"),
                                ("80:AB:4D:00:10:04", "HomelandTest", "Nokia Solutions and Networks GmbH & Co. KG", "18:01:54"),
                                ("80:AB:4D:00:10:07", "HomelandTest", "Nokia Solutions and Networks GmbH & Co. KG", "18:01:57"),
                                ("80:AB:4D:00:10:08", "HomelandTest", "Nokia Solutions and Networks GmbH & Co. KG", "18:01:51"),
                                ("86:AB:4D:00:10:09", "HomelandTest_Guest", "Unknown", "18:02:07"),
                                ("86:AB:4D:00:10:0A", "HomelandTest_Guest", "Unknown", "18:01:57"),
                                ("86:AB:4D:00:10:0B", "HomelandTest_Guest", "Unknown", "18:01:51")):
        rows.append((mac, *kw, ssid, manuf, f"ssid: {ssid}", "WPA2 WPA2-PSK AES-CCMP", f"2026-01-15 {t}", "2026-01-15"))
    con.executemany("INSERT INTO law_enforcement VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
    con.commit()
    con.close()


class Migration(Base):
    def setUp(self):
        super().setUp()
        self.logs.close()
        os.remove(self.tmp / "law_enforcement.sqlite")
        make_le_fixture(self.tmp / "law_enforcement.sqlite")
        self.fixture = self.tmp / "fixture_le.sqlite"
        make_le_fixture(self.fixture)
        os.remove(self.tmp / K.REVIEW_DB)
        self.out_before = K.OUT
        K.OUT = self.tmp
        self.logs.close()
        self.logs = K.Logs(self.rules, self.tmp)

    def tearDown(self):
        K.OUT = self.out_before
        super().tearDown()

    def test_migration_moves_keyword_rows_and_is_reversible(self):
        self.assertEqual(self.count("law_enforcement"), 17)
        rep = K.migrate(set(CRADLE), "user-confirmed in-car CradlePoint radios (test)")
        self.assertEqual(rep["before"]["le_rows"], 17)
        self.assertEqual(rep["after"]["le_rows"], 6)
        self.assertEqual(rep["after"]["by_kind"], {"hardware": 1, "operator": 5})
        self.assertEqual(rep["after"]["review_rows"], 11)
        moved = [a for a in rep["actions"] if a["action"] == "moved-to-review"]
        self.assertEqual(len(moved), 11)
        logs = K.Logs(self.rules, self.tmp)
        for mac in ("0A:18:D6:00:10:01", "4C:AB:F8:00:10:03", "80:AB:4D:00:10:04"):
            r = logs._get("rv", "rv.review", mac)
            self.assertEqual(r["status"], "open")
            self.assertIn("agency word", r["why_might_be"])
            self.assertIn("was in law_enforcement.sqlite", r["why_might_be"])
        brk = logs._get("rv", "rv.review", "0A:18:D6:00:10:01")
        self.assertEqual(brk["first_seen"], "2026-01-15 17:40:28")
        hist = json.loads(K.LE_HISTORY.read_text())
        self.assertEqual(len(hist["devices"]), 6)
        # idempotent
        rep2 = K.migrate(set(CRADLE), "user-confirmed in-car CradlePoint radios (test)")
        self.assertEqual(rep2["actions"], [])
        # reversible from its own log
        K.rollback_migration()
        logs3 = K.Logs(self.rules, self.tmp)
        rows = logs3.le.execute("SELECT * FROM law_enforcement ORDER BY mac").fetchall()
        fx = sqlite3.connect(self.fixture)
        orig = fx.execute("SELECT * FROM law_enforcement ORDER BY mac").fetchall()
        fx.close()
        self.assertEqual(rows, orig)
        self.assertEqual(logs3.le.execute("SELECT COUNT(*) FROM rv.review").fetchone()[0], 0)
        self.assertEqual(len(json.loads(K.LE_HISTORY.read_text())["devices"]), 17)
        for lg in (logs, logs3):
            lg.close()


class ApiTests(Base):
    def setUp(self):
        super().setUp()
        K.HTTP_BIND = "127.0.0.1:0"
        self.status = {"version": K.VERSION}
        K.Api._ok_cache.clear()
        self.srv = K.start_api(self.logs, self.status, GOOD)
        self.base = f"http://127.0.0.1:{self.srv.server_port}"
        self.poll([E110_A, BRK])

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        super().tearDown()

    def call(self, path, body=None, auth=GOOD, origin=None, headers=None, raw=None):
        h = {"Content-Type": "application/json", "X-Archimet": "1"}
        if auth:
            h["Authorization"] = auth
        if origin:
            h["Origin"] = origin
        h.update(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.load(r), r.headers
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.loads(e.read() or b"{}"), e.headers

    def test_auth_origin_and_validation(self):
        self.assertEqual(self.call("/archimet/health", auth=None)[0], 200)
        self.assertEqual(self.call("/archimet/state.json", auth=None)[0], 401)
        bad = "Basic " + base64.b64encode(b"kismet:wrong").decode()
        self.assertEqual(self.call("/archimet/state.json", auth=bad)[0], 401)
        self.assertEqual(self.call("/archimet/state.json", origin="http://evil.example:2501")[0], 403)
        code, _, hdr = self.call("/archimet/state.json", origin="http://127.0.0.1:2501")
        self.assertEqual(code, 200)
        self.assertEqual(hdr["Access-Control-Allow-Origin"], "http://127.0.0.1:2501")
        self.assertEqual(self.call("/archimet/mark", {"mac": "zz", "note": "abc"})[0], 400)
        self.assertEqual(self.call("/archimet/mark", {"mac": "0A18D6001001", "note": ""})[0], 400)
        self.assertEqual(self.call("/archimet/mark", {"mac": "0A18D6001001", "note": "x" * 501})[0], 400)
        self.assertEqual(self.call("/archimet/mark", {"mac": "0A18D6001001", "note": "abc"}, headers={"X-Archimet": ""})[0], 400)
        self.assertEqual(self.call("/archimet/mark", raw=b"x" * 5000)[0], 413)
        self.assertEqual(self.call("/archimet/mark", {"mac": "0A18D6001001", "note": "abc"}, auth=bad)[0], 401)
        self.assertIsNone(self.le("0A:18:D6:00:10:01"))

    def test_mark_and_unmark_round_trip(self):
        code, res, _ = self.call("/archimet/mark", {"mac": "0a-18-d6-00-10-01", "note": "Saw the marked unit\nparked here"})
        self.assertEqual((code, res["ok"]), (200, True))
        r = self.le("0A:18:D6:00:10:01")
        self.assertTrue(r["match_reason"].startswith("Operator: marked LE by an authenticated Kismet UI user from 127.0.0.1"))
        self.assertIn("Note: Saw the marked unit parked here", r["match_reason"])
        self.assertIn("Review evidence then:", r["match_reason"])
        self.assertEqual(self.rv("0A:18:D6:00:10:01")["status"], "marked")
        hist = json.loads(K.LE_HISTORY.read_text())
        self.assertIn("0A:18:D6:00:10:01", [d["mac"] for d in hist["devices"]])
        st = self.call("/archimet/state.json")[1]
        self.assertEqual([o["mac"] for o in st["overrides"]], ["0A:18:D6:00:10:01"])
        self.assertEqual(st["official"][0]["kind"], "operator")
        self.assertEqual(st["audit"][0]["action"], "mark")
        self.assertNotIn("secret", json.dumps(st))
        code, res, _ = self.call("/archimet/unmark", {"mac": "0A18D6001001", "note": "wrong car"})
        self.assertEqual((code, res["le_row_removed"]), (200, True))
        self.assertIsNone(self.le("0A:18:D6:00:10:01"))
        self.assertEqual(self.rv("0A:18:D6:00:10:01")["status"], "open")
        self.assertEqual(self.call("/archimet/state.json")[1]["audit"][0]["action"], "unmark")

    def test_change_token(self):
        st = self.call("/archimet/state.json")[1]
        tok = st["rev"]
        same = self.call("/archimet/state.json?rev=" + tok)[1]
        self.assertTrue(same.get("unchanged"))
        self.poll([E110_A, BRK])                       # nothing new: token unchanged
        self.assertTrue(self.call("/archimet/state.json?rev=" + tok)[1].get("unchanged"))
        self.poll([E110_A, BRK, POPE])                 # new Review row: token changes
        st2 = self.call("/archimet/state.json?rev=" + tok)[1]
        self.assertFalse(st2.get("unchanged", False))
        self.assertIn("4C:AB:F8:00:10:03", [r["mac"] for r in st2["review"]])

    def test_le_history_is_authenticated(self):
        self.assertEqual(self.call("/archimet/le_history.json", auth=None)[0], 401)
        code, body, _ = self.call("/archimet/le_history.json")
        self.assertEqual(code, 200)
        self.assertIn("devices", body)

    def test_metrics_is_authenticated_and_private(self):
        self.assertEqual(self.call("/archimet/metrics.json", auth=None)[0], 401)
        bad = "Basic " + base64.b64encode(b"kismet:wrong").decode()
        self.assertEqual(self.call("/archimet/metrics.json", auth=bad)[0], 401)
        code, body, _ = self.call("/archimet/metrics.json")
        self.assertEqual(code, 200)
        for k in ("cpu", "throttled", "memory", "disks", "usb", "wifi", "capture_helpers", "events"):
            self.assertIn(k, body)
        # No MAC addresses in the hardware snapshot.
        self.assertNotRegex(json.dumps(body), r"(?i)\b[0-9a-f]{2}(:[0-9a-f]{2}){5}\b")

    def test_browser_cookie_auth_cors_and_csrf(self):
        o = "http://127.0.0.1:2501"
        cookie = {"Cookie": "other=1; KISMET=" + GOOD_COOKIE}
        code, _, hdr = self.call("/archimet/state.json", auth=None, origin=o, headers=cookie)
        self.assertEqual(code, 200)
        self.assertEqual(hdr["Access-Control-Allow-Credentials"], "true")
        self.assertEqual(hdr["Access-Control-Allow-Origin"], o)
        self.assertEqual(self.call("/archimet/state.json", auth=None, headers={"Cookie": "KISMET=wrong-session-value"})[0], 401)
        self.assertEqual(self.call("/archimet/state.json", auth=None, headers={"Cookie": "KISMET=x"})[0], 401)   # malformed
        # Cookie-authenticated writes need this host's Origin (CSRF); foreign origins are refused.
        body = {"mac": "0A18D6001001", "note": "abc"}
        self.assertEqual(self.call("/archimet/mark", body, auth=None, headers=cookie)[0], 403)
        self.assertEqual(self.call("/archimet/mark", body, auth=None, origin="http://evil.example", headers=cookie)[0], 403)
        self.assertEqual(self.call("/archimet/mark", body, auth=None, origin=o, headers={**cookie, "X-Archimet": ""})[0], 400)
        self.assertIsNone(self.le("0A:18:D6:00:10:01"))

    def test_known_json(self):
        o = "http://127.0.0.1:2501"
        cookie = {"Cookie": "KISMET=" + GOOD_COOKIE}
        macs = [E110_A["kismet.device.base.macaddr"], BRK["kismet.device.base.macaddr"], "00:00:00:00:00:01", "junk"]
        code, res, _ = self.call("/archimet/known.json", {"macs": macs}, auth=None, origin=o, headers=cookie)
        self.assertEqual(code, 200)
        self.assertTrue(res)
        for mac, r in res.items():
            self.assertIn(mac, macs)
            self.assertEqual(set(r), {"first_seen", "log"})
            self.assertIn(r["log"], ("access point", "client"))
        self.assertNotIn("00:00:00:00:00:01", res)
        self.assertEqual(self.call("/archimet/known.json", {"macs": macs}, auth=None)[0], 403)          # no Origin, no Basic
        self.assertEqual(self.call("/archimet/known.json", {"macs": macs}, auth=None, origin=o)[0], 401)  # no session
        self.assertEqual(self.call("/archimet/known.json", {"macs": ["00:00:00:00:00:01"] * 501})[0], 400)

    def test_archive_read_only(self):
        self.poll([dev("B8:32:8F:00:00:01", "Wi-Fi AP", "eero inc.", ssid="Home_50%"), dev("B8:32:8F:00:00:02", "Wi-Fi AP", "eero inc.", ssid="Other")])
        with self.logs.lock:
            for d in (K.parse(dev("B8:32:8F:00:00:01", "Wi-Fi AP", "eero inc.", ssid="Home_50%")), K.parse(dev("B8:32:8F:00:00:02", "Wi-Fi AP", "eero inc.", ssid="Other"))):
                self.logs.log_device(d)
            self.logs.commit()
        self.assertEqual(self.call("/archimet/archive.json?table=ap", auth=None, origin="http://127.0.0.1:2501")[0], 401)
        code, res, _ = self.call("/archimet/archive.json?table=ap&q=B8:32:8F")
        self.assertEqual((code, res["total"]), (200, 2))
        self.assertIn("ssid", res["columns"])
        self.assertEqual(set(res["tables"]), set(K.Logs.ARCHIVE))
        # LIKE wildcards in the search are literal: "50%" matches only the SSID that contains it.
        code, res, _ = self.call("/archimet/archive.json?table=ap&q=50%25")
        self.assertEqual([r[res["columns"].index("ssid")] for r in res["rows"]], ["Home_50%"])
        self.assertEqual(self.call("/archimet/archive.json?table=ap&q=_")[1]["total"], 1)
        # Unknown table refused; an unknown sort column falls back to the default (never interpolated).
        self.assertEqual(self.call("/archimet/archive.json?table=sqlite_master")[0], 400)
        code, res, _ = self.call("/archimet/archive.json?table=ap&sort=mac;DROP%20TABLE%20access_points")
        self.assertEqual((code, res["sort"]), (200, "last_seen"))
        self.assertEqual(self.call("/archimet/archive.json?table=ap&length=100000")[1]["length"], 200)
        for t in K.Logs.ARCHIVE:
            self.assertEqual(self.call(f"/archimet/archive.json?table={t}")[0], 200, t)

    def raw_request(self, origin_lines):
        """A raw HTTP request, so the Origin header can be shaped as no client library would send it."""
        import socket
        req = (f"GET /archimet/health HTTP/1.1\r\nHost: 127.0.0.1:{self.srv.server_port}\r\n{origin_lines}"
               f"Authorization: {GOOD}\r\nConnection: close\r\n\r\n").encode("latin-1")
        with socket.create_connection(("127.0.0.1", self.srv.server_port), timeout=10) as s:
            s.sendall(req)
            data = b""
            while chunk := s.recv(4096):
                data += chunk
        return data.split(b"\r\n\r\n", 1)[0].decode("latin-1")

    def test_origin_never_splits_the_response(self):
        """CodeQL py/http-response-splitting (2026-10-23): the raw Origin was echoed after a host check that
        urlsplit() passes even when the value carries a folded line. Now: refused, or echoed rebuilt."""
        host = f"127.0.0.1:{self.srv.server_port}"
        for bad in (f"Origin: http://{host}\r\n X-Injected: 1\r\n",                 # obs-fold continuation line
                    f"Origin: http://{host}\r\n\tSet-Cookie: KISMET=evil\r\n",      # tab-folded
                    f"Origin: http://{host}/path\r\n",                               # not an origin
                    "Origin: javascript://127.0.0.1\r\n"):
            head = self.raw_request(bad)
            lines = head.split("\r\n")
            self.assertFalse(any(l.lstrip().lower().startswith(("x-injected", "set-cookie")) for l in lines), head)
            self.assertFalse(any(l.startswith("Access-Control-Allow-Origin") for l in lines), head)
        head = self.raw_request(f"Origin: http://127.0.0.1:{self.srv.server_port}\r\n")
        self.assertIn(f"Access-Control-Allow-Origin: http://{host}", head)            # canonical, rebuilt

    def test_archive_combined_sources(self):
        """Combined Archive search (2026-10-23): selected sources only, one labelled schema, the same MAC in
        two sources stays two rows, bounded paging, strict allowlist, parameterised search."""
        ap, cl = "B8:32:8F:00:00:11", "B8:32:8F:00:00:12"
        self.poll([dev(ap, "Wi-Fi AP", "eero inc.", ssid="Shared-Name"), dev(cl, "Wi-Fi Client", "eero inc.")])
        with self.logs.lock:
            for d in (K.parse(dev(ap, "Wi-Fi AP", "eero inc.", ssid="Shared-Name")), K.parse(dev(cl, "Wi-Fi Client", "eero inc.", name="Shared-Name"))):
                self.logs.log_device(d)
            self.logs.commit()
        self.assertEqual(self.call("/archimet/archive.json?tables=ap,clients", auth=None, origin="http://127.0.0.1:2501")[0], 401)
        code, res, _ = self.call("/archimet/archive.json?tables=ap&q=B8:32:8F:00:00:1")
        self.assertEqual(code, 200)
        self.assertTrue(res["combined"])
        self.assertEqual(res["columns"], ["source", "source_label", "mac", "name", "first_seen", "last_seen", "summary"])
        self.assertEqual({r[0] for r in res["rows"]}, {"ap"})                       # search only in the selected source
        single = self.call("/archimet/archive.json?table=ap&q=B8:32:8F:00:00:1")[1]["total"]
        self.assertEqual(res["total"], single)                                      # same answer as the single view
        code, res, _ = self.call("/archimet/archive.json?tables=ap,clients&q=B8:32:8F:00:00:1")
        self.assertEqual({r[0] for r in res["rows"]}, {"ap", "clients"})
        self.assertEqual(res["total"], res["counts"]["ap"] + res["counts"]["clients"])
        # The same text in two sources: two rows, each labelled with its source (two facts, not a duplicate).
        code, res, _ = self.call("/archimet/archive.json?tables=all&q=Shared-Name")
        self.assertEqual(sorted((r[0], r[2]) for r in res["rows"] if r[2] in (ap, cl)), [("ap", ap), ("clients", cl)])
        self.assertEqual(res["selected"], list(K.Logs.ARCHIVE))
        # Ordering is stable across calls and newest first.
        again = self.call("/archimet/archive.json?tables=all&q=Shared-Name")[1]
        self.assertEqual(res["rows"], again["rows"])
        lasts = [r[5] for r in res["rows"]]
        self.assertEqual(lasts, sorted(lasts, reverse=True))
        # Empty result, unknown table, too-deep paging, injection text only ever a LIKE parameter.
        self.assertEqual(self.call("/archimet/archive.json?tables=ap,le&q=zz-no-such-thing")[1]["total"], 0)
        self.assertEqual(self.call("/archimet/archive.json?tables=ap,sqlite_master")[0], 400)
        self.assertEqual(self.call("/archimet/archive.json?tables=ap&page=1000&length=200")[0], 400)
        code, res, _ = self.call("/archimet/archive.json?tables=ap&q=%27%20OR%201%3D1%20--")
        self.assertEqual((code, res["total"]), (200, 0))
        with self.logs.lock:
            self.assertGreaterEqual(self.logs.db["access_points.sqlite"].execute("SELECT COUNT(*) FROM access_points").fetchone()[0], 1)

    def test_review_resolve_api(self):
        mac = "A0:04:60:00:20:01"
        self.poll([dev(mac, "Wi-Fi AP", "NETGEAR", ssid="TownPolice-9")])
        self.assertEqual(self.call("/archimet/review", {"mac": mac, "action": "dismiss", "note": "x"})[0], 400)       # note too short
        self.assertEqual(self.call("/archimet/review", {"mac": mac, "action": "delete", "note": "xxxx"})[0], 400)
        self.assertEqual(self.call("/archimet/review", {"mac": mac, "action": "dismiss", "note": "xxxx"}, auth=None)[0], 403)   # no Origin
        self.assertEqual(self.call("/archimet/review", {"mac": mac, "action": "dismiss", "note": "xxxx"}, auth=None,
                                   origin="http://127.0.0.1:2501")[0], 401)                                                  # no session
        self.assertEqual(self.call("/archimet/review", {"mac": mac, "action": "dismiss", "note": "xxxx"}, origin="http://evil.example:2501")[0], 403)
        code, res, _ = self.call("/archimet/review", {"mac": "a0-04-60-00-20-01", "action": "dismiss", "note": "a neighbour's router"})
        self.assertEqual((code, res["ok"]), (200, True))
        st = self.call("/archimet/state.json")[1]
        self.assertEqual([r["mac"] for r in st["review_dismissed"]], [mac])
        self.assertEqual(st["review_dismissed"][0]["resolution"]["locked"], 1)

    def test_kismet_down_is_503(self):
        self.kismet.close()
        K.Api._ok_cache.clear()
        self.assertEqual(self.call("/archimet/state.json")[0], 503)


class UnmarkWatch(Base):
    def test_unmark_without_review_row_goes_to_review_watched_and_seen_again_is_audited(self):
        E110_OLD = dict(E110_A, **{"kismet.device.base.first_time": int(NOW - 7200)})
        self.poll([E110_OLD])
        self.operator("00:30:44:00:00:17")
        self.assertEqual(self.rv("00:30:44:00:00:17")["status"], "marked")
        self.logs.le.execute("DELETE FROM rv.review WHERE mac='00:30:44:00:00:17'")   # like a migration-confirmed row
        self.logs.commit()
        res = self.logs.unmark("00:30:44:00:00:17", "router, not its operator; tell me if seen again", "test", "127.0.0.1")
        self.assertTrue(res["le_row_removed"])
        r = self.rv("00:30:44:00:00:17")
        self.assertEqual(r["status"], "open")
        self.assertIn("Operator: router, not its operator", r["why_might_not"])
        self.assertIn("CradlePoint", r["why_might_be"])
        self.assertIn('"watch": true', r["signals"])
        # a client of it is no longer learned
        c = dev("DA:00:00:00:09:01", assoc_to=["00:30:44:00:00:17"])
        self.poll([E110_A, c])
        self.assertIsNone(self.le("DA:00:00:00:09:01"))
        notices = lambda lg: lg.le.execute("SELECT COUNT(*) FROM rv.audit WHERE action='seen-again'").fetchone()[0]
        self.assertEqual(notices(self.logs), 0)                     # still in the same sighting session
        back = dict(E110_A, **{"kismet.device.base.last_time": int(NOW + 4000)})
        self.poll([back])
        self.poll([back])
        self.assertEqual(notices(self.logs), 1)                     # absent > 30 min, then heard: one notice
        self.assertEqual(self.rv("00:30:44:00:00:17")["status"], "open")   # a re-sighting never promotes
        self.assertIsNone(self.le("00:30:44:00:00:17"))
        logs2 = K.Logs(self.rules, self.tmp)                         # survives restart
        self.assertIn("00:30:44:00:00:17", logs2.watched)
        self.poll([back], logs2)
        self.assertEqual(notices(logs2), 1)
        self.poll([dict(E110_A, **{"kismet.device.base.last_time": int(NOW + 9000)})], logs2)
        self.assertEqual(notices(logs2), 2)                          # watched: every new session (no 6 h limit)
        logs2.close()

    def test_repair_unmarked_from_audit(self):
        self.poll([E110_A])
        self.operator("00:30:44:00:00:17")
        row = self.le("00:30:44:00:00:17")
        # what the first deployed unmark did: delete the row and override, no Review row
        self.logs.le.execute("DELETE FROM law_enforcement WHERE mac='00:30:44:00:00:17'")
        self.logs.le.execute("DELETE FROM rv.overrides")
        self.logs.le.execute("DELETE FROM rv.review")
        self.logs.le.execute("INSERT INTO rv.audit (at, actor, action, mac, detail) VALUES (?,?,?,?,?)",
                             ("2026-10-21 01:46:56", "ui", "unmark", "00:30:44:00:00:17",
                              json.dumps({"note": "keep in review", "le_row_removed": row})))
        self.logs.commit()
        self.assertEqual(self.logs.repair_unmarked(), 1)
        self.assertEqual(self.logs.repair_unmarked(), 0)            # idempotent
        r = self.rv("00:30:44:00:00:17")
        self.assertEqual((r["status"], r["name"]), ("open", "E110-t01"))
        self.assertIn("keep in review", r["why_might_not"])
        self.logs.le.execute("UPDATE rv.review SET why_might_be='stale'")
        self.logs.commit()
        self.assertEqual(self.logs.refresh_review_notes(), 1)
        self.assertIn("CradlePoint", self.rv("00:30:44:00:00:17")["why_might_be"])
        self.assertEqual(self.logs.refresh_review_notes(), 0)
        self.logs.le.execute("UPDATE rv.review SET signals='[]' WHERE mac='00:30:44:00:00:17'")
        self.logs.le.execute("INSERT INTO rv.audit (at, actor, action, mac, detail) VALUES (?,?,?,?,?)",
                             ("2026-10-21 02:00:00", "maintenance", "unwatch", "00:30:44:00:00:17", "{}"))
        self.logs.commit()
        self.assertEqual(self.logs.repair_unmarked(), 0)            # a deliberate unwatch is respected


class Evidence(Base):
    """Learned needs data-frame evidence; a client record alone (probe/auth attempt) is Review."""

    def test_probe_only_record_is_review_then_promoted_by_data_frames(self):
        self.poll([E110_A])
        self.operator("00:30:44:00:00:17")
        probe_only = dev("DA:00:00:00:0A:01", assoc_to=["00:30:44:00:00:17"], data=False,
                         probed=["E110-t01"], probe_bssid="00:30:44:00:00:17")
        self.poll([E110_A, probe_only])
        self.assertIsNone(self.le("DA:00:00:00:0A:01"))
        r = self.rv("DA:00:00:00:0A:01")
        self.assertEqual(r["status"], "open")
        self.assertIn("directed probe", r["why_might_not"])
        self.assertIn("becomes Learned automatically", r["why_might_not"])
        # Kismet later records retried data frames for the same pair -> Learned automatically
        joined = dev("DA:00:00:00:0A:01", assoc_to=["00:30:44:00:00:17"], data=True)
        self.poll([E110_A, joined])
        self.assertTrue(self.le("DA:00:00:00:0A:01")["match_reason"].startswith(
            "Learned: associated client of LE-log AP 00:30:44:00:00:17"))
        self.assertEqual(self.rv("DA:00:00:00:0A:01")["status"], "promoted")

    def test_hardware_client_ap_needs_data_frames_too(self):
        cam = dev("00:25:DF:11:22:40", "Wi-Fi Client", "Axon Enterprise, Inc.", assoc_to=["10:20:30:40:50:70"], data=False)
        ap = dev("10:20:30:40:50:70", "Wi-Fi AP", "Cisco", ssid="SomeNet")
        self.poll([cam, ap])
        self.assertIsNone(self.le("10:20:30:40:50:70"))
        self.assertIn("No data frame", self.rv("10:20:30:40:50:70")["why_might_not"])

    def test_dhcp_metadata_counts_as_data_frame_evidence(self):
        self.poll([E110_A])
        self.operator("00:30:44:00:00:17")
        c = dev("DA:00:00:00:0A:02", assoc_to=["00:30:44:00:00:17"], data=False)
        c["dot11.device.client_map"]["00:30:44:00:00:17"]["dot11.client.dhcp_host"] = "laptop"
        self.poll([E110_A, c])
        self.assertIn("data-frame metadata dhcp_host", self.le("DA:00:00:00:0A:02")["match_reason"])

    def test_withdrawn_parent_reevaluates_children(self):
        self.poll([E110_A])
        self.operator("00:30:44:00:00:17")
        other = dev("00:30:44:00:00:20", "Wi-Fi AP", "CradlePoint, Inc", ssid="Unit-B")
        self.poll([other])
        self.operator("00:30:44:00:00:20")
        only = dev("DA:00:00:00:0B:01", assoc_to=["00:30:44:00:00:17"])
        both = dev("DA:00:00:00:0B:02", assoc_to=["00:30:44:00:00:17", "00:30:44:00:00:20"])
        self.poll([E110_A, other, only, both])
        self.assertEqual(K.parent_of(self.le("DA:00:00:00:0B:01")["match_reason"]), "00:30:44:00:00:17")
        self.assertEqual(K.parent_of(self.le("DA:00:00:00:0B:02")["match_reason"]), "00:30:44:00:00:17")
        res = self.logs.unmark("00:30:44:00:00:17", "not police after all", "test", "127.0.0.1")
        self.assertEqual(sorted(res["learned_children_reevaluated"]), ["DA:00:00:00:0B:01", "DA:00:00:00:0B:02"])
        self.assertIsNone(self.le("DA:00:00:00:0B:01"))
        self.assertIn("no longer in the LE log", self.rv("DA:00:00:00:0B:01")["why_might_not"])
        self.poll([E110_A, other, only, both])            # next poll: re-evaluated
        self.assertIsNone(self.le("DA:00:00:00:0B:01"))   # its only parent is gone
        self.assertEqual(K.parent_of(self.le("DA:00:00:00:0B:02")["match_reason"]), "00:30:44:00:00:20")
        self.assertEqual(self.logs.le.execute("SELECT COUNT(*) FROM rv.audit WHERE action='learned-withdrawn'").fetchone()[0], 2)

    def test_audit_moves_unsupported_learned_rows(self):
        self.logs.le.execute("INSERT INTO law_enforcement VALUES (?,?,?,?,?,?,?,?,?,?)", (
            "DA:00:00:00:0C:01", "associated (learned)", "Wi-Fi", "Wi-Fi Client", "", "Unknown",
            "Learned: associated client of confirmed LE AP 00:30:44:00:00:17 (operator); Kismet association record first ? last ?; recorded x",
            "", "2026-10-21 01:00:00", "2026-10-21"))
        self.logs.commit()
        self.assertEqual(self.logs.audit_learned(), ["DA:00:00:00:0C:01"])
        self.assertIsNone(self.le("DA:00:00:00:0C:01"))
        self.assertIn("without data-frame evidence", self.rv("DA:00:00:00:0C:01")["why_might_not"])
        self.assertEqual(self.logs.audit_learned(), [])


class Sightings(Base):
    def test_bounded_sessions_and_rate_limited_notices(self):
        old = dev("0A:18:D6:00:10:01", "Wi-Fi AP", "Ubiquiti Inc", ssid="CityPolice", first=NOW - 86400, last=NOW - 86400)
        self.poll([old])                                   # creates the Review row and its first session (no notice)
        self.assertEqual(self.count("rv.sightings"), 1)
        self.poll([old])
        self.assertEqual(self.count("rv.sightings"), 1)
        notices = lambda: self.logs.le.execute("SELECT COUNT(*) FROM rv.audit WHERE action='resighted'").fetchone()[0]
        self.assertEqual(notices(), 0)
        t = NOW
        for i in range(30):                                # many polls in one session
            self.poll([dict(old, **{"kismet.device.base.last_time": int(t + i * 5)})])
        self.assertEqual(self.count("rv.sightings"), 2)    # the day-old row -> one new session now
        self.assertEqual(notices(), 1)                     # seen again after a day: one notice
        self.poll([dict(old, **{"kismet.device.base.last_time": int(t + 3600)})])   # new session within 6 h
        self.assertEqual(self.count("rv.sightings"), 3)
        self.assertEqual(notices(), 1)                     # rate-limited
        self.poll([dict(old, **{"kismet.device.base.last_time": int(t + 8 * 3600)})])
        self.assertEqual(notices(), 2)
        for k in range(25):                                # bounded history
            self.poll([dict(old, **{"kismet.device.base.last_time": int(t + 9 * 3600 + k * 2000)})])
        self.assertEqual(self.count("rv.sightings"), K.SIGHT_KEEP)
        st = self.logs.state()
        row = [r for r in st["review"] if r["mac"] == "0A:18:D6:00:10:01"][0]
        self.assertEqual((len(row["sightings"]), row["sighting_count"]), (5, K.SIGHT_KEEP))
        self.assertTrue(st["notices"])
        self.assertIsNone(self.le("0A:18:D6:00:10:01"))    # never promoted by re-sightings


class RunLoop(Base):
    def test_le_is_immediate_and_ap_client_writes_are_coalesced(self):
        creds = self.tmp / "httpd.conf"
        creds.write_text("httpd_username=kismet\nhttpd_password=secret\n")
        saved = (K.CREDS, K.OUT, K.POLL_SECONDS, K.LOG_FLUSH_SECONDS, K.HTTP_BIND)
        K.CREDS, K.OUT, K.POLL_SECONDS, K.LOG_FLUSH_SECONDS, K.HTTP_BIND = creds, self.tmp, 0.5, 4, "off"
        try:
            ap = dev("B8:32:8F:00:00:01", "Wi-Fi AP", "eero inc.", ssid="Home")
            self.kismet.devices = [ap]
            stop = threading.Event()
            th = threading.Thread(target=K.run, args=(stop,), daemon=True)
            th.start()
            self.addCleanup(lambda: (stop.set(), th.join(10)))     # the loop closes its own databases
            time.sleep(1.5)
            con = sqlite3.connect(self.tmp / "access_points.sqlite")
            self.addCleanup(con.close)
            self.assertEqual(con.execute("select channel from access_points").fetchall(), [("6",)])
            ap2 = dict(ap, **{"kismet.device.base.channel": "44"})
            self.kismet.devices = [ap2, AXON_BT]
            time.sleep(1.5)
            le = sqlite3.connect(self.tmp / "law_enforcement.sqlite")
            self.addCleanup(le.close)
            self.assertEqual(le.execute("select count(*) from law_enforcement").fetchone()[0], 1)   # LE: immediate
            self.assertEqual(con.execute("select channel from access_points").fetchall(), [("6",)])  # AP: buffered
            time.sleep(3.5)
            self.assertEqual(con.execute("select channel from access_points").fetchall(), [("44",)])  # flushed
            self.assertEqual(len(json.loads(K.LE_HISTORY.read_text())["devices"]), 1)
        finally:
            K.CREDS, K.OUT, K.POLL_SECONDS, K.LOG_FLUSH_SECONDS, K.HTTP_BIND = saved


class Observed(Base):
    """Minute-precision last observation (rv.observed) from Kismet's own last_time only."""

    def obs(self, mac):
        st = self.logs.state()
        row = [r for r in st["official"] + st["review"] if r["mac"] == mac]
        return row[0]["last_observed"] if row else "absent"

    def test_le_and_review_get_kismet_time(self):
        t = int(NOW) - 300
        self.poll([dev("00:25:DF:12:34:56", "BTLE", "Axon Enterprise, Inc.", last=t),
                   dev("00:30:44:00:00:17", "Wi-Fi AP", "CradlePoint, Inc", ssid="E110-t01", last=t)])
        self.assertEqual(self.obs("00:25:DF:12:34:56"), t)          # LE (hardware)
        self.assertEqual(self.obs("00:30:44:00:00:17"), t)          # Review
        self.assertIn("server_time", self.logs.state())

    def test_minute_throttle_and_monotonic(self):
        mac = "00:25:DF:12:34:56"
        t = (int(NOW) // 60) * 60 - 600
        self.poll([dev(mac, "BTLE", "Axon Enterprise, Inc.", last=t)])
        self.poll([dev(mac, "BTLE", "Axon Enterprise, Inc.", last=t + 30)])     # same minute: not rewritten
        self.assertEqual(self.obs(mac), t)
        self.poll([dev(mac, "BTLE", "Axon Enterprise, Inc.", last=t + 90)])     # next minute
        self.assertEqual(self.obs(mac), t + 90)
        self.poll([dev(mac, "BTLE", "Axon Enterprise, Inc.", last=t + 10)])     # an older report never moves it back
        self.assertEqual(self.obs(mac), t + 90)

    def test_no_fabrication(self):
        mac = "00:25:DF:12:34:56"
        self.poll([dev(mac, "BTLE", "Axon Enterprise, Inc.", last=int(NOW) + 3600)])   # clock anomaly
        self.assertIsNone(self.obs(mac))
        self.poll([dev("AA:BB:CC:11:22:33", "Wi-Fi Client", "Apple, Inc.", last=int(NOW))])   # not LE/Review
        self.assertEqual(self.logs.le.execute("SELECT COUNT(*) FROM rv.observed WHERE mac='AA:BB:CC:11:22:33'").fetchone()[0], 0)

    def test_existing_rows_stay_date_only_and_survive_restart(self):
        mac = "00:25:DF:12:34:56"
        self.poll([dev(mac, "BTLE", "Axon Enterprise, Inc.", last=0)])          # no Kismet time
        self.assertIsNone(self.obs(mac))
        t = int(NOW) - 120
        self.poll([dev(mac, "BTLE", "Axon Enterprise, Inc.", last=t)])
        logs2 = K.Logs(self.rules, self.tmp)
        self.assertEqual([r["last_observed"] for r in logs2.state()["official"] if r["mac"] == mac], [t])
        logs2.close()


class SameMac(Base):
    """Kismet keys devices by phy + MAC: one MAC can arrive as several records."""
    MAC = "00:25:DF:12:34:56"   # Axon OUI: hardware LE on any radio

    def test_merge_keeps_strongest_role_and_newest_time(self):
        t = int(NOW) - 600
        wifi = dev(self.MAC, "Wi-Fi AP", "Axon Enterprise, Inc.", ssid="AXON-T", first=t - 50, last=t)
        bt = dev(self.MAC, "BTLE", "Axon Enterprise, Inc.", first=t - 100, last=t + 240)
        for order in ([wifi, bt], [bt, wifi]):
            m = K.merge_by_mac([K.parse(d) for d in order])
            self.assertEqual(len(m), 1)
            self.assertEqual((m[0]["phy"], m[0]["type"]), ("IEEE802.11", "Wi-Fi AP"))
            self.assertEqual(m[0]["last"], t + 240)        # newest of both records
            self.assertEqual(m[0]["first"], t - 100)       # earliest of both records
            self.assertEqual(sorted(m[0]["records"]), ["Bluetooth/BTLE", "IEEE802.11/Wi-Fi AP"])

    def test_le_row_role_and_observed_time(self):
        t = (int(NOW) // 60) * 60 - 600
        wifi = dev(self.MAC, "Wi-Fi AP", "Axon Enterprise, Inc.", ssid="AXON-T", last=t)
        bt = dev(self.MAC, "BTLE", "Axon Enterprise, Inc.", last=t + 120)
        self.poll([bt, wifi])
        r = self.le(self.MAC)
        self.assertEqual((r["radio"], r["type"]), ("Wi-Fi", "Wi-Fi AP"))
        st = self.logs.state()
        self.assertEqual([x["last_observed"] for x in st["official"] if x["mac"] == self.MAC], [t + 120])
        # A later poll returning only the (weaker) Bluetooth record keeps the AP role.
        self.poll([dev(self.MAC, "BTLE", "Axon Enterprise, Inc.", last=t + 240)])
        r = self.le(self.MAC)
        self.assertEqual((r["radio"], r["type"]), ("Wi-Fi", "Wi-Fi AP"))
        self.assertEqual(self.logs.state()["official"][0]["last_observed"], t + 240)
        # Two records still give one LE row.
        self.assertEqual(self.count("law_enforcement"), 1)

    def test_fetch_mac_merges_records(self):
        t = int(NOW) - 30
        self.kismet.devices = [dev(self.MAC, "BTLE", "Axon Enterprise, Inc.", last=t),
                               dev(self.MAC, "Wi-Fi AP", "Axon Enterprise, Inc.", ssid="AXON-T", last=t - 500)]
        d = K.fetch_mac(GOOD, self.MAC)
        self.assertEqual((d["type"], d["last"]), ("Wi-Fi AP", t))


def keyed(d, key):
    """The same Kismet record with a different (or missing) device key."""
    return dict(d, **{"kismet.device.base.key": key})


class PendingBuffer(Base):
    """The AP/client write buffer, through the path run() takes: keep_newer each poll, then
    flush_pending at LOG_FLUSH_SECONDS. A collision in the buffer silently drops a row."""
    MAC = "B8:32:8F:00:00:01"      # globally administered, so it is logged as a client too

    def flush(self, *polls):
        buf = {}
        for devices in polls:
            for d in devices:
                K.keep_newer(buf, K.parse(d))
        with self.logs.lock:
            n = K.flush_pending(self.logs, buf)
            self.logs.commit()
        return buf, n

    def rows(self, table, cols="mac"):
        fname = "access_points.sqlite" if table == "access_points" else "wifi_clients.sqlite"
        return self.logs.db[fname].execute(f"select {cols} from {table} order by mac").fetchall()

    def test_ap_then_client_reading_of_one_mac_keeps_both_logs(self):
        # Kismet keeps one device key per phy + MAC even when it re-types the device.
        ap = keyed(dev(self.MAC, "Wi-Fi AP", "eero inc.", ssid="Home", last=NOW - 60), "k-eero")
        cl = keyed(dev(self.MAC, "Wi-Fi Client", "eero inc.", assoc_to=["B8:32:8F:00:00:99"], last=NOW - 5), "k-eero")
        self.flush([ap], [cl])
        self.assertEqual(self.rows("access_points", "mac, ssid"), [(self.MAC, "Home")])
        self.assertEqual(self.rows("wifi_clients", "mac, connected_ap"), [(self.MAC, "B8:32:8F:00:00:99")])

    def test_client_then_ap_reading_of_one_mac_keeps_both_logs(self):
        cl = keyed(dev(self.MAC, "Wi-Fi Client", "eero inc.", last=NOW - 60), "k-eero")
        ap = keyed(dev(self.MAC, "Wi-Fi AP", "eero inc.", ssid="Home", last=NOW - 5), "k-eero")
        self.flush([cl], [ap])
        self.assertEqual(self.rows("access_points"), [(self.MAC,)])
        self.assertEqual(self.rows("wifi_clients"), [(self.MAC,)])

    def test_missing_device_key_does_not_merge_ap_and_client(self):
        ap = keyed(dev(self.MAC, "Wi-Fi AP", "eero inc.", ssid="Home"), "")
        cl = keyed(dev(self.MAC, "Wi-Fi Client", "eero inc."), "")
        self.flush([ap, cl])
        self.assertEqual(self.rows("access_points"), [(self.MAC,)])
        self.assertEqual(self.rows("wifi_clients"), [(self.MAC,)])

    def test_shared_device_key_never_merges_two_macs(self):
        other = "B8:32:8F:00:00:02"
        a = keyed(dev(self.MAC, "Wi-Fi AP", "eero inc.", ssid="Home", last=NOW - 30), "dup")
        b = keyed(dev(other, "Wi-Fi AP", "eero inc.", ssid="Office", last=NOW - 5), "dup")
        self.flush([a, b])
        self.assertEqual(self.rows("access_points", "mac, ssid"), [(self.MAC, "Home"), (other, "Office")])

    def test_other_phy_with_same_mac_does_not_displace_the_ap(self):
        ap = dev(self.MAC, "Wi-Fi AP", "eero inc.", ssid="Home", last=NOW - 60)
        bt = dev(self.MAC, "BTLE", "eero inc.", last=NOW - 1)            # newer, other PHY
        buf, _ = self.flush([ap, bt])
        self.assertEqual(list(buf), [(self.MAC, "IEEE802.11", "ap")])   # nothing unloggable is buffered
        self.assertEqual(self.rows("access_points", "mac, ssid"), [(self.MAC, "Home")])
        self.assertEqual(self.rows("wifi_clients"), [])

    def test_newest_reading_wins_within_a_slot(self):
        new = dict(dev(self.MAC, "Wi-Fi AP", "eero inc.", ssid="Home", last=NOW - 5), **{"kismet.device.base.channel": "44"})
        old = dev(self.MAC, "Wi-Fi AP", "eero inc.", ssid="Home", last=NOW - 60)      # channel 6, arrives last
        self.flush([new], [old])
        self.assertEqual(self.rows("access_points", "channel"), [("44",)])

    def test_randomized_client_not_buffered(self):
        buf, n = self.flush([dev("DA:A1:19:00:00:01", "Wi-Fi Client", "Unknown")])
        self.assertEqual((buf, n), ({}, 0))
        self.assertEqual(self.rows("wifi_clients"), [])


class ReviewResolution(Base):
    """review-policy 1 against labelled fixtures. Expected outcome per fixture is stated first."""

    def row(self, mac, typ, manuf, ssid, sigs, last=NOW - 60):
        d = K.parse(dev(mac, typ, manuf, ssid=ssid, last=last))
        with self.logs.lock:
            self.logs.review_upsert(d, sigs)
            self.logs.commit()
        return d

    def res(self, mac):
        r = self.logs.le.execute("SELECT state, rule, locked FROM rv.resolution WHERE mac=?", (mac,)).fetchone()
        return tuple(r) if r else None

    def resolve(self, now=None):
        with self.logs.lock:
            n = self.logs.resolve_review(now)
            self.logs.commit()
        return n

    AGENCY = {"class": "agency", "rule": "agency-words", "word": "Police", "detail": "ssid contains Police"}
    FLEET = {"class": "fleet", "rule": "cradlepoint-oui", "company": "CradlePoint, Inc", "category": "incar-ap", "detail": "fleet OUI 00:30:44"}
    SHARED = {"kind": "shared-ap", "class": "relationship", "parent": "00:25:DF:00:00:01", "why": "public network name",
              "detail": "a confirmed LE device joined it"}

    def test_labelled_fixtures(self):
        cases = [  # (mac, type, manufacturer, ssid, signals, expected (state, rule) or None = no decision)
            ("A0:04:60:00:20:01", "Wi-Fi AP", "NETGEAR", "TownPolice-9", [self.AGENCY], ("deprioritized", "consumer-radio-agency-word")),
            ("00:30:44:00:20:02", "Wi-Fi AP", "CradlePoint, Inc", "CityPolice", [self.AGENCY, self.FLEET], ("active", "needs-review")),
            ("02:11:22:00:20:03", "Wi-Fi AP", "Unknown", "Sheriff-Guest", [self.AGENCY], ("deprioritized", "weak-only")),
            ("A0:04:60:00:20:04", "Wi-Fi AP", "NETGEAR", "xfinitywifi", [self.SHARED], ("dismissed", "public-hotspot")),
            ("00:30:44:00:20:05", "Wi-Fi AP", "CradlePoint, Inc", "E110-t09",
             [self.FLEET, {"kind": "operator-unmarked", "class": "operator", "watch": True, "detail": "unmarked"}], None),
        ]
        for mac, typ, manuf, ssid, sigs, _ in cases:
            self.row(mac, typ, manuf, ssid, sigs)
        self.resolve()
        for mac, typ, manuf, ssid, sigs, want in cases:
            got = self.res(mac)
            self.assertEqual(got[:2] if got else None, want, f"{ssid}: {got}")
        # False-negative guard: a fleet vendor MAC keeps a row active whatever words come with it.
        self.assertEqual(self.res("00:30:44:00:20:02")[0], "active")
        # Every automatic decision says what was observed, why, and what is unknown.
        for mac, *_ in cases[:4]:
            obs, why, unknown, pol = self.logs.le.execute(
                "SELECT observed, why, unknown, policy FROM rv.resolution WHERE mac=?", (mac,)).fetchone()
            self.assertTrue(obs and why and unknown and pol == K.REVIEW_POLICY)
        # Idempotent: a second pass writes nothing and duplicates nothing.
        log_n = self.count("rv.resolution_log")
        self.assertEqual(self.resolve(), 0)
        self.assertEqual(self.count("rv.resolution_log"), log_n)
        self.assertEqual(self.count("rv.review"), 5)          # Review rows are neither duplicated nor removed

    def test_state_and_notices(self):
        self.row("A0:04:60:00:20:04", "Wi-Fi AP", "NETGEAR", "xfinitywifi", [self.SHARED])
        self.row("00:30:44:00:20:02", "Wi-Fi AP", "CradlePoint, Inc", "CityPolice", [self.AGENCY, self.FLEET])
        self.resolve()
        st = self.logs.state()
        self.assertEqual([r["mac"] for r in st["review_dismissed"]], ["A0:04:60:00:20:04"])
        self.assertEqual([r["mac"] for r in st["review"]], ["00:30:44:00:20:02"])
        self.assertEqual(st["review"][0]["resolution"]["state"], "active")
        self.assertIn("A0:04:60:00:20:04", self.logs.quiet)             # no "seen again" notices

    def test_new_evidence_reopens(self):
        mac = "A0:04:60:00:20:04"
        d = self.row(mac, "Wi-Fi AP", "NETGEAR", "xfinitywifi", [self.SHARED])
        self.resolve()
        self.assertEqual(self.res(mac)[0], "dismissed")
        with self.logs.lock:                                            # a stronger signal arrives
            self.logs.review_upsert(d, [{"kind": "association-unconfirmed", "class": "relationship",
                                         "parent": "00:25:DF:00:00:01", "detail": "client record"}])
            self.logs.commit()
        self.resolve()
        self.assertEqual(self.res(mac)[0], "active")
        why = self.logs.le.execute("SELECT why FROM rv.resolution_log WHERE mac=? ORDER BY id DESC LIMIT 1", (mac,)).fetchone()[0]
        self.assertTrue(why.startswith("Reopened"))
        self.assertNotIn(mac, self.logs.quiet)

    def test_stale_then_heard_again(self):
        mac = "00:30:44:00:20:06"
        self.row(mac, "Wi-Fi AP", "CradlePoint, Inc", "Unit-6", [self.FLEET], last=NOW - 40 * 86400)
        self.resolve(NOW)
        self.assertEqual(self.res(mac)[:2], ("deprioritized", "stale"))
        self.poll([dev(mac, "Wi-Fi AP", "CradlePoint, Inc", ssid="Unit-6", last=NOW - 5)])   # heard again
        self.resolve(NOW)
        self.assertEqual(self.res(mac)[:2], ("active", "needs-review"))

    def test_operator_override_is_not_undone(self):
        mac = "A0:04:60:00:20:01"
        self.row(mac, "Wi-Fi AP", "NETGEAR", "TownPolice-9", [self.AGENCY])
        self.resolve()
        self.assertEqual(self.res(mac)[0], "deprioritized")
        self.assertTrue(self.logs.operator_resolve(mac, "keep", "station AP, keep an eye on it", "test operator")["ok"])
        for _ in range(3):
            self.resolve()
        self.assertEqual(self.res(mac), ("active", "operator-keep", 1))
        self.assertTrue(self.logs.operator_resolve(mac, "dismiss", "a neighbour's router", "test operator")["ok"])
        self.resolve()
        self.assertEqual(self.res(mac), ("dismissed", "operator-dismiss", 1))
        self.assertTrue(self.logs.operator_resolve(mac, "release", "", "test operator")["ok"])
        self.assertEqual(self.res(mac)[:3], ("deprioritized", "consumer-radio-agency-word", 0))
        acts = [r[0] for r in self.logs.le.execute("SELECT action FROM rv.audit WHERE mac=? ORDER BY id", (mac,))]
        self.assertEqual(acts, ["review-keep", "review-dismiss", "review-release"])
        self.assertFalse(self.logs.operator_resolve("00:00:00:00:00:99", "dismiss", "not there", "op")["ok"])

    def test_marked_le_leaves_resolution(self):
        mac = "00:30:44:00:20:02"
        self.row(mac, "Wi-Fi AP", "CradlePoint, Inc", "CityPolice", [self.AGENCY, self.FLEET])
        self.resolve()
        self.assertIsNotNone(self.res(mac))
        self.kismet.devices = [dev(mac, "Wi-Fi AP", "CradlePoint, Inc", ssid="CityPolice")]
        self.operator(mac)
        self.resolve()
        self.assertIsNone(self.res(mac))
        self.assertIsNotNone(self.le(mac))                         # the LE row is untouched by the resolver


class Quarantine(unittest.TestCase):
    """The isolated instance's synthetic fixture can never enter the real logs."""

    def test_fixture_dropped_only_for_the_real_log_directory(self):
        live = K.LIVE_OUT
        self.assertTrue(K.quarantined({"mac": "02:00:00:00:A0:01"}, live))
        self.assertTrue(K.quarantined({"mac": "AA:BB:CC:00:00:01", "ssid": "archimet-test-ap"}, live))
        self.assertFalse(K.quarantined({"mac": "AA:BB:CC:00:00:01", "ssid": "Home"}, live))
        self.assertFalse(K.quarantined({"mac": "02:00:00:00:A0:01"}, Path(tempfile.gettempdir()) / "archimet-test"))


class Helpers(unittest.TestCase):
    def test_norm_mac(self):
        for s in ("00:25:df:12:34:56", "00-25-DF-12-34-56", "0025DF123456", " 0025.df12.3456 "):
            self.assertEqual(K.norm_mac(s), "00:25:DF:12:34:56")
        self.assertEqual(K.norm_mac("0025df"), "")

    def test_kind_of_legacy(self):
        self.assertEqual(K.kind_of("mac prefix: 00:25:DF; manufacturer: Axon Enterprise, Inc."), "hardware")
        self.assertEqual(K.kind_of("manufacturer: CradlePoint, Inc"), "hardware")
        self.assertEqual(K.kind_of("ssid: CityPolice"), "keyword")
        self.assertEqual(K.kind_of("Learned: x"), "learned")


if __name__ == "__main__":
    unittest.main()


class MetricsTests(unittest.TestCase):
    def setUp(self):
        import sys
        sys.path.insert(0, str(ROOT / "pi"))
        import archimet_metrics
        self.M = archimet_metrics
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_decode_throttled(self):
        d = self.M.decode_throttled(0xd0005)
        self.assertEqual(d["now"], {"undervoltage": True, "arm_freq_capped": False, "throttled": True, "soft_temp_limit": False})
        self.assertEqual(d["since_boot"], {"undervoltage": True, "arm_freq_capped": False, "throttled": True, "soft_temp_limit": True})

    def test_sampler_records_transitions_and_persists(self):
        M = self.M
        state = {"uv": False, "th": "0x0", "usb": [{"port": "1-1.1.3", "id": "0bda:8812", "devnum": 6, "product": "NIC"}],
                 "wifi": [{"iface": "wlan1", "ifindex": 4}], "helpers": [{"name": "kismet_cap_linux_wifi", "pid": 10}]}
        orig = (M.undervoltage_now, M.throttled, M.usb, M.wifi, M.helpers)
        M.undervoltage_now = lambda: state["uv"]
        M.throttled = lambda: {"raw": state["th"]}
        M.usb, M.wifi, M.helpers = (lambda: state["usb"]), (lambda: state["wifi"]), (lambda: state["helpers"])
        try:
            path = self.tmp / "hw.json"
            s = M.Sampler(path)
            s.step()
            self.assertEqual(s.history(), [])                       # first sample is the baseline
            state.update(uv=True, th="0x50005", usb=[{"port": "1-1.1.3", "id": "0bda:8812", "devnum": 7, "product": "NIC"}],
                         wifi=[{"iface": "wlan1", "ifindex": 9}], helpers=[{"name": "kismet_cap_linux_wifi", "pid": 11}])
            s.step()
            kinds = [e["kind"] for e in s.history()]
            self.assertEqual(kinds, ["undervoltage_start", "throttle_flags", "usb_reenumerated", "wifi_interface_recreated", "capture_helper_restarted"])
            state.update(uv=False, usb=[])
            s.step()
            self.assertEqual([e["kind"] for e in s.history()][-2:], ["undervoltage_end", "usb_removed"])
            self.assertEqual(len(M.Sampler(path).history()), 7)     # survives a restart
        finally:
            M.undervoltage_now, M.throttled, M.usb, M.wifi, M.helpers = orig
