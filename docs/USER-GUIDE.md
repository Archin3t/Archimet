# Using Archimet

Archimet's main screens separate **what Kismet heard in the current run** from **what Archimet saved previously**. Keep that distinction in mind when deciding whether something is near you now.

## A normal session

1. Sign in through the local HTTPS gateway. On a fresh installation, finish the setup-only default-account change first; see [Install](INSTALL.md).
2. Open **Sources**. Confirm the intended Wi-Fi or Bluetooth helper is running. The count in the header is configured Kismet sources, not a count of USB devices or a guarantee of coverage. A plugged-in adapter appears in detected hardware until it is configured and opened as a source.
3. Open **Devices**. The default sort is newest **last heard** first; stronger signal breaks same-time ties. Search by name, SSID, manufacturer or MAC, then choose radio and device categories. The list is only Kismet's current capture run. An old record is not inserted as a live device.
4. Open a row for its inspector. Compare radio type, source, last-heard time, channel, signal, name, LE/Review tags and evidence. Unavailable hardware fields stay unavailable; a channel/band ambiguity is labelled as such rather than silently corrected.
5. Use **LE History** and **Review** when following equipment leads. The LE log persists across runs; Review explains unresolved evidence and operator decisions. An old LE entry can be history-only even if no live device matches it.
6. Use **Archive** for older stored metadata. It is read-only and shows individual tables with search, sort and paging. The logger API also has a combined-table search endpoint, but the current Archive screen does not expose an arbitrary multi-table selector.
7. Check **System** for Pi temperature, memory, CPU, storage and power; **Alerts** for grouped repeated Kismet alerts; **Channels**, **SSIDs** and **Messages** for other Kismet current-run views.

## LE, Review and Watch

An **LE log** marker means a record entered Archimet's LE evidence log. Read the evidence tag beside it: Vendor match, Operator mark or Associated. A Body cam/Taser subtype is shown only for a matching model name broadcast by the device, and does not prove who uses it. **Review** is an unresolved lead, not a confirmed LE device. **Watch** is a user request to notice an unmarked device again. [LE detection](LE-DETECTION.md) explains the exact boundaries.

Operator actions write server-side state. Kismet name and notes changes use Kismet's account and storage; Archimet Review decisions, watch and LE marks use Archimet's Review database. Archive is read-only. The account must be signed in for either kind of write.

## Freshness and history

"Last heard" comes from Kismet's current-run observation. LE History's last-observed field uses a real observation time from Kismet or the logger's minute-precision record. An older row with only a date is labelled date-only; Archimet does not invent an hour or minute. "Seen before" means a stored prior record, not current RF activity. A source can be running while it receives nothing useful.

## Settings and customization

Settings controls display preferences such as columns, device tags and colours, notifications and visual behavior. The text on tags remains meaningful regardless of colour. Many layout choices are saved in **that browser** and do not alter capture or server data. Account changes use Kismet's login through the gateway. Server radio, data, HTTPS and hotspot changes are documented in [Configuration](CONFIGURATION.md).

## If the screen looks wrong

Start with Sources, then System power/errors, then the raw row and the matching Archive/LE record. Ask: is the source actually capturing; is the item from this Kismet run; did Kismet report a radio type or is the UI inferring it; is the timestamp real; and is a vendor prefix being confused with ownership? [Hardware](HARDWARE.md), [FAQ](FAQ.md) and [Recovery](RECOVERY.md) cover the next checks.
