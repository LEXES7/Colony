/**
 * Pixel-art helpers for the office view. Everything is drawn from character
 * grids — no image assets, so the app stays fully self-contained.
 */

export type Palette = Record<string, string>;

/** Draw a sprite grid; each char maps to a palette color, "." is transparent. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  grid: string[],
  palette: Palette,
  x: number,
  y: number,
  px: number
): void {
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row]!;
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]!;
      if (ch === ".") continue;
      const color = palette[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + col * px, y + row * px, px, px);
    }
  }
}

/** Stable shirt color per agent name. */
export function shirtColor(name: string): string {
  const shirts = ["#2f8f5b", "#3d6fd6", "#c14b4b", "#b57edc", "#d08a2e", "#3aa6a6", "#7a9c3a"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return shirts[hash % shirts.length]!;
}

/** Worker seated behind a desk (upper body; the desk hides the legs). */
export const WORKER = [
  "..hhhh..",
  ".hhhhhh.",
  ".ssssss.",
  ".sessse.",
  ".ssssss.",
  "..ssss..",
  ".cccccc.",
  "cccccccc",
  "cccccccc",
];

export const WORKER_TYPING = [
  "..hhhh..",
  ".hhhhhh.",
  ".ssssss.",
  ".sessse.",
  ".ssssss.",
  "..ssss..",
  ".cccccc.",
  "cccccccc",
  "s.cccc.s",
];

export function workerPalette(shirt: string): Palette {
  return { h: "#4a3220", s: "#e0ac69", e: "#1d1d1d", c: shirt };
}

/** The boss (main agent) gets a golden crown. */
export const BOSS = [
  "g.g..g.g",
  "gggggggg",
  ".hhhhhh.",
  ".ssssss.",
  ".sessse.",
  ".ssssss.",
  "..ssss..",
  ".cccccc.",
  "cccccccc",
];

export const BOSS_PALETTE: Palette = {
  g: "#e8c53d",
  h: "#2b2b2b",
  s: "#e0ac69",
  e: "#1d1d1d",
  c: "#5a4632",
};

export const ENVELOPE = [
  "wwwwwww",
  "wf...fw",
  "w.f.f.w",
  "w..f..w",
  "wwwwwww",
];

export const ENVELOPE_PALETTE_Q: Palette = { w: "#f2e6c9", f: "#c9a34a" };
export const ENVELOPE_PALETTE_A: Palette = { w: "#d7f2d7", f: "#4cc38a" };

/** Simple seeded noise for tile texture variation (stable per tile). */
export function tileNoise(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) >>> 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}
