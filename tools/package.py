#!/usr/bin/env python3
"""Build the staging bundle that packaging/build-deb.sh turns into the archimet .deb.

    python tools/package.py            # -> dist/archimet-<version>/ and dist/archimet-<version>.tar.gz

Contents: kismet-device-logger, archimet_metrics.py, archimet-gateway, archimet-compat,
archimet-setup, archimet-hold, archimet-selftest, archimet-tls, archimet-account, le_rules.json,
www/ (the contents of ui/), docs/, VERSION, SHA256SUMS. No Kismet file is staged: the package
depends on the upstream Kismet packages.
Every file is written with LF line endings. Refuses if a staged file contains a MAC address that
is not a documented synthetic / example one, so no live data can ride along. dist/ is not tracked.
"""
import hashlib
import io
import re
import shutil
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = {
    "kismet-device-logger": "pi/kismet-device-logger",
    "archimet_metrics.py": "pi/archimet_metrics.py",
    "archimet-gateway": "pi/archimet-gateway",
    "archimet-compat": "pi/archimet-compat",
    "archimet-setup": "pi/archimet-setup",
    "archimet-hold": "pi/archimet-hold",
    "archimet-selftest": "pi/archimet-selftest",
    "le_rules.json": "shared/le_rules.json",
    "archimet-tls": "pi/archimet-tls",
    "archimet-account": "pi/archimet-account",
    "docs/README.md": "README.md",
    "docs/NOTICE.md": "NOTICE.md",
    "docs/LICENSE": "LICENSE",
    "docs/UPDATES.md": "docs/UPDATES.md",
    "docs/SECURITY.md": "docs/SECURITY.md",
    "docs/INSTALL.md": "docs/INSTALL.md",
    "docs/HOTSPOT.md": "docs/HOTSPOT.md",
    "docs/DATA.md": "docs/DATA.md",
    "docs/RECOVERY.md": "docs/RECOVERY.md",
    "docs/HTTPS.md": "docs/HTTPS.md",
    "docs/FEATURES.md": "docs/FEATURES.md",
    "docs/COMPARISON.md": "docs/COMPARISON.md",
    "docs/STATUS.md": "docs/STATUS.md",
    "docs/HOW-IT-WORKS.md": "docs/HOW-IT-WORKS.md",
    "docs/LE-DETECTION.md": "docs/LE-DETECTION.md",
    "docs/REPOSITORY.md": "docs/REPOSITORY.md",
    "docs/HARDWARE.md": "docs/HARDWARE.md",
    "docs/USER-GUIDE.md": "docs/USER-GUIDE.md",
    "docs/CONFIGURATION.md": "docs/CONFIGURATION.md",
    "docs/FAQ.md": "docs/FAQ.md",
}
EXEC = {"kismet-device-logger", "archimet-gateway", "archimet-compat", "archimet-setup", "archimet-hold",
        "archimet-selftest", "archimet-tls", "archimet-account"}
MAC = re.compile(rb"\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b")
# OUI prefixes used by rules are fine as prefixes; full MACs must be synthetic (02:..., 00:00:00...) or broadcast.
ALLOWED_FULL = re.compile(rb"^(02:00:00|00:00:00|ff:ff:ff|FF:FF:FF|AA:BB:CC|aa:bb:cc)", re.I)


def version():
    m = re.search(r'VERSION = "archimet-logger ([0-9.]+)"', (ROOT / FILES["kismet-device-logger"]).read_text(encoding="utf-8"))
    h = hashlib.sha256()
    for rel in sorted(FILES.values()) + sorted(str(p.relative_to(ROOT)) for p in (ROOT / "ui").rglob("*") if p.is_file()):
        h.update(rel.encode() + b"\0" + (ROOT / rel).read_bytes().replace(b"\r\n", b"\n"))
    return f"{m.group(1)}-{h.hexdigest()[:8]}"


def lf(data):
    return data.replace(b"\r\n", b"\n")


def main():
    ver = version()
    out = ROOT / "dist" / f"archimet-{ver}"
    if out.exists():
        shutil.rmtree(out)
    (out / "www").mkdir(parents=True)
    staged = {}
    for name, rel in FILES.items():
        staged[name] = lf((ROOT / rel).read_bytes())
    for p in sorted((ROOT / "ui").rglob("*")):
        if p.is_file():
            data = p.read_bytes()
            staged["www/" + p.relative_to(ROOT / "ui").as_posix()] = lf(data) if p.suffix in (".js", ".css", ".html", ".json", ".svg", ".txt") else data
    staged["VERSION"] = (ver + "\n").encode()
    bad = [(n, m.group().decode()) for n, d in staged.items() for m in MAC.finditer(d) if not ALLOWED_FULL.match(m.group())]
    if bad:
        sys.exit("Refusing: full MAC addresses in staged files: " + ", ".join(f"{n}: {m}" for n, m in bad[:10]))
    for n, d in staged.items():
        (out / n).parent.mkdir(parents=True, exist_ok=True)
        (out / n).write_bytes(d)
    sums = "".join(f"{hashlib.sha256(d).hexdigest()}  {n}\n" for n, d in sorted(staged.items()))
    (out / "SHA256SUMS").write_text(sums, newline="\n")
    tgz = out.parent / f"{out.name}.tar.gz"
    with tarfile.open(tgz, "w:gz") as tar:
        for n, d in sorted(list(staged.items()) + [("SHA256SUMS", sums.encode())]):
            ti = tarfile.TarInfo(f"archimet-{ver}/{n}")
            ti.size, ti.mode, ti.mtime = len(d), 0o755 if n in EXEC else 0o644, 0
            tar.addfile(ti, io.BytesIO(d))
    print(f"{out}\n{tgz}  ({tgz.stat().st_size // 1024} KiB, {len(staged)} files + SHA256SUMS)")
    print(f"sha256 {hashlib.sha256(tgz.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
