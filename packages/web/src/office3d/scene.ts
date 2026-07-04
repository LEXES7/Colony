import * as THREE from "three";
import type { OfficeLayout, Room } from "../office/layout";
import { SPINE_X, seatCenterX } from "../office/layout";
import { roleShirt, roleTag, shirtColor } from "../office/sprites";

/**
 * Voxel office scene. Tile coordinates from the shared 2D layout map to
 * world units 1:1 (x → x, tile row → z). Wall height ~2.1 units.
 */

export const WALL_H = 2.1;

export interface SeatRig {
  agentKey: string; // statuses key: "main", project name, or "member@team"
  group: THREE.Group; // whole character (hidden when absent)
  torso: THREE.Group; // bobs while typing
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  screen: THREE.MeshStandardMaterial; // emissive screen
  seatIndex: number;
}

export interface RoomRig {
  room: Room;
  lamp: THREE.MeshStandardMaterial;
  light: THREE.PointLight;
  dimmer: THREE.Mesh | null; // dark overlay box for unlit rooms
  seats: SeatRig[];
  hitBox: THREE.Mesh;
}

export interface OfficeScene {
  root: THREE.Group;
  rooms: Map<string, RoomRig>;
  center: THREE.Vector3;
  size: number;
}

const M = {
  grass: new THREE.MeshStandardMaterial({ color: 0x4c9346 }),
  grassDark: new THREE.MeshStandardMaterial({ color: 0x437f3e }),
  path: new THREE.MeshStandardMaterial({ color: 0x9c988e }),
  plank: new THREE.MeshStandardMaterial({ color: 0xbd9159 }),
  plankDark: new THREE.MeshStandardMaterial({ color: 0x6d5a3f }),
  stone: new THREE.MeshStandardMaterial({ color: 0x93999f }),
  stoneTop: new THREE.MeshStandardMaterial({ color: 0xa8adb3 }),
  desk: new THREE.MeshStandardMaterial({ color: 0x8a6337 }),
  deskDark: new THREE.MeshStandardMaterial({ color: 0x5e4426 }),
  black: new THREE.MeshStandardMaterial({ color: 0x14161a }),
  keyboard: new THREE.MeshStandardMaterial({ color: 0xd4d4d4 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x9fd6ee,
    transparent: true,
    opacity: 0.55,
    emissive: 0x224455,
  }),
  door: new THREE.MeshStandardMaterial({ color: 0x3a2d1e }),
  rugMain: new THREE.MeshStandardMaterial({ color: 0x8f3a3a }),
  rugTeam: new THREE.MeshStandardMaterial({ color: 0x3a5c8f }),
  shelf: new THREE.MeshStandardMaterial({ color: 0x5e4426 }),
  pot: new THREE.MeshStandardMaterial({ color: 0xb0603a }),
  leaves: new THREE.MeshStandardMaterial({ color: 0x3e8f47 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe0ac69 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x4a3220 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xe8c53d, emissive: 0x332200 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x28406e }),
  cooler: new THREE.MeshStandardMaterial({ color: 0xe8e8e8 }),
  coolerWater: new THREE.MeshStandardMaterial({
    color: 0x5aa7d6,
    transparent: true,
    opacity: 0.8,
  }),
};

const bookColors = [0xc14b4b, 0x3d6fd6, 0x4cc38a, 0xe8c53d, 0xb57edc];

function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  shadows = true
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  if (shadows) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return mesh;
}

function labelSprite(text: string, accent: boolean): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 44px 'Courier New', monospace";
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  canvas.width = w;
  canvas.height = 72;
  const c2 = canvas.getContext("2d")!;
  c2.fillStyle = accent ? "rgba(232,163,61,0.95)" : "rgba(20,22,28,0.88)";
  c2.beginPath();
  c2.roundRect(0, 0, w, 72, 14);
  c2.fill();
  c2.font = "bold 44px 'Courier New', monospace";
  c2.textAlign = "center";
  c2.textBaseline = "middle";
  c2.fillStyle = accent ? "#14161c" : "#efe3c2";
  c2.fillText(text, w / 2, 38);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  const scale = 0.014;
  sprite.scale.set(w * scale, 72 * scale, 1);
  return sprite;
}

