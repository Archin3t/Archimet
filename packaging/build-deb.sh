#!/bin/bash
# Build archimet_<version>_<arch>.deb (needs dpkg-deb; run on the Pi or any Debian system).
#   bash build-deb.sh <stage-dir> <packaging-dir> <out-dir> [arch]
# <stage-dir>: the output of tools/package.py (www/, logger, gateway, tools, rules, docs, VERSION).
#
# Archimet runs on the UPSTREAM Kismet packages from the official signed Kismet repository. This
# package contains no Kismet file: it depends on the exact Kismet versions it was tested with
# (TESTED below), pins them for apt, and holds them after install. Nothing upstream-owned is
# modified; Archimet's engine settings arrive through a systemd drop-in and Kismet's --override.
set -euo pipefail
umask 022                                            # file modes must not depend on the builder's umask
STAGE="$(cd "$1" && pwd)"; PKG="$(cd "$2" && pwd)"; mkdir -p "$3"; OUT="$(cd "$3" && pwd)"
ARCH="${4:-$(dpkg --print-architecture)}"
# The Kismet packages this Archimet release is tested with (package version), and their source.
TESTED="kismet-core 2025-09-R1
kismet-capture-linux-wifi 2025-09-R1
kismet-capture-linux-bluetooth 2025-09-R1"
KREPO="https://www.kismetwireless.net/repos/apt/release/trixie trixie main (signed by the Kismet archive key)"
BUILD="$(cat "$STAGE/VERSION")"                     # e.g. 5.3.0-<hash>
DEBVER="${BUILD%%-*}-$(cat "$PKG/REVISION" 2>/dev/null || echo 1)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
R="$W/root"

install -d "$R/DEBIAN" "$R/usr/sbin" "$R/usr/lib/archimet" "$R/usr/share/archimet/no-user-web-root" \
    "$R/lib/systemd/system" "$R/usr/lib/systemd/system/kismet.service.d" \
    "$R/etc/archimet" "$R/etc/apt/preferences.d" "$R/usr/share/doc/archimet"
cp -r "$STAGE/www" "$R/usr/share/archimet/www"
rm -f "$R/usr/share/archimet/www/archimet-config.json"     # preview / test label only, never shipped
find "$R/usr/share/archimet/www" -type d -exec chmod 755 {} + ; find "$R/usr/share/archimet/www" -type f -exec chmod 644 {} +
install -m 644 "$STAGE/le_rules.json" "$R/usr/share/archimet/"
printf '%s\n' "$TESTED" > "$R/usr/share/archimet/tested-kismet.txt"
install -m 644 "$PKG/tested-kismet.sha256" "$R/usr/share/archimet/"
for t in kismet-device-logger archimet-gateway archimet-compat archimet-setup archimet-hold archimet-selftest archimet-tls archimet-account; do
    install -m 755 "$STAGE/$t" "$R/usr/lib/archimet/"
