# Law enforcement equipment evidence

Archimet was designed for people who want to examine nearby radio signals that *may* come from law enforcement equipment and preserve the reasoning behind each lead. A Kismet device is a radio observation. Archimet's LE log is an **evidence log**, not a roster of officers or a proof of ownership, location, active use, or device model.

## From observation to a label

| Signal | Where it goes | What it means |
|---|---|---|
| MAC prefix in a configured equipment-vendor rule | LE log with **Vendor match** | The prefix is assigned to a maker in the rules. It does not prove which product, customer or use is present. Kismet's manufacturer name comes from the same prefix and is not independent confirmation. |
| Operator mark with a note | LE log with **Operator mark** | A person made a documented judgement. Archimet records the mark, time and source; it remains an operator assertion. |
| One-hop relationship supported by Kismet data-frame evidence | LE log with **Associated** | A radio exchanged data with a qualifying LE-log device. The relationship is evidence of association, not identity. Learned devices cannot teach further devices. |
| Weak name, fleet vendor, probe, proximity, or association without data-frame evidence | **Review** | A lead worth inspecting, but insufficient for the LE log under the current rules. |

Rules are in [`shared/le_rules.json`](../shared/le_rules.json). The logger validates and reloads them; its classification code lives in [`pi/kismet-device-logger`](../pi/kismet-device-logger). The Review policy can close stale or weak leads and reopen them on new evidence. A user can watch, mark, unmark or resolve a device; decisions and sightings are retained in the Review database.

## Equipment type is separate from evidence

The UI shows a Body cam, Taser, In-car video, In-car router, Two-way radio or ALPR subtype **only when a device itself advertised a matching model-name pattern**. A vendor OUI never assigns a subtype on its own. An AP is a Wi-Fi role, not a "police AP". A router model may be used outside law enforcement; a model tag still does not identify its owner. The display rules and tag explanations are in [`ui/js/lib/tags.js`](../ui/js/lib/tags.js). Tags remain readable as text when colours are changed.

## A practical review workflow

1. Open **Sources** and confirm that the intended Wi-Fi or Bluetooth source is running without capture errors. An absent source makes a quiet Devices page unsurprising.
2. Use **Devices** for current-run observations. Sort by last heard and inspect radio role, source, last-heard time, advertised names and any warning about uncertain channel/band information.
3. Open **Review** to read each rule's reason, what supports it, and what argues against it. Do not treat a matching vendor name or near-in-time appearance as independent proof.
4. Add a note or operator mark only when you have an external basis you can describe. Use **Watch** for an unresolved device you want to revisit. Review state and decisions are logged.
5. Use **LE History** for persistent evidence, with the last real observation time. "Not heard this Kismet run" means exactly that. Use **Archive** to inspect older stored rows, not to claim they are presently nearby.

## What it cannot establish

- A MAC prefix can be spoofed, randomized or reused across products. A manufacturer match does not establish police ownership or operation.
- A silent, encrypted or out-of-range device may never appear. Wi-Fi channel hopping observes each channel only part of the time; Bluetooth scanning has its own coverage limits.
- An observed association is a radio relationship. It does not prove an officer, vehicle, agency or exact equipment location.
- The persistent LE log can contain an old observation. The live Devices page and explicit last-heard fields are the place to check recency.

Archimet intentionally keeps uncertain cases in Review and shows its evidence source rather than silently converting every hint into a confirmed claim. See [How it works](HOW-IT-WORKS.md), [Data layout](DATA.md) and [User guide](USER-GUIDE.md).