function buildCharacter(shirtHex: string, isBoss: boolean): {
  group: THREE.Group;
  torso: THREE.Group;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
} {
  const shirt = new THREE.MeshStandardMaterial({ color: new THREE.Color(shirtHex) });
  const group = new THREE.Group();
  const torso = new THREE.Group();

  // legs (seated: short stubs under torso)
  const legs = box(0.42, 0.22, 0.3, M.pants, 0, 0.11, 0);
  group.add(legs);

  const body = box(0.46, 0.5, 0.3, shirt, 0, 0.47, 0);
  torso.add(body);
  const armL = box(0.12, 0.4, 0.16, shirt, -0.31, 0.5, 0.02);
  const armR = box(0.12, 0.4, 0.16, shirt, 0.31, 0.5, 0.02);
  torso.add(armL, armR);

  const head = box(0.4, 0.4, 0.4, M.skin, 0, 0.94, 0);
  torso.add(head);
  const hairTop = box(0.42, 0.12, 0.42, isBoss ? M.black : M.hair, 0, 1.14, 0);
  torso.add(hairTop);
  const hairBack = box(0.42, 0.22, 0.1, isBoss ? M.black : M.hair, 0, 1.0, -0.17);
  torso.add(hairBack);
  // eyes
  const eyeMat = M.black;
  torso.add(box(0.05, 0.05, 0.02, eyeMat, -0.1, 0.95, 0.21, false));
  torso.add(box(0.05, 0.05, 0.02, eyeMat, 0.1, 0.95, 0.21, false));

  if (isBoss) {
    const crown = box(0.34, 0.1, 0.34, M.gold, 0, 1.25, 0);
    torso.add(crown);
    for (const dx of [-0.12, 0, 0.12]) {
      torso.add(box(0.06, 0.1, 0.06, M.gold, dx, 1.35, 0));
    }
  }

  group.add(torso);
  return { group, torso, armL, armR };
}

function buildDesk(parent: THREE.Group, cx: number, cz: number): THREE.MeshStandardMaterial {
  parent.add(box(1.7, 0.09, 0.8, M.desk, cx, 0.72, cz));
  for (const dx of [-0.75, 0.75]) {
    parent.add(box(0.09, 0.7, 0.7, M.deskDark, cx + dx, 0.36, cz));
  }
  // monitor
  parent.add(box(0.1, 0.16, 0.1, M.black, cx, 0.84, cz - 0.1)); // stand
  parent.add(box(0.78, 0.5, 0.05, M.black, cx, 1.18, cz - 0.12));
  const screen = new THREE.MeshStandardMaterial({ color: 0x33526f, emissive: 0x0a1a26 });
  const screenMesh = box(0.7, 0.42, 0.02, screen, cx, 1.18, cz - 0.085, false);
  parent.add(screenMesh);
  // keyboard + mug
  parent.add(box(0.55, 0.04, 0.2, M.keyboard, cx, 0.79, cz + 0.16));
  parent.add(box(0.1, 0.12, 0.1, new THREE.MeshStandardMaterial({ color: 0xc14b4b }), cx + 0.65, 0.83, cz + 0.2));
  return screen;
}

function buildBookshelf(parent: THREE.Group, x: number, z: number, rotY = 0) {
  const g = new THREE.Group();
  g.add(box(1.6, 1.7, 0.35, M.shelf, 0, 0.85, 0));
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6; i++) {
      const c = bookColors[(row * 5 + i * 3) % bookColors.length]!;
      g.add(
        box(
          0.16,
          0.34,
          0.22,
          new THREE.MeshStandardMaterial({ color: c }),
          -0.6 + i * 0.24,
          0.42 + row * 0.5,
          0.05,
          false
        )
      );
    }
  }
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  parent.add(g);
}

