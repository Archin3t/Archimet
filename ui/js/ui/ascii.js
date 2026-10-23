// SPDX-License-Identifier: GPL-2.0-or-later
/* Real-text ASCII lettering for the Archimet intro.
 * Letter faces are ANSI Shadow block characters; the box-drawing "shadow" strokes are
 * coloured separately, and a few hand-placed drips and worn cells give a restrained
 * "Bloody"-style distress. Pure data + layout: no DOM here (tested in tests/test_ui.mjs). */

const SHADOW = {
    A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
    R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
    C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
    H: ["██╗  ██╗", "██║  ██║", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
    I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
    M: ["███╗   ███╗", "████╗ ████║", "██╔████╔██║", "██║╚██╔╝██║", "██║ ╚═╝ ██║", "╚═╝     ╚═╝"],
    N: ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"],
    E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
    T: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
};

/* Rows of text for a word in ANSI Shadow. */
export function shadowRows(word) {
    const rows = ["", "", "", "", "", ""];
    for (const ch of word) {
        const g = SHADOW[ch];
        if (!g) throw new Error(`no glyph for ${ch}`);
        g.forEach((line, i) => { rows[i] += line; });
    }
    return rows;
}

/* Distress for ARCHIMET (63 columns): drips hang below the letters, worn cells sit in the
 * faces. Kept sparse on purpose. Columns are fixed so the title never flickers. */
const DRIPS = [          // [column in ARCHIMET, glyphs top → bottom]
    [1, "▀"], [20, "█▌ ▘"], [44, "╏"], [58, "▐▝"],
];
const WORN = [[4, 19, "▓"], [2, 47, "▓"]];  // [row, column in ARCHIMET, glyph]

/* Cell grid: [{ ch, kind, row }] per row. kind: face | shadow | drip | worn | space.
 * `offset` is where this word starts inside ARCHIMET, so the title can be set on two lines
 * (ARCHI / MET) on narrow screens and keep its distress in the same places. */
export function lettering(word, { distress = false, offset = 0 } = {}) {
    const rows = shadowRows(word).map(r => [...r]);
    const width = rows[0].length;
    const inside = (c) => c >= offset && c < offset + width;
    if (distress) for (const [r, c, g] of WORN) if (inside(c) && rows[r][c - offset] === "█") rows[r][c - offset] = g;
    const grid = rows.map((r, ri) => r.map(ch => ({ ch, row: ri, kind: ch === " " ? "space" : ch === "█" ? "face" : /[▓▒░]/.test(ch) ? "worn" : "shadow" })));
    const drips = distress ? DRIPS.filter(([c]) => inside(c)) : [];
    const depth = drips.length ? Math.max(...drips.map(([, g]) => g.length)) : 0;
    for (let d = 0; d < depth; d++) {
        const row = Array.from({ length: width }, () => ({ ch: " ", kind: "space", row: 6 + d }));
        for (const [c, g] of drips) if (g[d] && g[d] !== " ") row[c - offset] = { ch: g[d], row: 6 + d, kind: g[d] === "╏" ? "shadow" : "drip" };
        grid.push(row);
    }
    return grid;
}

export const width = (word) => shadowRows(word)[0].length;

/* "by" in the figlet 3D-ASCII style (from Archinet's reference). Real text, 8 rows x 26 cols. */
export const BY_3D = [
    String.raw` ________      ___    ___ `,
    String.raw`|\   __  \    |\  \  /  /|`,
    String.raw`\ \  \|\ /_   \ \  \/  / /`,
    String.raw` \ \   __  \   \ \    / / `,
    String.raw`  \ \  \|\  \   \/  /  /  `,
    String.raw`   \ \_______\__/  / /    `,
    String.raw`    \|_______|\___/ /     `,
    String.raw`             \|___|/      `,
];

/* Cells for BY_3D: front strokes (_ and |) are the face, diagonals (\ and /) the depth. */
export function byCells() {
    return BY_3D.map(r => [...r].map(ch => ({ ch, kind: ch === " " ? "space" : /[\\/]/.test(ch) ? "depth" : "line" })));
}
