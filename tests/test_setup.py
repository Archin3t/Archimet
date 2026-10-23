# SPDX-License-Identifier: GPL-2.0-or-later
"""Tests for pi/archimet-setup (optional hotspot). Pure parts only: nothing here runs nmcli."""
import importlib.machinery
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
loader = importlib.machinery.SourceFileLoader("archimet_setup", str(ROOT / "pi" / "archimet-setup"))
spec = importlib.util.spec_from_loader("archimet_setup", loader)
S = importlib.util.module_from_spec(spec)
loader.exec_module(S)

SITE = "source=wlan1:type=linuxwifi,name=ALFA\nsource=hci0:type=linuxbluetooth,name=BT\nmask_datasource_interface=wlan0\n"
PROFILES = [{"name": "Wired connection 1", "type": "802-3-ethernet", "device": "eth0", "mode": "", "iface": ""},
            {"name": "Wardriving AP", "type": "802-11-wireless", "device": "", "mode": "ap", "iface": "wlan0"}]


class Setup(unittest.TestCase):
    def roles(self, profiles=PROFILES):
        return S.classify(["wlan0", "wlan1", "wlan2"], S.capture_sources(SITE), profiles)

    def test_this_pi_roles(self):
        r = self.roles()
        self.assertEqual({k: v[0] for k, v in r.items()}, {"wlan0": "hotspot", "wlan1": "capture", "wlan2": "free"})
        self.assertIn("Wardriving AP", r["wlan0"][1])

    def test_refusals(self):
        r = self.roles()
        for iface, why in (("wlan1", "capture"), ("wlan0", "leaves that profile alone"), ("wlan9", "not a Wi-Fi"), ("wl an", "bad interface")):
            with self.assertRaises(ValueError) as cm:
                S.validate(iface, "Archimet", "a", "10.10.0.1/24", r, PROFILES)
            self.assertIn(why, str(cm.exception))
        for ssid in ("", "x" * 33, "a;b", "a\\b", " lead"):
            with self.assertRaises(ValueError):
                S.validate("wlan2", ssid, "a", "10.10.0.1/24", r, PROFILES)
        with self.assertRaises(ValueError):
            S.validate("wlan2", "Archimet", "ac", "10.10.0.1/24", r, PROFILES)
        with self.assertRaises(ValueError):
            S.validate("wlan2", "Archimet", "a", "10.10.0.1", r, PROFILES)

    def test_free_radio_accepted_and_keyfile(self):
        S.validate("wlan2", "Archimet field", "a", "10.10.0.1/24", self.roles(), PROFILES)
        k = S.keyfile("wlan2", "Archimet field", "a", "10.10.0.1/24", "correct-horse", "u-1")
        self.assertIn("id=Archimet Hotspot", k)
        self.assertIn("interface-name=wlan2", k)
        self.assertIn("mode=ap", k)
        self.assertIn("method=shared", k)
        for bad in ("short", "x" * 64, "tab\there"):
            with self.assertRaises(ValueError):
                S.keyfile("wlan2", "A", "a", "10.10.0.1/24", bad, "u")

    def test_own_profile_can_be_reconfigured(self):
        mine = PROFILES + [{"name": S.PROFILE, "type": "802-11-wireless", "device": "", "mode": "ap", "iface": "wlan2"}]
        r = self.roles(mine)
        self.assertEqual(r["wlan2"][0], "hotspot")
        S.validate("wlan2", "Archimet", "a", "10.10.0.1/24", r, mine)        # Archimet's own profile: allowed


if __name__ == "__main__":
    unittest.main()