function buildPlant(parent: THREE.Group, x: number, z: number) {
  parent.add(box(0.34, 0.3, 0.34, M.pot, x, 0.15, z));
  parent.add(box(0.5, 0.42, 0.5, M.leaves, x, 0.6, z));
  parent.add(box(0.32, 0.3, 0.32, M.leaves, x, 0.9, z));
}

function buildCooler(parent: THREE.Group, x: number, z: number) {
  parent.add(box(0.4, 0.7, 0.4, M.cooler, x, 0.35, z));
  parent.add(box(0.28, 0.36, 0.28, M.coolerWater, x, 0.9, z));
}

interface SeatSpec {
  agentKey: string;
  shirt: string;
  tag: string | null;
  isBoss: boolean;
}

function buildRoom(root: THREE.Group, room: Room, seats: SeatSpec[], title: string): RoomRig {
  const g = new THREE.Group();
  const cx = room.x + room.w / 2;
  const cz = room.y + room.h / 2;

  // floor
  const floor = box(room.w - 0.2, 0.12, room.h - 0.2, M.plank, cx, 0.06, cz);
  floor.receiveShadow = true;
  g.add(floor);

  // rug
  const rug = box(
    Math.min(room.w - 3, Math.max(3, seats.length * 3)),
    0.02,
    2.4,
    room.kind === "main" ? M.rugMain : M.rugTeam,
    cx,
    0.13,
    cz + 0.4,
    false
  );
  g.add(rug);

  // walls with door gap on south wall and window gaps on north
  const wallT = 0.35;
  const doorWx = room.doorX + 0.5;
  // south wall (two segments around the door)
  const southZ = room.y + room.h - wallT / 2;
  const leftW = doorWx - 0.6 - room.x;
  const rightW = room.x + room.w - (doorWx + 0.6);
  if (leftW > 0.1) g.add(box(leftW, WALL_H, wallT, M.stone, room.x + leftW / 2, WALL_H / 2, southZ));
  if (rightW > 0.1)
    g.add(box(rightW, WALL_H, wallT, M.stone, room.x + room.w - rightW / 2, WALL_H / 2, southZ));
  // lintel above the door
  g.add(box(1.2, WALL_H - 1.6, wallT, M.stone, doorWx, WALL_H - (WALL_H - 1.6) / 2, southZ));
  // door frame floor
  g.add(box(1.1, 0.04, wallT + 0.3, M.door, doorWx, 0.08, southZ, false));

  // north wall with two windows
  const northZ = room.y + wallT / 2;
  g.add(box(room.w, 0.9, wallT, M.stone, cx, 0.45, northZ));
  g.add(box(room.w, WALL_H - 1.7, wallT, M.stone, cx, 1.7 + (WALL_H - 1.7) / 2, northZ));
  const winXs = [room.x + 2.5, room.x + room.w - 2.5];
  // wall segments between/around windows (y band 0.9..1.7)
  const bandY = 1.3;
  const bandH = 0.8;
  const segs: [number, number][] = [
    [room.x, winXs[0]! - 0.7],
    [winXs[0]! + 0.7, winXs[1]! - 0.7],
    [winXs[1]! + 0.7, room.x + room.w],
  ];
  for (const [a, b] of segs) {
    if (b - a > 0.1) g.add(box(b - a, bandH, wallT, M.stone, (a + b) / 2, bandY, northZ));
  }
  for (const wx of winXs) {
    g.add(box(1.4, bandH, 0.06, M.glass, wx, bandY, northZ, false));
  }

  // east/west walls
  g.add(box(wallT, WALL_H, room.h, M.stone, room.x + wallT / 2, WALL_H / 2, cz));
  g.add(box(wallT, WALL_H, room.h, M.stone, room.x + room.w - wallT / 2, WALL_H / 2, cz));
  // wall caps
  g.add(box(room.w, 0.08, wallT, M.stoneTop, cx, WALL_H + 0.04, northZ, false));
  g.add(box(wallT, 0.08, room.h, M.stoneTop, room.x + wallT / 2, WALL_H + 0.04, cz, false));
  g.add(box(wallT, 0.08, room.h, M.stoneTop, room.x + room.w - wallT / 2, WALL_H + 0.04, cz, false));

  // furniture
  buildBookshelf(g, room.x + 1.4, room.y + 0.9);
  buildPlant(g, room.x + room.w - 1.2, room.y + 1.2);
  if (room.kind === "team" && room.w >= 16) {
    buildBookshelf(g, room.x + room.w - 3.2, room.y + 0.9);
  }

  // seats
  const deskZ = room.y + room.h / 2 + 0.4;
  const rigSeats: SeatRig[] = [];
  seats.forEach((spec, i) => {
    const seatX = seats.length === 1 ? cx : seatCenterX(room, i) + 0.5;
    const screen = buildDesk(g, seatX, deskZ);
    const rig = buildCharacter(spec.shirt, spec.isBoss);
    rig.group.position.set(seatX, 0.28, deskZ + 0.75);
    g.add(rig.group);
    if (spec.tag) {
      const tag = labelSprite(spec.tag, false);
      tag.position.set(seatX, 2.0, deskZ + 0.75);
      tag.scale.multiplyScalar(0.55);
      g.add(tag);
    }
    rigSeats.push({
      agentKey: spec.agentKey,
      group: rig.group,
      torso: rig.torso,
      armL: rig.armL,
      armR: rig.armR,
      screen,
      seatIndex: i,
    });
  });

  // status lamp above the door
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x4cc38a, emissive: 0x0c3322 });
  g.add(box(0.3, 0.18, 0.14, lampMat, doorWx, WALL_H - 0.15, southZ + 0.26, false));

  // room point light
  const light = new THREE.PointLight(0xffe8c0, 22, room.w + 6, 1.8);
  light.position.set(cx, WALL_H + 0.6, cz);
  g.add(light);

  // title banner
  const banner = labelSprite(title, false);
  banner.position.set(cx, WALL_H + 1.15, cz);
  g.add(banner);

  // invisible hit box for click selection
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(room.w, WALL_H + 1, room.h),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hit.position.set(cx, (WALL_H + 1) / 2, cz);
  hit.userData.roomId = room.id;
  g.add(hit);

  // dark overlay for unlit rooms
  const dimmer = new THREE.Mesh(
    new THREE.BoxGeometry(room.w - 0.8, 0.02, room.h - 0.8),
    new THREE.MeshBasicMaterial({ color: 0x05070d, transparent: true, opacity: 0.55, depthWrite: false })
  );
  dimmer.position.set(cx, 0.14, cz);
  g.add(dimmer);

  root.add(g);
  return { room, lamp: lampMat, light, dimmer, seats: rigSeats, hitBox: hit };
}

