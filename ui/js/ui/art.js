// SPDX-License-Identifier: GPL-2.0-or-later
/* Original Archimet artwork: the mark and the icon set. */

/* Hexagon (the enclosure) with an A whose apex carries two receive arcs: Archimet listens. */
export const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
<path d="M16 2.8 27.4 9.4v13.2L16 29.2 4.6 22.6V9.4Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
<path d="M10.6 23.2 16 12.2 21.4 23.2M12.6 19.3h6.8" fill="none" stroke="var(--blue-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M13.4 9.6a3.7 3.7 0 0 1 5.2 0M11.6 7.6a6.2 6.2 0 0 1 8.8 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".8"/>
</svg>`;

/* Icons: 20×20, 1.5 px strokes, drawn for Archimet. */
const I = (body, extra = "") => `<svg class="ico" viewBox="0 0 20 20" aria-hidden="true" ${extra}><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
export const ICON = {
    devices: I('<rect x="3" y="4" width="14" height="10" rx="1.5"/><path d="M7 17h6M10 14v3"/>'),
    history: I('<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7"/><path d="M3 3.5v3h3M10 6.5V10l2.5 1.5"/>'),
    archive: I('<rect x="3" y="4" width="14" height="4" rx="1"/><path d="M4.5 8v7.5h11V8M8 11h4"/>'),
    review: I('<path d="M10 3 3 16h14z"/><path d="M10 8v4M10 14.2v.3"/>'),
    alerts: I('<path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 2h-13z"/><path d="M8.5 18h3"/>'),
    ssids: I('<path d="M3 8a10 10 0 0 1 14 0M5.5 10.8a6.5 6.5 0 0 1 9 0M8 13.5a3 3 0 0 1 4 0"/><circle cx="10" cy="16" r=".6"/>'),
    sources: I('<path d="M10 11v6M7 17h6"/><circle cx="10" cy="9" r="2"/><path d="M5.5 4.5a6.5 6.5 0 0 0 0 9M14.5 4.5a6.5 6.5 0 0 1 0 9"/>'),
    channels: I('<path d="M4 16V9M8 16V5M12 16v-6M16 16V7"/>'),
    messages: I('<path d="M3 5h14v9H8l-4 3v-3H3z"/>'),
    system: I('<rect x="4" y="4" width="12" height="12" rx="1.5"/><path d="M8 8h4v4H8zM8 2v2M12 2v2M8 16v2M12 16v2M2 8h2M2 12h2M16 8h2M16 12h2"/>'),
    settings: I('<path d="M15.72 8.55 L17.51 8.86 L17.51 11.14 L15.72 11.45 L15.07 13.02 L16.12 14.50 L14.50 16.12 L13.02 15.07 L11.45 15.72 L11.14 17.51 L8.86 17.51 L8.55 15.72 L6.98 15.07 L5.50 16.12 L3.88 14.50 L4.93 13.02 L4.28 11.45 L2.49 11.14 L2.49 8.86 L4.28 8.55 L4.93 6.98 L3.88 5.50 L5.50 3.88 L6.98 4.93 L8.55 4.28 L8.86 2.49 L11.14 2.49 L11.45 4.28 L13.02 4.93 L14.50 3.88 L16.12 5.50 L15.07 6.98 Z"/><circle cx="10" cy="10" r="2.6"/>'),
    filter: I('<path d="M3.5 5h13M6 10h8M8.5 15h3"/>'),
    search: I('<circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4"/>'),
    close: I('<path d="M5 5l10 10M15 5 5 15"/>'),
    chevron: I('<path d="m7 5 5 5-5 5"/>'),
    menu: I('<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>'),
    railCollapse: I('<path d="M12 6l-4 4 4 4"/><path d="M4 3.5v13"/>'),
    railExpand: I('<path d="M8 6l4 4-4 4"/><path d="M4 3.5v13"/>'),
    more: I('<circle cx="5" cy="10" r=".7"/><circle cx="10" cy="10" r=".7"/><circle cx="15" cy="10" r=".7"/>'),
    gps: I('<circle cx="10" cy="10" r="5"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3"/>'),
    ap: I('<path d="M4 7a8.5 8.5 0 0 1 12 0M6.5 9.8a5 5 0 0 1 7 0"/><path d="M10 12v5M7 17h6"/>'),
    client: I('<rect x="6" y="3" width="8" height="14" rx="1.5"/><path d="M9 14.5h2"/>'),
    bt: I('<path d="m6 6.5 8 7-4 3.5V3l4 3.5-8 7"/>'),
    other: I('<circle cx="10" cy="10" r="2"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2"/>'),
    lock: I('<rect x="5" y="9" width="10" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>'),
    signout: I('<path d="M8 4H4v12h4M12 7l3 3-3 3M15 10H8"/>'),
    external: I('<path d="M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8"/>'),
};
