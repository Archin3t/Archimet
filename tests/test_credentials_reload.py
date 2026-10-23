# SPDX-License-Identifier: GPL-2.0-or-later
"""The logger must keep collecting after Kismet changes its password."""

import base64
import importlib.machinery
import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
loader = importlib.machinery.SourceFileLoader("logger_credential_test", str(ROOT / "pi" / "kismet-device-logger"))
spec = importlib.util.spec_from_loader(loader.name, loader)
K = importlib.util.module_from_spec(spec)
loader.exec_module(K)


class CredentialReload(unittest.TestCase):
    def test_password_rotation_updates_poll_and_api_without_restart(self):
        old_path, old_api_auth = K.CREDS, K.Api.auth
        with tempfile.TemporaryDirectory() as d:
            K.CREDS = Path(d) / "kismet_httpd.conf"
            try:
                K.CREDS.write_text("httpd_username=kismet\nhttpd_password=old\n")
                old = K.refresh_credentials("")
                self.assertEqual(K.Api.auth, old)

                K.CREDS.write_text("httpd_username=kismet\nhttpd_password=new\n")
                new = K.refresh_credentials(old)
                self.assertEqual(new, "Basic " + base64.b64encode(b"kismet:new").decode())
                self.assertEqual(K.Api.auth, new)
                self.assertNotEqual(new, old)

                K.CREDS.unlink()  # atomic replacement window: keep the last working credential
                self.assertEqual(K.refresh_credentials(new), new)
                self.assertEqual(K.Api.auth, new)
            finally:
                K.CREDS, K.Api.auth = old_path, old_api_auth


if __name__ == "__main__":
    unittest.main()
