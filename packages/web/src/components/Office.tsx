import { useEffect, useRef } from "react";
import type { ProjectPublic, TeamPublic } from "@colony/shared";
import { useHub, type ActivityItem } from "./../store";
import {
  allRooms,
  computeLayout,
  doorPath,
  roomAt,
  seatCenterX,
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

const SCALE = 2;
const PX = 2;
const MESSENGER_SPEED = 6;

interface Messenger {
  path: PathPoint[];
  progress: number;
  total: number;
  kind: "question" | "answer";
}

interface Seat {
  cx: number; // tile center x of the desk
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

  /** Map an agent id to its room id ("dev-1@apollo" -> "apollo"). */
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
      const w = layout.cols * TILE * SCALE;
      const h = layout.rows * TILE * SCALE;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.imageSmoothingEnabled = false;
      draw(ctx, layout, now, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  function draw(ctx: CanvasRenderingContext2D, layout: OfficeLayout, now: number, dt: number) {
    const t = TILE * SCALE;
    // grass with flowers
    for (let y = 0; y < layout.rows; y++) {
      for (let x = 0; x < layout.cols; x++) {
        const n = tileNoise(x, y);
        ctx.fillStyle = n > 0.85 ? "#3f7d3b" : n > 0.5 ? "#468a41" : "#4c9346";
        ctx.fillRect(x * t, y * t, t, t);
        if (n > 0.965) {
          ctx.fillStyle = tileNoise(x + 5, y) > 0.5 ? "#e8c53d" : "#e0e0e0";
          ctx.fillRect(x * t + t / 3, y * t + t / 3, SCALE * 2, SCALE * 2);
        }
      }
    }
    // corridors
    const corridorRows = new Set<number>();
    corridorRows.add(layout.main.y + layout.main.h);
    corridorRows.add(layout.main.y + layout.main.h + 1);
    for (const r of [...layout.depts, ...layout.teamRooms]) {
      corridorRows.add(r.y - 1);
      corridorRows.add(r.y - 2);
    }
    for (const y of corridorRows) {
      for (let x = 1; x < layout.cols - 1; x++) {
        const n = tileNoise(x + 99, y);
        ctx.fillStyle = n > 0.6 ? "#9b9b93" : "#8b8b84";
        ctx.fillRect(x * t, y * t, t, t);
      }
    }
    // water cooler in the top corridor, left of the main door
    drawSprite(
      ctx,
      COOLER,
      COOLER_PALETTE,
      (layout.main.doorX - 3) * t + 4,
      (layout.main.y + layout.main.h) * t + 4,
      PX * SCALE
    );

    const projects = new Map(projectsRef.current.map((p) => [p.name, p]));
    const teams = new Map(teamsRef.current.map((tm) => [tm.id, tm]));
    const statuses = statusesRef.current;

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
        title: `⚑ ${team.name.toUpperCase()}`,
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
      drawSprite(
        ctx,
        ENVELOPE,
        m.kind === "question" ? ENVELOPE_PALETTE_Q : ENVELOPE_PALETTE_A,
        pos.x * t - (7 * envPx) / 2,
        pos.y * t - (5 * envPx) / 2 + bob,
        envPx
      );
    }
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

    // floor
    for (let ty = y + 1; ty < y + h - 1; ty++) {
      for (let tx = x + 1; tx < x + w - 1; tx++) {
        const n = tileNoise(tx, ty);
        ctx.fillStyle = style.lit
          ? n > 0.66
            ? "#b8905a"
            : n > 0.33
              ? "#ad8752"
              : "#b28c56"
          : n > 0.5
            ? "#6d5a3f"
            : "#665438";
        ctx.fillRect(tx * t, ty * t, t, t);
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(tx * t, ty * t + t - SCALE, t, SCALE);
      }
    }

    // rug under the desks
    const rugW = Math.min(w - 4, Math.max(4, style.seats.length * 4)) * t;
    const rugX = (x + w / 2) * t - rugW / 2;
    const rugY = (y + Math.floor(h / 2) - 0.6) * t;
    ctx.fillStyle = room.kind === "main" ? "rgba(160,50,50,0.35)" : "rgba(50,90,150,0.28)";
    ctx.fillRect(rugX, rugY, rugW, t * 2.6);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = SCALE;
    ctx.strokeRect(rugX + SCALE * 2, rugY + SCALE * 2, rugW - SCALE * 4, t * 2.6 - SCALE * 4);

    // walls + windows
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
    // windows on the wall opposite the door
    const winY = room.doorY === y ? y + h - 1 : y;
    for (const wx of [x + 2, x + w - 3]) {
      if (wx === room.doorX) continue;
      ctx.fillStyle = "#7ec8e8";
      ctx.fillRect(wx * t + SCALE * 2, winY * t + SCALE * 2, t - SCALE * 4, t - SCALE * 4);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(wx * t + SCALE * 2, winY * t + SCALE * 2, SCALE * 2, t - SCALE * 4);
    }
    // door opening
    ctx.fillStyle = "#3a2d1e";
    ctx.fillRect(room.doorX * t, room.doorY * t, t, t);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(room.doorX * t + t / 4, room.doorY * t, t / 2, t);

    // bookshelf against the left wall, plant in the right corner
    if (w >= 8) {
      drawSprite(ctx, BOOKSHELF, BOOKSHELF_PALETTE, (x + 1) * t + SCALE, (y + 1) * t + SCALE, PX * SCALE);
      drawSprite(ctx, PLANT, PLANT_PALETTE, (x + w - 2) * t + SCALE * 2, (y + 1) * t + SCALE * 2, PX * SCALE);
      if (room.kind === "team") {
        drawSprite(ctx, PLANT, PLANT_PALETTE, (x + 1) * t + SCALE * 2, (y + h - 2) * t - SCALE * 4, PX * SCALE);
      }
    }

    // seats: worker + desk + computer per seat
    const deskY = y + Math.floor(h / 2);
    for (const seat of style.seats) {
      drawSeat(ctx, seat, deskY, now, style.lit);
    }

    if (!style.lit) {
      ctx.fillStyle = "rgba(10,10,20,0.45)";
      ctx.fillRect((x + 1) * t, (y + 1) * t, (w - 2) * t, (h - 2) * t);
    }

    // status lamp above the door
    const anyBusy = style.seats.some((s) => s.busy);
    ctx.fillStyle = anyBusy ? "#e8a33d" : style.lit ? "#4cc38a" : "#555";
    ctx.fillRect(room.doorX * t + t / 2 - SCALE * 2, room.doorY * t - SCALE * 3, SCALE * 4, SCALE * 3);

    // name banner
    ctx.font = `${7 * SCALE}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    const label = style.title.length > 22 ? style.title.slice(0, 21) + "…" : style.title;
    const bw = ctx.measureText(label).width + 8 * SCALE;
    const bx = (x + w / 2) * t;
    ctx.fillStyle = style.selected ? "#e8a33d" : "rgba(20,22,28,0.85)";
    ctx.fillRect(bx - bw / 2, y * t - 6 * SCALE, bw, 9 * SCALE);
    ctx.fillStyle = style.selected ? "#14161c" : "#e6d9b8";
    ctx.fillText(label, bx, y * t + SCALE);
  }

  function drawSeat(ctx: CanvasRenderingContext2D, seat: Seat, deskY: number, now: number, lit: boolean) {
    const t = TILE * SCALE;
    const px = PX * SCALE;
    const deskLeft = (seat.cx - 1.5) * t;

    // worker first — the desk overlaps their lower body
    if (seat.present) {
      const spriteW = 8 * px;
      const wx = seat.cx * t - spriteW / 2;
      const bob = seat.busy ? Math.round(Math.sin(now / 120 + seat.cx)) * SCALE : 0;
      const wy = deskY * t - 9 * px + bob - t * 0.05;
      if (seat.isBoss) {
        drawSprite(ctx, BOSS, BOSS_PALETTE, wx, wy - px, px);
      } else {
        const grid = seat.busy && Math.sin(now / 120 + seat.cx) > 0 ? WORKER_TYPING : WORKER;
        drawSprite(ctx, grid, workerPalette(seat.shirt), wx, wy, px);
      }
      if (seat.busy) {
        for (let i = 0; i < 3; i++) {
          const phase = (now / 700 + i / 3 + seat.cx) % 1;
          ctx.fillStyle = `rgba(120,255,160,${1 - phase})`;
          ctx.fillRect(
            wx + spriteW / 2 + Math.sin((phase + i) * 6) * 8 * SCALE,
            wy - 6 * SCALE - phase * 14 * SCALE,
            SCALE * 2,
            SCALE * 2
          );
        }
      }
    }

    // desk
    ctx.fillStyle = lit ? "#7d5a33" : "#55432c";
    ctx.fillRect(deskLeft, deskY * t, 3 * t, Math.floor(t * 0.75));
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(deskLeft, deskY * t, 3 * t, SCALE);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(deskLeft, deskY * t + Math.floor(t * 0.75) - SCALE * 2, 3 * t, SCALE * 2);

    // computer: monitor + stand + keyboard
    const monW = t * 0.9;
    const monX = seat.cx * t - monW / 2;
    const monY = deskY * t - t * 0.28;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(monX, monY, monW, t * 0.5);
    ctx.fillStyle = seat.busy
      ? `rgba(80,220,255,${0.7 + 0.3 * Math.sin(now / 150 + seat.cx)})`
      : lit && seat.present
        ? "#31506e"
        : "#0d0d0d";
    ctx.fillRect(monX + SCALE, monY + SCALE, monW - SCALE * 2, t * 0.5 - SCALE * 2);
    if (seat.busy) {
      // scrolling code lines on the screen
      for (let i = 0; i < 3; i++) {
        const ly = monY + SCALE * 2 + ((now / 400 + i * 4) % (t * 0.5 - SCALE * 5));
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(monX + SCALE * 2, ly, monW * (0.3 + tileNoise(i, Math.floor(now / 400)) * 0.4), SCALE);
      }
    }
    ctx.fillStyle = "#1a1a1a"; // stand
    ctx.fillRect(seat.cx * t - SCALE, monY + t * 0.5, SCALE * 2, SCALE * 2);
    ctx.fillStyle = "#c9c9c9"; // keyboard
    ctx.fillRect(seat.cx * t - t * 0.35, deskY * t + t * 0.18, t * 0.7, t * 0.18);
    ctx.fillStyle = "#8a8a8a";
    for (let k = 0; k < 5; k++) {
      ctx.fillRect(seat.cx * t - t * 0.3 + k * t * 0.12, deskY * t + t * 0.22, SCALE, SCALE);
    }
    // coffee mug
    ctx.fillStyle = "#c14b4b";
    ctx.fillRect(deskLeft + t * 2.55, deskY * t + t * 0.12, SCALE * 3, SCALE * 3);

    // role tag under the desk
    if (seat.tag) {
      ctx.font = `${5 * SCALE}px 'Courier New', monospace`;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(20,22,28,0.8)";
      const tagW = ctx.measureText(seat.tag).width + 4 * SCALE;
      ctx.fillRect(seat.cx * t - tagW / 2, (deskY + 1) * t - SCALE, tagW, 7 * SCALE);
      ctx.fillStyle = seat.shirt;
      ctx.fillText(seat.tag, seat.cx * t, (deskY + 1) * t + 4 * SCALE);
    }
  }

  function drawWallTile(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
    const t = TILE * SCALE;
    const n = tileNoise(tx + 7, ty + 3);
    ctx.fillStyle = n > 0.5 ? "#8a8a8a" : "#808080";
    ctx.fillRect(tx * t, ty * t, t, t);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(tx * t, ty * t + t - SCALE, t, SCALE);
    ctx.fillRect(tx * t + ((tx + ty) % 2 === 0 ? t / 2 : t / 4), ty * t, SCALE, t);
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
    const tileX = Math.floor((e.clientX - rect.left) / (TILE * SCALE));
    const tileY = Math.floor((e.clientY - rect.top) / (TILE * SCALE));
    const room = roomAt(layoutRef.current, tileX, tileY);
    onSelect(room ? room.id : null);
  };

  return (
    <div className="office-scroll">
      <canvas ref={canvasRef} className="office-canvas" onClick={handleClick} />
    </div>
  );
}
