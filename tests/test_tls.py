# SPDX-License-Identifier: GPL-2.0-or-later
"""pi/archimet-tls: the names a certificate covers, on full and minimal systems.

Regression (2026-10-23, arm64 fresh-install chroot): with no `hostname` binary and no NetworkManager the
tool crashed after creating the CA, so no server certificate was made and the gateway stayed loopback-only."""
import importlib.machinery
import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
loader = importlib.machinery.SourceFileLoader("archimet_tls", str(ROOT / "pi" / "archimet-tls"))
spec = importlib.util.spec_from_loader("archimet_tls", loader)
TLS = importlib.util.module_from_spec(spec)
loader.exec_module(TLS)

IP_OUT = ("1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever\n"
          "2: eth0    inet 192.168.50.20/24 brd 192.168.50.255 scope global eth0\\       valid_lft forever\n"
          "3: wlan0    inet 10.42.0.1/24 brd 10.42.0.255 scope global wlan0\\       valid_lft forever\n"
          "4: tun0    inet 8.8.4.4/32 scope global tun0\\       valid_lft forever\n")


def fake_run(available):
    def run(cmd, **kw):
        if cmd[0] not in available:
            raise FileNotFoundError(cmd[0])
        if cmd[:2] == ["ip", "-4"]:
            return subprocess.CompletedProcess(cmd, 0, IP_OUT, "")
        if cmd[0] == "nmcli" and "NAME,TYPE" in cmd:
            return subprocess.CompletedProcess(cmd, 0, "Wardriving AP:802-11-wireless\nWired connection 1:802-3-ethernet\n", "")
        if cmd[0] == "nmcli" and "802-11-wireless.mode" in cmd:
            return subprocess.CompletedProcess(cmd, 0, "ap\n", "")
        if cmd[0] == "nmcli" and "ipv4.addresses" in cmd:
            return subprocess.CompletedProcess(cmd, 0, "10.42.0.1/24\n", "")
        return subprocess.CompletedProcess(cmd, 0, "", "")
    return run


class Names(unittest.TestCase):
    def test_minimal_system_without_hostname_or_nmcli(self):
        with mock.patch.object(TLS.subprocess, "run", side_effect=fake_run({"ip"})), \
             mock.patch.object(TLS.socket, "gethostname", return_value="archimetpi"):
            dns, ips = TLS.names()
        self.assertEqual(dns, ["localhost", "archimetpi", "archimetpi.local"])
        self.assertEqual(ips, ["127.0.0.1", "192.168.50.20", "10.42.0.1"])        # public 8.8.4.4 never included

    def test_full_system_includes_the_hotspot_profile_address_once(self):
        with mock.patch.object(TLS.subprocess, "run", side_effect=fake_run({"ip", "nmcli"})), \
             mock.patch.object(TLS.socket, "gethostname", return_value="archimetpi"):
            dns, ips = TLS.names()
        self.assertEqual(ips, ["127.0.0.1", "192.168.50.20", "10.42.0.1"])

    def test_run_never_raises_for_a_missing_program(self):
        r = TLS.run(["definitely-not-a-program-archimet"])
        self.assertEqual((r.returncode, r.stdout), (127, ""))


if __name__ == "__main__":
    unittest.main()
