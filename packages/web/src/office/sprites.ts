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
  px: number,
  outline?: string
): void {
  if (outline) {
    ctx.fillStyle = outline;
    const o = Math.max(1, px / 2);
    for (const [dx, dy] of [
      [-o, 0],
      [o, 0],
      [0, -o],
      [0, o],
    ] as const) {
      for (let row = 0; row < grid.length; row++) {
        const line = grid[row]!;
        for (let col = 0; col < line.length; col++) {
          if (line[col] === "." || !palette[line[col]!]) continue;
          ctx.fillRect(x + col * px + dx, y + row * px + dy, px, px);
        }
      }
    }
  }
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

/** Shirt color per team role (developers vary by name). */
export function roleShirt(role: string, name: string): string {
  switch (role) {
    case "pm":
      return "#e8c53d";
    case "reviewer":
      return "#b57edc";
    case "devops":
      return "#d08a2e";
    case "architect":
      return "#3aa6a6";
    case "tester":
      return "#7a9c3a";
    case "security":
      return "#c14b4b";
    default:
      return shirtColor(name);
  }
}

export function roleTag(role: string): string {
  switch (role) {
    case "pm":
      return "PM";
    case "reviewer":
      return "REV";
    case "devops":
      return "OPS";
    case "architect":
      return "ARC";
    case "tester":
      return "QA";
    case "security":
      return "SEC";
    default:
      return "DEV";
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

/** Bookshelf: wooden rack with colored book spines. Drawn at 2 tiles wide. */
export const BOOKSHELF = [
  "WWWWWWWWWWWWWW",
  "WabcWdaeWbcdaW",
  "WabcWdaeWbcdaW",
  "WabcWdaeWbcdaW",
  "WWWWWWWWWWWWWW",
  "WcdaWebcWaebdW",
  "WcdaWebcWaebdW",
  "WcdaWebcWaebdW",
  "WWWWWWWWWWWWWW",
  "WeabWcdbWdcaeW",
  "WeabWcdbWdcaeW",
  "WWWWWWWWWWWWWW",
];

export const BOOKSHELF_PALETTE: Palette = {
  W: "#5e4426",
  a: "#c14b4b",
  b: "#3d6fd6",
  c: "#4cc38a",
  d: "#e8c53d",
  e: "#b57edc",
};

export const PLANT = [
  "...LL...",
  ".LLLLLL.",
  "LLlLLlLL",
  ".LlLLlL.",
  "..LLLL..",
  "...tt...",
  ".pppppp.",
  ".pppppp.",
  "..pppp..",
];

export const PLANT_PALETTE: Palette = {
  L: "#3e8f47",
  l: "#5cb85f",
  t: "#7a5a33",
  p: "#b0603a",
};

export const COOLER = [
  ".bbbb.",
  ".bBBb.",
  ".bBBb.",
  "wwwwww",
  "w....w",
  "wwwwww",
  ".w..w.",
];

export const COOLER_PALETTE: Palette = {
  b: "#5aa7d6",
  B: "#a8d8f0",
  w: "#e8e8e8",
};

/** Simple seeded noise for tile texture variation (stable per tile). */
export function tileNoise(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) >>> 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}
