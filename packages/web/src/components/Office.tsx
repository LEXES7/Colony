import { useEffect, useRef } from "react";
import type { ProjectPublic, TeamPublic } from "@colony/shared";
import { useHub, type ActivityItem } from "./../store";
import {
  allRooms,
  computeLayout,
  doorPath,
  roomAt,
  seatCenterX,
  SPINE_X,
  TILE,
  type OfficeLayout,
  type PathPoint,
  type Room,
} from "./../office/layout";
import {
  BOOKSHELF,
  BOOKSHELF_PALETTE,
  BOSS,
  BOSS_PALETTE,
  COOLER,
  COOLER_PALETTE,
  drawSprite,
  ENVELOPE,
  ENVELOPE_PALETTE_A,
  ENVELOPE_PALETTE_Q,
  PLANT,
  PLANT_PALETTE,
  roleShirt,
  roleTag,
  shirtColor,
  tileNoise,
  WORKER,
  WORKER_TYPING,
  workerPalette,
} from "./../office/sprites";

const SCALE = 2; // CSS px per logical px
const PX = 2; // logical px per sprite pixel
const MESSENGER_SPEED = 6;
const OUTLINE = "rgba(20,16,10,0.85)";

interface Messenger {
  path: PathPoint[];
  progress: number;
  total: number;
  kind: "question" | "answer";
}

interface Seat {
  cx: number;
  shirt: string;
  tag: string | null;
  busy: boolean;
  present: boolean;
  isBoss: boolean;
}

interface OfficeProps {
  onSelect: (name: string | null) => void;
  selected: string | null;
}

