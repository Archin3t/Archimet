# Notices

## Kismet

Archimet runs on the **Kismet** capture engine (https://www.kismetwireless.net/), by Mike Kershaw
(Dragorn) and contributors. Kismet is free software under the GNU General Public License, version 2.

- **This repository and the archimet package** contain no Kismet source code, binaries or web files.
  The package depends on the official Kismet packages `kismet-core`, `kismet-capture-linux-wifi` and
  `kismet-capture-linux-bluetooth`, installed from the Kismet project's signed repository.
- **Planned release attachments**: because the Kismet repository keeps only its newest version, an
  approved Archimet release should attach the exact, unmodified upstream Kismet `.deb` files it was tested
  with (5.3.0 candidate: release **2025-09-R1**, git tag **`kismet-2025-09-R1`**, commit **`b5d5a2d04`**), with
  their SHA-256 as published in the signed repository index. Redistributing them carries the GPL v2
  source obligation: each eventual release should link the corresponding source at
  https://github.com/kismetwireless/kismet/tree/kismet-2025-09-R1 and attaches the source archive
  of that tag.
- Archimet does not modify Kismet. Kismet reads Archimet's settings through its documented
  `--override` option and a systemd drop-in; no file owned by a Kismet package is edited.

## IEEE assignments

`shared/le_rules.json` refers to public IEEE MAC address assignments (OUIs) by number and company
name. No IEEE registry files are included.

## Archimet

Copyright © Archinet. Archimet is licensed under **GPL-2.0-only**; the full text is in
[LICENSE](LICENSE). Kismet's own licence and copyright remain its authors'.
