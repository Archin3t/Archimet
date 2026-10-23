# Archimet and Kismet

Archimet uses upstream Kismet as its capture engine. It is a different product interface and workflow over that engine, not a faster or more capable replacement for Kismet's radio decoders. Kismet is by Mike Kershaw (Dragorn) and contributors.

| Area | Stock Kismet | Archimet 5.3 candidate |
|---|---|---|
| Capture and protocol decoding | Mature upstream engine and capture helpers; broad hardware/protocol support | The same Kismet engine, with only the tested Linux Wi-Fi and Bluetooth helpers installed by the Archimet package |
| Main interface | General-purpose Kismet web interface | Archimet's own devices, LE, Review, Archive, radio and system workflow; stock pages are blocked from the network by its gateway |
| Device scope | Kismet's device memory and its own logging options | Current-run Devices plus Archimet's separate persistent LE and Archive views |
| LE classification | General device/alert capabilities | Evidence rules, operator marks, bounded learning, Review decisions and a persistent LE log built by Archimet |
| Stored data | Kismet can record packet/capture and other logs when configured | Archimet logs selected device metadata in SQLite; its shipped Kismet override disables packet and handshake logging |
| Hardware status | Kismet server and source statistics | Adds Pi power, thermal, CPU, disk and USB readings where available, with event history |
| Updates | Kismet packages follow upstream release availability | Exact tested Kismet packages are held; the owner adopts a new engine version through a tested Archimet release |
| Hotspot | Outside Kismet's normal capture role | Optional Archimet setup, disabled by default; an existing hotspot radio is reserved from capture |

Choose stock Kismet if you need its full protocol breadth, packet capture/export, or a newer upstream engine immediately. Choose Archimet's workflow if its focused views, LE evidence trail, limited retention and Pi operations fit your use. Neither can identify every nearby device or confirm a device's role from a MAC vendor alone. Details: [features](FEATURES.md), [data](DATA.md), [updates](UPDATES.md).