done
install -m 644 "$STAGE/archimet_metrics.py" "$R/usr/lib/archimet/"
for t in archimet-compat archimet-setup archimet-hold archimet-selftest archimet-tls archimet-account; do ln -s "../lib/archimet/$t" "$R/usr/sbin/$t"; done
install -m 644 "$PKG/systemd/archimet-logger.service" "$PKG/systemd/archimet-gateway.service" "$R/lib/systemd/system/"
install -m 644 "$PKG/systemd/kismet.service.d-archimet.conf" "$R/usr/lib/systemd/system/kismet.service.d/archimet.conf"
install -m 644 "$PKG/etc/kismet-archimet.conf" "$R/etc/archimet/"
{   # apt pin generated from TESTED, so the two can never disagree.
    echo "# Installed by the archimet package. Archimet is tested with exactly these Kismet packages."
    echo "# Priority 1000 keeps them when newer ones appear, and never forces a downgrade (> 1000 would)."
    echo "# A new Kismet version is adopted only through a new Archimet release (docs/UPDATES.md)."
    echo "$TESTED" | while read -r p v; do printf '\nPackage: %s\nPin: version %s\nPin-Priority: 1000\n' "$p" "$v"; done
} > "$R/etc/apt/preferences.d/archimet-kismet"
chmod 644 "$R/etc/apt/preferences.d/archimet-kismet"
install -m 644 "$PKG/debian/copyright" "$R/usr/share/doc/archimet/"
for d in README.md NOTICE.md LICENSE UPDATES.md SECURITY.md INSTALL.md HTTPS.md HOTSPOT.md DATA.md RECOVERY.md FEATURES.md COMPARISON.md STATUS.md HOW-IT-WORKS.md LE-DETECTION.md REPOSITORY.md HARDWARE.md USER-GUIDE.md CONFIGURATION.md FAQ.md; do
    [ -f "$STAGE/docs/$d" ] && install -m 644 "$STAGE/docs/$d" "$R/usr/share/doc/archimet/"
done
gzip -9n -c > "$R/usr/share/doc/archimet/changelog.gz" <<EOF
archimet ($DEBVER) stable; urgency=medium

  * Archimet $BUILD on the upstream Kismet packages ($(echo "$TESTED" | tr '\n' ';' | sed 's/;$//')).
  * archimet-gateway is the only network-facing web entry point; Kismet listens on loopback.

 -- Archinet  $(date -R)
EOF

for s in postinst prerm postrm; do install -m 755 "$PKG/debian/$s" "$R/DEBIAN/$s"; done
printf '/etc/archimet/kismet-archimet.conf\n/etc/apt/preferences.d/archimet-kismet\n' > "$R/DEBIAN/conffiles"
(cd "$R" && find usr lib etc -type f -exec md5sum {} + | sort -k2) > "$R/DEBIAN/md5sums"
SIZE="$(du -sk --exclude=DEBIAN "$R" | cut -f1)"
KDEPS="$(echo "$TESTED" | awk '{printf "%s%s (= %s)", (NR>1?", ":""), $1, $2}')"
cat > "$R/DEBIAN/control" <<EOF
Package: archimet
Version: $DEBVER
Architecture: $ARCH
Maintainer: Archinet <archin3t@users.noreply.github.com>
Installed-Size: $SIZE
Depends: $KDEPS, python3 (>= 3.11), adduser, systemd, iproute2, openssl
Recommends: network-manager
Section: net
Priority: optional
Homepage: https://github.com/archin3t/archimet
X-Archimet-Build: $BUILD
X-Archimet-Tested-Kismet: $(echo "$TESTED" | tr '\n' ';' | sed 's/;$//')
X-Archimet-Kismet-Repository: $KREPO
Description: Archimet radio monitor, running on the Kismet capture engine
 Archimet is a Wi-Fi and Bluetooth monitor for a Raspberry Pi: its own web interface (devices, LE
 History, Review with an evidence policy, Archive, sources and hardware health), a logger with
 separate AP / client / LE logs, and classification rules.
 .
 It runs on the official Kismet packages kismet-core and the Linux Wi-Fi / Bluetooth capture helpers,
 at exactly the versions it was tested with (pinned and held). Kismet's web server is bound to
 loopback; archimet-gateway is the only web entry point and never serves Kismet's stock pages.
EOF
PKGFILE="$OUT/archimet_${DEBVER}_${ARCH}.deb"
dpkg-deb --root-owner-group -Zxz --build "$R" "$PKGFILE" >/dev/null
dpkg-deb -c "$PKGFILE" > "$PKGFILE.contents.txt"
dpkg-deb -I "$PKGFILE" control > "$PKGFILE.control.txt"
(cd "$OUT" && sha256sum "$(basename "$PKGFILE")" > "$(basename "$PKGFILE").sha256")
echo "$PKGFILE"
cat "$PKGFILE.sha256"
