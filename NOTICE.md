# Notices

## Kismet

Archimet runs on the **Kismet** capture engine (https://www.kismetwireless.net/), by Mike Kershaw
(Dragorn) and contributors. Kismet is free software under the GNU General Public License, version 2.

- **This repository and the archimet package** contain no Kismet source code, binaries or web files.
  The package depends on the official Kismet packages `kismet-core`, `kismet-capture-linux-wifi` and
  `kismet-capture-linux-bluetooth`, installed from the Kismet project's signed repository.
- **Release attachments**: because the Kismet repository keeps only its newest version, each Archimet
  release attaches the exact, unmodified upstream Kismet `.deb` files it was tested with (5.3.0-2:
  `kismet-core`, `kismet-capture-linux-wifi`, `kismet-capture-linux-bluetooth`, release **2025-09-R1**), with
  their SHA-256 as published in the Kismet project's signed repository index (`packaging/tested-kismet.sha256`).
  Redistributing them carries the GPL source obligation, met by attaching the **corresponding source** to the
  same release: `kismet-2025-09-R1-source.tar.xz` (in two parts, `.part0` and `.part1`, because of GitHub's
  upload limit; `cat` them together), the upstream archive of git tag `kismet-2025-09-R1`
  (commit `7a3b5d2`). The binaries report build revision `b5d5a2d04`, the tag's parent; the tag adds only the
  `version.c` generated during compilation. Kismet's licence (GPL v2, "or any later version" per its file
  headers) is inside that archive (`LICENSE`) and summarised in `KISMET-NOTICE.txt` on the release.
- Archimet does not modify Kismet. Kismet reads Archimet's settings through its documented
  `--override` option and a systemd drop-in; no file owned by a Kismet package is edited.

## IEEE assignments

`shared/le_rules.json` refers to public IEEE MAC address assignments (OUIs) by number and company
name. No IEEE registry files are included.

## Archimet

Copyright © Archinet. Licence: **GNU General Public License, version 2 or (at your option) any later
version (GPL-2.0-or-later)**, confirmed by the author on 2026-10-23. Every Archimet source file carries
`SPDX-License-Identifier: GPL-2.0-or-later`; the full GPL v2 text is in `LICENSE`.
