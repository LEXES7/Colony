/** Office floor-plan math, all in tile units (1 tile = 16 logical px). */

export const TILE = 16;
export const SPINE_X = 2; // vertical hallway spine (2 tiles wide: x=SPINE_X-1..SPINE_X)

export type RoomKind = "main" | "dept" | "team";

export interface Room {
  id: string;
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  h: number;
  doorX: number;
  doorY: number;
  seats: number;
}

export interface OfficeLayout {
  cols: number;
  rows: number;
  main: Room;
  depts: Room[];
  teamRooms: Room[];
  /** corridor bands as [yTop, xStart, xEnd] pairs (2 tiles tall each) */
  corridors: { y: number; x0: number; x1: number }[];
  spineBottom: number;
}

const ROOM_H = 8;
const MAIN_W = 14;
const DEPT_W = 12;
const GAP = 1;
const MARGIN = 1;
const MAX_ROW_W = 42; // tiles — rooms wrap to a new row past this

export interface TeamShape {
  id: string;
  seats: number;
}

interface Pending {
  id: string;
  kind: RoomKind;
  w: number;
  seats: number;
}

export function computeLayout(projectNames: string[], teams: TeamShape[] = []): OfficeLayout {
  const pending: Pending[] = [
    { id: "main", kind: "main", w: MAIN_W, seats: 1 },
    ...projectNames.map<Pending>((name) => ({ id: name, kind: "dept", w: DEPT_W, seats: 1 })),
    ...teams.map<Pending>((t) => ({
      id: t.id,
      kind: "team",
      w: Math.max(DEPT_W, 4 + t.seats * 4),
      seats: t.seats,
    })),
  ];

  const startX = SPINE_X + 2;
  const placed: Room[] = [];
  const corridors: OfficeLayout["corridors"] = [];
  let x = startX;
  let y = MARGIN;
  let rowMaxX = startX;
  let rowRooms: Room[] = [];

  const closeRow = () => {
    if (rowRooms.length === 0) return;
    corridors.push({ y: y + ROOM_H, x0: SPINE_X - 1, x1: rowMaxX });
    y += ROOM_H + 2 + GAP;
    x = startX;
    rowRooms = [];
  };

  for (const p of pending) {
    if (x > startX && x + p.w > MAX_ROW_W) closeRow();
    const room: Room = {
      id: p.id,
      kind: p.kind,
      x,
      y,
      w: p.w,
      h: ROOM_H,
      doorX: x + Math.floor(p.w / 2),
      doorY: y + ROOM_H - 1, // door on the bottom wall, into the corridor
      seats: p.seats,
    };
    placed.push(room);
    rowRooms.push(room);
    x += p.w + GAP;
    rowMaxX = Math.max(rowMaxX, room.x + room.w);
  }
  closeRow();

  const spineBottom = corridors.length ? corridors[corridors.length - 1]!.y + 2 : MARGIN;
  const cols = Math.max(...placed.map((r) => r.x + r.w), SPINE_X + 1) + MARGIN;
  const rows = y - GAP + MARGIN;

  return {
    cols,
    rows,
    main: placed.find((r) => r.kind === "main")!,
    depts: placed.filter((r) => r.kind === "dept"),
    teamRooms: placed.filter((r) => r.kind === "team"),
    corridors,
    spineBottom,
  };
}

/** X tile (fractional center) of the i-th desk in a room. */
export function seatCenterX(room: Room, i: number): number {
  const span = room.seats * 4 - 1;
  const start = room.x + room.w / 2 - span / 2;
  return start + i * 4 + 1.5;
}

export interface PathPoint {
  x: number;
  y: number;
}

/** Path between rooms: down into the corridor, across (via the spine when changing rows), up into the target door. */
export function doorPath(from: Room, to: Room): PathPoint[] {
  const fromC = { x: from.doorX + 0.5, y: from.y + from.h + 1 };
  const toC = { x: to.doorX + 0.5, y: to.y + to.h + 1 };
  const points: PathPoint[] = [{ x: from.doorX + 0.5, y: from.doorY + 0.5 }, fromC];
  if (Math.abs(fromC.y - toC.y) > 0.01) {
    points.push({ x: SPINE_X, y: fromC.y });
    points.push({ x: SPINE_X, y: toC.y });
  }
  points.push(toC);
  points.push({ x: to.doorX + 0.5, y: to.doorY + 0.5 });
  return points;
}

export function allRooms(layout: OfficeLayout): Room[] {
  return [layout.main, ...layout.depts, ...layout.teamRooms];
}

export function roomAt(layout: OfficeLayout, tileX: number, tileY: number): Room | null {
  for (const room of allRooms(layout)) {
    if (tileX >= room.x && tileX < room.x + room.w && tileY >= room.y && tileY < room.y + room.h) {
      return room;
    }
  }
  return null;
}
