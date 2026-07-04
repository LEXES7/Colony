/** Office floor-plan math, all in tile units (1 tile = 16 logical px). */

export const TILE = 16;

export type RoomKind = "main" | "dept" | "team";

export interface Room {
  /** project name, team id, or "main" */
  id: string;
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  h: number;
  doorX: number;
  doorY: number;
  /** for team rooms: number of desks */
  seats: number;
}

export interface OfficeLayout {
  cols: number;
  rows: number;
  main: Room;
  depts: Room[];
  teamRooms: Room[];
}

const ROOM_W = 12;
const ROOM_H = 8;
const MAIN_W = 14;
const MAIN_H = 7;
const TEAM_H = 9;
const CORRIDOR = 2;
const MARGIN = 1;

export interface TeamShape {
  id: string;
  seats: number;
}

export function computeLayout(projectNames: string[], teams: TeamShape[] = []): OfficeLayout {
  const perRow = Math.min(3, Math.max(1, projectNames.length || 1));
  const teamWidths = teams.map((t) => Math.max(ROOM_W, 4 + t.seats * 4));
  const width =
    Math.max(perRow * (ROOM_W + 1) - 1, MAIN_W, ...(teamWidths.length ? teamWidths : [0])) +
    MARGIN * 2;

  const mainX = Math.floor((width - MAIN_W) / 2);
  const main: Room = {
    id: "main",
    kind: "main",
    x: mainX,
    y: MARGIN,
    w: MAIN_W,
    h: MAIN_H,
    doorX: mainX + Math.floor(MAIN_W / 2),
    doorY: MARGIN + MAIN_H - 1,
    seats: 1,
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
      kind: "dept",
      x,
      y,
      w: ROOM_W,
      h: ROOM_H,
      doorX: x + Math.floor(ROOM_W / 2),
      doorY: y,
      seats: 1,
    });
  });

  const deptRows = Math.ceil(projectNames.length / perRow);
  let teamY = MARGIN + MAIN_H + CORRIDOR + deptRows * (ROOM_H + CORRIDOR);
  const teamRooms: Room[] = [];
  for (let i = 0; i < teams.length; i++) {
    const w = teamWidths[i]!;
    const x = Math.floor((width - w) / 2);
    teamRooms.push({
      id: teams[i]!.id,
      kind: "team",
      x,
      y: teamY,
      w,
      h: TEAM_H,
      doorX: x + Math.floor(w / 2),
      doorY: teamY,
      seats: teams[i]!.seats,
    });
    teamY += TEAM_H + CORRIDOR;
  }

  const rows = teamY - CORRIDOR + MARGIN + 1;
  return { cols: width, rows, main, depts, teamRooms };
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

/** Corridor path from one room's door to another's (L-shaped via corridors). */
export function doorPath(from: Room, to: Room): PathPoint[] {
  const fromOut = { x: from.doorX + 0.5, y: from.doorY === from.y ? from.y - 1 : from.doorY + 1.5 };
  const toOut = { x: to.doorX + 0.5, y: to.doorY === to.y ? to.y - 1 : to.doorY + 1.5 };
  const points: PathPoint[] = [{ x: from.doorX + 0.5, y: from.doorY + 0.5 }, fromOut];
  if (Math.abs(fromOut.y - toOut.y) > 0.01) {
    points.push({ x: toOut.x, y: fromOut.y });
  }
  points.push(toOut);
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