export default function Office({ onSelect, selected }: OfficeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectsRef = useRef<ProjectPublic[]>(useHub.getState().projects);
  const teamsRef = useRef<TeamPublic[]>(useHub.getState().teams);
  const statusesRef = useRef<Record<string, string>>(useHub.getState().statuses);
  const selectedRef = useRef<string | null>(selected);
  const layoutRef = useRef<OfficeLayout>(computeLayout([]));
  const messengersRef = useRef<Messenger[]>([]);
  const seenActivityRef = useRef(0);

  selectedRef.current = selected;

  useEffect(() => {
    const sync = () => {
      const s = useHub.getState();
      projectsRef.current = s.projects;
      teamsRef.current = s.teams;
      statusesRef.current = s.statuses;
      layoutRef.current = computeLayout(
        s.projects.map((p) => p.name),
        s.teams.map((t) => ({ id: t.id, seats: Math.max(1, t.members.length) }))
      );
      const activity = s.activity;
      for (let i = seenActivityRef.current; i < activity.length; i++) {
        spawnMessenger(activity[i]!);
      }
      seenActivityRef.current = activity.length;
    };
    sync();
    return useHub.subscribe(sync);
  }, []);

  function roomIdOf(agentId: string): string {
    const at = agentId.indexOf("@");
    return at === -1 ? agentId : agentId.slice(at + 1);
  }

  function spawnMessenger(item: ActivityItem) {
    if (item.kind !== "question" && item.kind !== "answer") return;
    const layout = layoutRef.current;
    const rooms = new Map(allRooms(layout).map((r) => [r.id, r] as const));
    const from = rooms.get(roomIdOf(item.from));
    const to = rooms.get(roomIdOf(item.to));
    if (!from || !to || from === to) return;
    const path = doorPath(from, to);
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
    }
    messengersRef.current.push({ path, progress: 0, total, kind: item.kind });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const layout = layoutRef.current;
      const cssW = layout.cols * TILE * SCALE;
      const cssH = layout.rows * TILE * SCALE;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
      }
      // fit-to-container display scale, snapped so pixels stay even and crisp
      const holder = canvas.parentElement;
      if (holder) {
        const avail = holder.clientWidth - 8;
        const raw = Math.min(1, avail / cssW);
        const snapped = raw >= 1 ? 1 : raw >= 0.75 ? 0.75 : 0.5;
        const dispW = Math.round(cssW * snapped);
        if (canvas.style.width !== `${dispW}px`) {
          canvas.style.width = `${dispW}px`;
          canvas.style.height = `${Math.round(cssH * snapped)}px`;
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      draw(ctx, layout, now, dt, cssW, cssH);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  function draw(
    ctx: CanvasRenderingContext2D,
    layout: OfficeLayout,
    now: number,
    dt: number,
    cssW: number,
    cssH: number
  ) {
    const t = TILE * SCALE;

    // --- terrain ---
    for (let y = 0; y < layout.rows; y++) {
      for (let x = 0; x < layout.cols; x++) {
        const n = tileNoise(x, y);
        const m = tileNoise(x + 31, y + 17);
        ctx.fillStyle =
          n > 0.9 ? "#55a04e" : n > 0.62 ? "#4c9346" : n > 0.3 ? "#468a41" : "#3f7f3c";
        ctx.fillRect(x * t, y * t, t, t);
        if (m > 0.8) {
          // grass blades
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(x * t + t * 0.2, y * t + t * 0.3, SCALE, SCALE * 2);
          ctx.fillRect(x * t + t * 0.65, y * t + t * 0.55, SCALE, SCALE * 2);
        }
        if (n > 0.97) {
          ctx.fillStyle = tileNoise(x + 5, y) > 0.5 ? "#e8c53d" : "#f0f0f0";
          ctx.fillRect(x * t + t / 3, y * t + t / 3, SCALE * 2, SCALE * 2);
          ctx.fillStyle = "rgba(0,0,0,0.15)";
          ctx.fillRect(x * t + t / 3, y * t + t / 3 + SCALE * 2, SCALE * 2, SCALE);
        }
      }
    }

    // --- hallways: corridors + spine ---
    const pave = (x: number, y: number) => {
      const n = tileNoise(x + 99, y + 7);
      ctx.fillStyle = n > 0.7 ? "#a8a49a" : n > 0.35 ? "#9c988e" : "#938f86";
      ctx.fillRect(x * t, y * t, t, t);
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(x * t, y * t + t - SCALE, t, SCALE);
      ctx.fillRect(x * t + t - SCALE, y * t, SCALE, t);
    };
    for (const c of layout.corridors) {
      for (let x = c.x0; x <= c.x1; x++) {
        pave(x, c.y);
        pave(x, c.y + 1);
      }
      // corridor edge shadow (from the rooms above)
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(c.x0 * t, c.y * t, (c.x1 - c.x0 + 1) * t, SCALE * 2);
    }
    for (let y = 1; y < layout.spineBottom; y++) {
      pave(SPINE_X - 1, y);
      pave(SPINE_X, y);
    }

    // water cooler in the first corridor by the spine
    if (layout.corridors.length > 0) {
      drawSprite(
        ctx,
        COOLER,
        COOLER_PALETTE,
        (SPINE_X + 2) * t,
        layout.corridors[0]!.y * t + 6,
        PX * SCALE,
        OUTLINE
      );
    }

    const projects = new Map(projectsRef.current.map((p) => [p.name, p]));
    const teams = new Map(teamsRef.current.map((tm) => [tm.id, tm]));
    const statuses = statusesRef.current;

    // drop shadows for all rooms first (soft, offset)
    for (const room of allRooms(layout)) {
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(room.x * t + SCALE * 3, room.y * t + SCALE * 4, room.w * t, room.h * t);
    }

    drawRoom(ctx, layout.main, now, {
      title: "MAIN AGENT",
      lit: true,
      selected: selectedRef.current === "main",
      seats: [
        {
          cx: layout.main.x + layout.main.w / 2,
          shirt: "#5a4632",
          tag: null,
          busy: statuses["main"] === "busy",
          present: true,
          isBoss: true,
        },
      ],
    });

    for (const room of layout.depts) {
      const p = projects.get(room.id);
      const busy = (statuses[room.id] ?? p?.status) === "busy";
      drawRoom(ctx, room, now, {
        title: room.id.toUpperCase(),
        lit: p?.enabled ?? false,
        selected: selectedRef.current === room.id,
        seats: [
          {
            cx: room.x + room.w / 2,
            shirt: shirtColor(room.id),
            tag: null,
            busy,
            present: p?.enabled ?? false,
            isBoss: false,
          },
        ],
      });
    }

    for (const room of layout.teamRooms) {
      const team = teams.get(room.id);
      if (!team) continue;
      drawRoom(ctx, room, now, {
        title: `★ ${team.name.toUpperCase()}`,
        lit: true,
        selected: selectedRef.current === room.id,
        seats: team.members.map((m, i) => ({
          cx: seatCenterX(room, i),
          shirt: roleShirt(m.role, m.name),
          tag: roleTag(m.role),
          busy: statuses[`${m.name}@${team.id}`] === "busy",
          present: true,
          isBoss: false,
        })),
      });
    }

    // messengers
    const envPx = PX * SCALE * 0.9;
    messengersRef.current = messengersRef.current.filter((m) => m.progress < m.total);
    for (const m of messengersRef.current) {
      m.progress += dt * MESSENGER_SPEED;
      const pos = pointAlong(m.path, Math.min(m.progress, m.total));
      const bob = Math.sin(now / 90) * 2;
      // little shadow under the envelope
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(pos.x * t - envPx * 2, pos.y * t + envPx * 2.4, envPx * 4, envPx);
      drawSprite(
        ctx,
        ENVELOPE,
        m.kind === "question" ? ENVELOPE_PALETTE_Q : ENVELOPE_PALETTE_A,
        pos.x * t - (7 * envPx) / 2,
        pos.y * t - (5 * envPx) / 2 + bob,
        envPx,
        OUTLINE
      );
    }

    // vignette for depth
    const vg = ctx.createRadialGradient(
      cssW / 2,
      cssH / 2,
      Math.min(cssW, cssH) * 0.45,
      cssW / 2,
      cssH / 2,
      Math.max(cssW, cssH) * 0.75
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(10,14,24,0.35)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  interface RoomStyle {
    title: string;
    lit: boolean;
    selected: boolean;
    seats: Seat[];
  }

  function drawRoom(ctx: CanvasRenderingContext2D, room: Room, now: number, style: RoomStyle) {
    const t = TILE * SCALE;
    const { x, y, w, h } = room;

    // --- floor with plank pattern ---
    for (let ty = y + 1; ty < y + h - 1; ty++) {
      for (let tx = x + 1; tx < x + w - 1; tx++) {
        const n = tileNoise(tx, ty);
        ctx.fillStyle = style.lit
          ? n > 0.66
            ? "#c49a63"
            : n > 0.33
              ? "#b98f58"
              : "#c0955d"
          : n > 0.5
            ? "#6d5a3f"
            : "#665438";
        ctx.fillRect(tx * t, ty * t, t, t);
        ctx.fillStyle = "rgba(0,0,0,0.10)";
        ctx.fillRect(tx * t, ty * t + t - SCALE, t, SCALE);
        if ((tx + ty) % 2 === 0) {
          ctx.fillStyle = "rgba(0,0,0,0.05)";
          ctx.fillRect(tx * t + t / 2, ty * t, SCALE, t);
        }
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        ctx.fillRect(tx * t, ty * t, t, SCALE);
      }
    }
    // ambient occlusion along inner walls
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect((x + 1) * t, (y + 1) * t, (w - 2) * t, SCALE * 3);
    ctx.fillRect((x + 1) * t, (y + 1) * t, SCALE * 3, (h - 2) * t);
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect((x + 1) * t, (y + h - 1) * t - SCALE * 3, (w - 2) * t, SCALE * 3);
    ctx.fillRect((x + w - 1) * t - SCALE * 3, (y + 1) * t, SCALE * 3, (h - 2) * t);

    // rug
    const rugW = Math.min(w - 4, Math.max(4, style.seats.length * 4)) * t;
    const rugX = (x + w / 2) * t - rugW / 2;
    const rugY = (y + Math.floor(h / 2) - 0.6) * t;
    ctx.fillStyle = room.kind === "main" ? "rgba(150,45,45,0.4)" : "rgba(52,96,160,0.32)";
    ctx.fillRect(rugX, rugY, rugW, t * 2.6);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(rugX + SCALE * 2, rugY + SCALE * 2, rugW - SCALE * 4, SCALE);
    ctx.fillRect(rugX + SCALE * 2, rugY + t * 2.6 - SCALE * 3, rugW - SCALE * 4, SCALE);

    // --- walls with top-light shading ---
    for (let tx = x; tx < x + w; tx++) {
      for (const ty of [y, y + h - 1]) {
        if (tx === room.doorX && ty === room.doorY) continue;
        drawWallTile(ctx, tx, ty);
      }
    }
    for (let ty = y; ty < y + h; ty++) {
      for (const tx of [x, x + w - 1]) {
        if (tx === room.doorX && ty === room.doorY) continue;
        drawWallTile(ctx, tx, ty);
      }
    }

    // windows on the top wall + light beams onto the floor
    for (const wx of [x + 2, x + w - 3]) {
      if (wx === room.doorX) continue;
      ctx.fillStyle = "#2b2f38";
      ctx.fillRect(wx * t + SCALE, y * t + SCALE, t - SCALE * 2, t - SCALE * 2);
      const sky = ctx.createLinearGradient(0, y * t, 0, y * t + t);
      sky.addColorStop(0, "#a8dcf0");
      sky.addColorStop(1, "#6db6dd");
      ctx.fillStyle = sky;
      ctx.fillRect(wx * t + SCALE * 2, y * t + SCALE * 2, t - SCALE * 4, t - SCALE * 4);
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillRect(wx * t + SCALE * 3, y * t + SCALE * 3, SCALE * 2, t - SCALE * 6);
      if (style.lit) {
        const beam = ctx.createLinearGradient(0, (y + 1) * t, 0, (y + 3.4) * t);
        beam.addColorStop(0, "rgba(255,250,220,0.22)");
        beam.addColorStop(1, "rgba(255,250,220,0)");
        ctx.fillStyle = beam;
        ctx.fillRect(wx * t - SCALE * 2, (y + 1) * t, t + SCALE * 4, t * 2.4);
      }
    }

    // door opening (bottom wall) with a floor light spill into the corridor
    ctx.fillStyle = "#241a10";
    ctx.fillRect(room.doorX * t, room.doorY * t, t, t);
    ctx.fillStyle = "#3a2d1e";
    ctx.fillRect(room.doorX * t + SCALE, room.doorY * t, t - SCALE * 2, t - SCALE);
    if (style.lit) {
      ctx.fillStyle = "rgba(255,240,200,0.12)";
      ctx.fillRect(room.doorX * t, (room.doorY + 1) * t, t, SCALE * 4);
    }

    // furniture
    if (w >= 8) {
      drawSprite(ctx, BOOKSHELF, BOOKSHELF_PALETTE, (x + 1) * t + SCALE * 2, (y + 1) * t + SCALE, PX * SCALE, OUTLINE);
      drawSprite(ctx, PLANT, PLANT_PALETTE, (x + w - 2) * t + SCALE * 2, (y + 1) * t + SCALE * 2, PX * SCALE, OUTLINE);
      if (room.kind === "team" && w >= 16) {
        drawSprite(ctx, BOOKSHELF, BOOKSHELF_PALETTE, (x + w - 4.6) * t, (y + 1) * t + SCALE, PX * SCALE, OUTLINE);
      }
    }

    // seats
    const deskY = y + Math.floor(h / 2);
    for (const seat of style.seats) {
      drawSeat(ctx, seat, deskY, now, style.lit);
    }

    if (!style.lit) {
      ctx.fillStyle = "rgba(8,10,18,0.5)";
      ctx.fillRect((x + 1) * t, (y + 1) * t, (w - 2) * t, (h - 2) * t);
    }

    // status lamp above the door
    const anyBusy = style.seats.some((s) => s.busy);
    const lamp = anyBusy ? "#ffb340" : style.lit ? "#4cc38a" : "#555";
    if (anyBusy) {
      ctx.fillStyle = "rgba(255,179,64,0.25)";
      ctx.fillRect(room.doorX * t + t / 2 - SCALE * 5, room.doorY * t + t - SCALE * 6, SCALE * 10, SCALE * 6);
    }
    ctx.fillStyle = lamp;
    ctx.fillRect(room.doorX * t + t / 2 - SCALE * 2, room.doorY * t + t - SCALE * 3, SCALE * 4, SCALE * 3);

    // name banner
    ctx.font = `bold ${7 * SCALE}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    const label = style.title.length > 24 ? style.title.slice(0, 23) + "…" : style.title;
    const bw = ctx.measureText(label).width + 10 * SCALE;
    const bx = Math.round((x + w / 2) * t);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(bx - bw / 2 + SCALE, y * t - 5 * SCALE, bw, 10 * SCALE);
    ctx.fillStyle = style.selected ? "#e8a33d" : "rgba(24,27,34,0.95)";
    ctx.fillRect(bx - bw / 2, y * t - 6 * SCALE, bw, 10 * SCALE);
    ctx.fillStyle = style.selected ? "#14161c" : "#efe3c2";
    ctx.fillText(label, bx, y * t + 2 * SCALE);
  }

  function drawSeat(ctx: CanvasRenderingContext2D, seat: Seat, deskY: number, now: number, lit: boolean) {
    const t = TILE * SCALE;
    const px = PX * SCALE;
    const deskLeft = (seat.cx - 1.5) * t;

    // office chair behind the worker
    if (seat.present) {
      ctx.fillStyle = "#23262e";
      ctx.fillRect(seat.cx * t - t * 0.42, deskY * t - t * 1.28, t * 0.84, t * 0.5);
      ctx.fillRect(seat.cx * t - SCALE, deskY * t - t * 0.8, SCALE * 2, t * 0.3);
    }

    // worker first — the desk overlaps their lower body
    if (seat.present) {
      const spriteW = 8 * px;
      const wx = seat.cx * t - spriteW / 2;
      const bob = seat.busy ? Math.round(Math.sin(now / 120 + seat.cx)) * SCALE : 0;
      const wy = deskY * t - 9 * px + bob - t * 0.05;
      if (seat.isBoss) {
        drawSprite(ctx, BOSS, BOSS_PALETTE, wx, wy - px, px, OUTLINE);
      } else {
        const grid = seat.busy && Math.sin(now / 120 + seat.cx) > 0 ? WORKER_TYPING : WORKER;
        drawSprite(ctx, grid, workerPalette(seat.shirt), wx, wy, px, OUTLINE);
      }
      if (seat.busy) {
        for (let i = 0; i < 3; i++) {
          const phase = (now / 700 + i / 3 + seat.cx) % 1;
          ctx.fillStyle = `rgba(140,255,180,${(1 - phase) * 0.9})`;
          ctx.fillRect(
            wx + spriteW / 2 + Math.sin((phase + i) * 6) * 8 * SCALE,
            wy - 6 * SCALE - phase * 14 * SCALE,
            SCALE * 2,
            SCALE * 2
          );
        }
      }
    }

    // desk with wood grain + edge shading
    const deskH = Math.floor(t * 0.75);
    ctx.fillStyle = lit ? "#8a6337" : "#55432c";
    ctx.fillRect(deskLeft, deskY * t, 3 * t, deskH);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(deskLeft, deskY * t, 3 * t, SCALE);
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    for (let g = 0; g < 3; g++) {
      ctx.fillRect(deskLeft + g * t + t * 0.2, deskY * t + SCALE * 2, t * 0.6, SCALE);
    }
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(deskLeft, deskY * t + deskH - SCALE * 2, 3 * t, SCALE * 2);

    // computer: monitor with glow + stand + keyboard
    const monW = t * 0.95;
    const monX = seat.cx * t - monW / 2;
    const monY = deskY * t - t * 0.28;
    if (seat.busy) {
      ctx.fillStyle = "rgba(80,220,255,0.16)";
      ctx.fillRect(monX - SCALE * 3, monY - SCALE * 3, monW + SCALE * 6, t * 0.5 + SCALE * 6);
    }
    ctx.fillStyle = "#14161a";
    ctx.fillRect(monX, monY, monW, t * 0.5);
    ctx.fillStyle = seat.busy
      ? `rgba(90,225,255,${0.75 + 0.25 * Math.sin(now / 150 + seat.cx)})`
      : lit && seat.present
        ? "#33526f"
        : "#0d0d0d";
    ctx.fillRect(monX + SCALE, monY + SCALE, monW - SCALE * 2, t * 0.5 - SCALE * 2);
    if (seat.busy) {
      for (let i = 0; i < 3; i++) {
        const ly = monY + SCALE * 2 + ((now / 400 + i * 4) % (t * 0.5 - SCALE * 5));
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillRect(monX + SCALE * 2, ly, monW * (0.3 + tileNoise(i, Math.floor(now / 400)) * 0.4), SCALE);
      }
    } else if (lit && seat.present) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(monX + SCALE * 2, monY + SCALE * 2, monW * 0.3, SCALE);
    }
    ctx.fillStyle = "#14161a";
    ctx.fillRect(seat.cx * t - SCALE, monY + t * 0.5, SCALE * 2, SCALE * 2);
    ctx.fillStyle = "#d4d4d4";
    ctx.fillRect(seat.cx * t - t * 0.35, deskY * t + t * 0.2, t * 0.7, t * 0.18);
    ctx.fillStyle = "#9a9a9a";
    for (let k = 0; k < 5; k++) {
      ctx.fillRect(seat.cx * t - t * 0.3 + k * t * 0.12, deskY * t + t * 0.24, SCALE, SCALE);
    }
    // coffee mug with steam when busy
    ctx.fillStyle = "#c14b4b";
    ctx.fillRect(deskLeft + t * 2.55, deskY * t + t * 0.12, SCALE * 3, SCALE * 3);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(deskLeft + t * 2.55, deskY * t + t * 0.12, SCALE * 3, SCALE);
    if (seat.busy) {
      const sp = (now / 500) % 1;
      ctx.fillStyle = `rgba(255,255,255,${0.3 * (1 - sp)})`;
      ctx.fillRect(deskLeft + t * 2.6, deskY * t + t * 0.12 - SCALE * 2 - sp * SCALE * 4, SCALE, SCALE * 2);
    }

    // role tag under the desk
    if (seat.tag) {
      ctx.font = `bold ${5 * SCALE}px 'Courier New', monospace`;
      ctx.textAlign = "center";
      const tagW = ctx.measureText(seat.tag).width + 5 * SCALE;
      ctx.fillStyle = "rgba(16,18,24,0.92)";
      ctx.fillRect(seat.cx * t - tagW / 2, (deskY + 1) * t, tagW, 7 * SCALE);
      ctx.fillStyle = seat.shirt;
      ctx.fillText(seat.tag, seat.cx * t, (deskY + 1) * t + 5 * SCALE);
    }
  }

  function drawWallTile(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
    const t = TILE * SCALE;
    const n = tileNoise(tx + 7, ty + 3);
    ctx.fillStyle = n > 0.5 ? "#9aa0a8" : "#8f959d";
    ctx.fillRect(tx * t, ty * t, t, t);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(tx * t, ty * t, t, SCALE * 2);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(tx * t, ty * t + t - SCALE * 2, t, SCALE * 2);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(tx * t, ty * t + t / 2 - SCALE / 2, t, SCALE);
    ctx.fillRect(tx * t + ((tx + ty) % 2 === 0 ? t / 2 : t / 4), ty * t, SCALE, t / 2);
  }

  function pointAlong(path: PathPoint[], dist: number): PathPoint {
    let remaining = dist;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (remaining <= seg || i === path.length - 1) {
        const f = seg === 0 ? 0 : Math.min(remaining / seg, 1);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
      remaining -= seg;
    }
    return path[path.length - 1]!;
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const disp = rect.width / (layoutRef.current.cols * TILE * SCALE); // display scale
    const tileX = Math.floor((e.clientX - rect.left) / disp / (TILE * SCALE));
    const tileY = Math.floor((e.clientY - rect.top) / disp / (TILE * SCALE));
    const room = roomAt(layoutRef.current, tileX, tileY);
    onSelect(room ? room.id : null);
  };

  return (
    <div className="office-scroll">
      <canvas ref={canvasRef} className="office-canvas" onClick={handleClick} />
    </div>
  );
}
