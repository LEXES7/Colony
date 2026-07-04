/** Office floor-plan math, all in tile units (1 tile = 16 logical px). */

export const TILE = 16;

export interface Room {
  /** project name, or "main" for the boss office */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** door position (tile x, tile y) on the room wall facing a corridor */
  doorX: number;
  doorY: number;
}

export interface OfficeLayout {
  cols: number; // canvas width in tiles
  rows: number; // canvas height in tiles
  main: Room;
  depts: Room[];
}

const ROOM_W = 12;
const ROOM_H = 8;
const MAIN_W = 12;
const MAIN_H = 7;
const CORRIDOR = 2;
const MARGIN = 1;

export function computeLayout(projectNames: string[]): OfficeLayout {
  const n = Math.max(projectNames.length, 1);
  const perRow = Math.min(3, Math.max(1, n));
  const deptRows = Math.ceil(projectNames.length / perRow) || 1;

  const width = Math.max(perRow * (ROOM_W + 1) - 1, MAIN_W) + MARGIN * 2;
  const mainX = Math.floor((width - MAIN_W) / 2);
  const main: Room = {
    id: "main",
    x: mainX,
    y: MARGIN,
    w: MAIN_W,
    h: MAIN_H,
    doorX: mainX + Math.floor(MAIN_W / 2),
    doorY: MARGIN + MAIN_H - 1,
  };

  const depts: Room[] = [];
  projectNames.forEach((name, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inRow = Math.min(perRow, projectNames.length - row * perRow);
    const rowWidth = inRow * (ROOM_W + 1) - 1;
    const startX = Math.floor((width - rowWidth) / 2);
    const x = startX + col * (ROOM_W + 1);
    const y = MARGIN + MAIN_H + CORRIDOR + row * (ROOM_H + CORRIDOR);
    depts.push({
      id: name,
      x,
      y,
      w: ROOM_W,
      h: ROOM_H,
      doorX: x + Math.floor(ROOM_W / 2),
      doorY: y, // door on the top wall, facing the corridor above
    });
  });

  const rows = MARGIN + MAIN_H + CORRIDOR + deptRows * (ROOM_H + CORRIDOR) - CORRIDOR + MARGIN + 1;
  return { cols: width, rows, main, depts };
}

export interface PathPoint {
  x: number; // tile coords (fractional ok)
  y: number;
}

/** Corridor path from one room's door to another's (L-shaped via corridors). */
export function doorPath(from: Room, to: Room): PathPoint[] {
  const fromOut = { x: from.doorX + 0.5, y: from.doorY === from.y ? from.y - 1 : from.doorY + 1.5 };
  const toOut = { x: to.doorX + 0.5, y: to.doorY === to.y ? to.y - 1 : to.doorY + 1.5 };
  const points: PathPoint[] = [{ x: from.doorX + 0.5, y: from.doorY + 0.5 }, fromOut];
  if (Math.abs(fromOut.y - toOut.y) > 0.01) {
    // travel horizontally in the source corridor, then vertically at target x
    points.push({ x: toOut.x, y: fromOut.y });
  }
  points.push(toOut);
  points.push({ x: to.doorX + 0.5, y: to.doorY + 0.5 });
  return points;
}

export function roomAt(layout: OfficeLayout, tileX: number, tileY: number): Room | null {
  const all = [layout.main, ...layout.depts];
  for (const room of all) {
    if (tileX >= room.x && tileX < room.x + room.w && tileY >= room.y && tileY < room.y + room.h) {
      return room;
    }
  }
  return null;
}