export interface SceneInputs {
  layout: OfficeLayout;
  projects: { name: string; enabled: boolean }[];
  teams: { id: string; name: string; members: { name: string; role: string }[] }[];
}

export function buildOfficeScene(inputs: SceneInputs): OfficeScene {
  const { layout } = inputs;
  const root = new THREE.Group();

  // ground
  const ground = box(layout.cols + 14, 0.2, layout.rows + 14, M.grass, layout.cols / 2, -0.1, layout.rows / 2);
  ground.receiveShadow = true;
  root.add(ground);
  // decorative grass patches
  for (let i = 0; i < 40; i++) {
    const gx = (i * 37) % (layout.cols + 10) - 5 + layout.cols * 0;
    const gz = (i * 53) % (layout.rows + 10) - 5;
    root.add(box(0.9, 0.22, 0.9, M.grassDark, gx, -0.02, gz, false));
  }

  // paths: corridors + spine
  for (const c of layout.corridors) {
    root.add(box(c.x1 - c.x0 + 1, 0.06, 2, M.path, (c.x0 + c.x1 + 1) / 2, 0.03, c.y + 1));
  }
  root.add(box(2, 0.06, layout.spineBottom - 1, M.path, SPINE_X, 0.03, (layout.spineBottom + 1) / 2));
  if (layout.corridors.length > 0) {
    buildCooler(root, SPINE_X + 2.2, layout.corridors[0]!.y + 1);
  }

  const rooms = new Map<string, RoomRig>();

  rooms.set(
    "main",
    buildRoom(root, layout.main, [{ agentKey: "main", shirt: "#5a4632", tag: null, isBoss: true }], "MAIN AGENT")
  );

  const projectsByName = new Map(inputs.projects.map((p) => [p.name, p]));
  for (const room of layout.depts) {
    rooms.set(
      room.id,
      buildRoom(
        root,
        room,
        [{ agentKey: room.id, shirt: shirtColor(room.id), tag: null, isBoss: false }],
        room.id.toUpperCase()
      )
    );
  }

  const teamsById = new Map(inputs.teams.map((t) => [t.id, t]));
  for (const room of layout.teamRooms) {
    const team = teamsById.get(room.id);
    if (!team) continue;
    rooms.set(
      room.id,
      buildRoom(
        root,
        room,
        team.members.map((m) => ({
          agentKey: `${m.name}@${team.id}`,
          shirt: roleShirt(m.role, m.name),
          tag: roleTag(m.role),
          isBoss: false,
        })),
        `★ ${team.name.toUpperCase()}`
      )
    );
  }

  // mark project rooms' enabled state once at build (animation loop refreshes)
  for (const room of layout.depts) {
    const rig = rooms.get(room.id);
    const enabled = projectsByName.get(room.id)?.enabled ?? false;
    if (rig) applyRoomLit(rig, enabled);
  }

  return {
    root,
    rooms,
    center: new THREE.Vector3(layout.cols / 2, 0, layout.rows / 2),
    size: Math.max(layout.cols, layout.rows),
  };
}

