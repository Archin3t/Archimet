"""Tests for pi/archimet-compat's logger version gate (fails closed).

  python -m unittest tests.test_compat -v
"""
import importlib.machinery
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


C = load("archimet_compat", ROOT / "pi" / "archimet-compat")
CONTRACT = json.loads((ROOT / "ui" / "js" / "api" / "contract.json").read_text(encoding="utf-8"))
SPEC = CONTRACT.get("logger")


class LoggerVersion(unittest.TestCase):
    def ok(self, status, body, spec=SPEC):
        return C.check_logger_version(spec, status, body) == []

    def test_contract_minimum(self):
        self.assertEqual(SPEC, {"path": "/archimet/health", "name": "archimet-logger", "min_version": "5.2.0"})

    def test_shipped_logger_meets_minimum(self):
        src = (ROOT / "pi" / "kismet-device-logger").read_text(encoding="utf-8")
        version = re.search(r'^VERSION = "([^"]+)"', src, re.M).group(1)
        self.assertTrue(self.ok(200, {"ok": True, "version": version}), version)

    def test_accepts_minimum_and_newer(self):
        for v in ("5.2.0", "5.2.1", "5.10.0", "6.0.0"):
            self.assertTrue(self.ok(200, {"ok": True, "version": f"archimet-logger {v}"}), v)

    def test_refuses_older(self):
        for v in ("5.1.9", "5.1.10", "4.99.99"):
            self.assertFalse(self.ok(200, {"version": f"archimet-logger {v}"}), v)

    def test_fails_closed_on_missing_or_unparseable_version(self):
        for body in ({"ok": True}, {"version": ""}, {"version": None}, {"version": "archimet-logger 5.2"},
                     {"version": "archimet-logger v5.2.0"}, {"version": "other-logger 9.9.9"},
                     "archimet-logger 5.2.0", None, []):
            self.assertFalse(self.ok(200, body), repr(body))

    def test_fails_closed_without_answer(self):
        self.assertFalse(self.ok(0, "connection refused"))
        self.assertFalse(self.ok(404, None))
        self.assertFalse(self.ok(500, {"version": "archimet-logger 5.2.0"}))

    def test_fails_closed_without_contract_minimum(self):
        good = {"version": "archimet-logger 5.2.0"}
        for spec in (None, {}, {"name": "archimet-logger"}, {"name": "archimet-logger", "min_version": ""},
                     {"name": "archimet-logger", "min_version": "5.2"}, {"min_version": "5.2.0"}):
            self.assertFalse(self.ok(200, good, spec), repr(spec))


if __name__ == "__main__":
    unittest.main()


class Targets(unittest.TestCase):
    """The environment must win over /etc/default/archimet (otherwise a check aimed at a test
    instance silently hits the live logger)."""
    def loaded(self, **env):
        import os
        saved = {k: os.environ.get(k) for k in ("ARCHIMET_LOGGER_URL", "ARCHIMET_LOGGER", "ARCHIMET_API")}
        for k in saved:
            os.environ.pop(k, None)
        os.environ.update(env)
        try:
            return load("archimet_compat_env", ROOT / "pi" / "archimet-compat")
        finally:
            for k, v in saved.items():
                os.environ.pop(k, None)
                if v is not None:
                    os.environ[k] = v

    def test_logger_url_from_environment(self):
        self.assertEqual(self.loaded(ARCHIMET_LOGGER_URL="http://127.0.0.1:2603").LOGGER, "http://127.0.0.1:2603")

    def test_older_name_still_works(self):
        self.assertEqual(self.loaded(ARCHIMET_LOGGER="http://127.0.0.1:2602").LOGGER, "http://127.0.0.1:2602")

    def test_kismet_url_from_environment(self):
        self.assertEqual(self.loaded(ARCHIMET_API="http://127.0.0.1:2601").KISMET, "http://127.0.0.1:2601")