export function applyRoomLit(rig: RoomRig, lit: boolean): void {
  rig.light.intensity = lit ? 22 : 3;
  if (rig.dimmer) (rig.dimmer.material as THREE.MeshBasicMaterial).opacity = lit ? 0 : 0.55;
  for (const seat of rig.seats) {
    seat.group.visible = lit;
  }
}

const BUSY_EMISSIVE = new THREE.Color(0x39c2e8);
const IDLE_EMISSIVE = new THREE.Color(0x0a1a26);
const LAMP_BUSY = new THREE.Color(0xffb340);
const LAMP_IDLE = new THREE.Color(0x4cc38a);
const LAMP_OFF = new THREE.Color(0x555555);

/** Per-frame animation: typing bob, arms, screen glow, lamp color. */
export function animateScene(
  scene: OfficeScene,
  now: number,
  statuses: Record<string, string>,
  litOf: (roomId: string) => boolean
): void {
  for (const rig of scene.rooms.values()) {
    const lit = litOf(rig.room.id);
    applyRoomLit(rig, lit);
    let anyBusy = false;
    for (const seat of rig.seats) {
      const busy = statuses[seat.agentKey] === "busy";
      anyBusy = anyBusy || busy;
      if (busy) {
        seat.torso.position.y = Math.sin(now / 130 + seat.seatIndex * 2) * 0.03;
        seat.armL.rotation.x = -0.8 + Math.sin(now / 100 + seat.seatIndex) * 0.3;
        seat.armR.rotation.x = -0.8 + Math.cos(now / 100 + seat.seatIndex) * 0.3;
        seat.screen.emissive.copy(BUSY_EMISSIVE);
        seat.screen.emissiveIntensity = 0.9 + 0.25 * Math.sin(now / 160 + seat.seatIndex);
        seat.screen.color.setHex(0x9fe8ff);
      } else {
        seat.torso.position.y = 0;
        seat.armL.rotation.x = -0.25;
        seat.armR.rotation.x = -0.25;
        seat.screen.emissive.copy(IDLE_EMISSIVE);
        seat.screen.emissiveIntensity = 0.6;
        seat.screen.color.setHex(lit ? 0x33526f : 0x101418);
      }
    }
    rig.lamp.color.copy(anyBusy ? LAMP_BUSY : lit ? LAMP_IDLE : LAMP_OFF);
    rig.lamp.emissive.copy(anyBusy ? LAMP_BUSY : lit ? LAMP_IDLE : LAMP_OFF).multiplyScalar(0.5);
  }
}
