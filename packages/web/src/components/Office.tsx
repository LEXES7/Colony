import { useEffect, useRef } from "react";
import type { ProjectPublic } from "@colony/shared";
import { useHub, type ActivityItem } from "./../store";
import { computeLayout, doorPath, roomAt, TILE, type OfficeLayout, type PathPoint, type Room } from "./../office/layout";
import {
  BOSS,
  BOSS_PALETTE,
  drawSprite,
  ENVELOPE,
  ENVELOPE_PALETTE_A,
  ENVELOPE_PALETTE_Q,
  shirtColor,
  tileNoise,
  WORKER,
  WORKER_TYPING,
  workerPalette,
} from "./../office/sprites";

const SCALE = 2; // screen px per logical px
const PX = 2; // logical px per sprite pixel
const MESSENGER_SPEED = 6; // tiles per second

interface Messenger {
  path: PathPoint[];
  progress: number; // distance travelled in tiles
  total: number;
  kind: "question" | "answer";
}

interface OfficeProps {
  onSelect: (name: string | null) => void;
  selected: string | null;
}

export default function Office({ onSelect, selected }: OfficeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectsRef = useRef<ProjectPublic[]>(useHub.getState().projects);
  const statusesRef = useRef<Record<string, string>>(useHub.getState().statuses);
  const selectedRef = useRef<string | null>(selected);
  const layoutRef = useRef<OfficeLayout>(computeLayout([]));
  const messengersRef = useRef<Messenger[]>([]);
  const seenActivityRef = useRef(0);

  selectedRef.current = selected;

  // Mirror store state into refs; the rAF loop reads refs, never re-renders.
  useEffect(() => {
    const sync = () => {
      const s = useHub.getState();
      projectsRef.current = s.projects;
      statusesRef.current = s.statuses;
      layoutRef.current = computeLayout(s.projects.map((p) => p.name));

      // enqueue messengers for new agent.message activity
      const activity = s.activity;
      for (let i = seenActivityRef.current; i < activity.length; i++) {
        const item = activity[i]!;
        spawnMessenger(item);
      }
      seenActivityRef.current = activity.length;
    };
    sync();
    return useHub.subscribe(sync);
  }, []);

  function spawnMessenger(item: ActivityItem) {
    if (item.kind !== "question" && item.kind !== "answer") return;
    const layout = layoutRef.current;
    const rooms = new Map<string, Room>([["main", layout.main], ...layout.depts.map((d) => [d.id, d] as const)]);
    const from = rooms.get(item.from);
    const to = rooms.get(item.to);
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
    // grass background
    for (let y = 0; y < layout.rows; y++) {
      for (let x = 0; x < layout.cols; x++) {
        const n = tileNoise(x, y);
        ctx.fillStyle = n > 0.85 ? "#3f7d3b" : n > 0.5 ? "#468a41" : "#4c9346";
        ctx.fillRect(x * t, y * t, t, t);
      }
    }
    // corridors (gravel path) — between main and depts and between dept rows
    const corridorRows: number[] = [];
    corridorRows.push(layout.main.y + layout.main.h, layout.main.y + layout.main.h + 1);
    for (const d of layout.depts) {
      corridorRows.push(d.y - 1, d.y - 2);
    }
    for (const y of [...new Set(corridorRows)]) {
      for (let x = 0; x < layout.cols; x++) {
        const n = tileNoise(x + 99, y);
        ctx.fillStyle = n > 0.6 ? "#9b9b93" : "#8b8b84";
        ctx.fillRect(x * t, y * t, t, t);
      }
    }

    const projects = new Map(projectsRef.current.map((p) => [p.name, p]));
    drawRoom(ctx, layout.main, now, {
      title: "MAIN AGENT",
      enabled: true,
      busy: statusesRef.current["main"] === "busy",
      isBoss: true,
      selected: selectedRef.current === "main",
    });
    for (const room of layout.depts) {
      const p = projects.get(room.id);
      drawRoom(ctx, room, now, {
        title: room.id.toUpperCase(),
        enabled: p?.enabled ?? false,
        busy: (statusesRef.current[room.id] ?? p?.status) === "busy",
        isBoss: false,
        selected: selectedRef.current === room.id,
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
    enabled: boolean;
    busy: boolean;
    isBoss: boolean;
    selected: boolean;
  }

  function drawRoom(ctx: CanvasRenderingContext2D, room: Room, now: number, style: RoomStyle) {
    const t = TILE * SCALE;
    const { x, y, w, h } = room;

    // floor
    for (let ty = y + 1; ty < y + h - 1; ty++) {
      for (let tx = x + 1; tx < x + w - 1; tx++) {
        const n = tileNoise(tx, ty);
        ctx.fillStyle = style.enabled
          ? n > 0.66
            ? "#b8905a"
            : n > 0.33
              ? "#ad8752"
              : "#b28c56"
          : n > 0.5
            ? "#6d5a3f"
            : "#665438";
        ctx.fillRect(tx * t, ty * t, t, t);
        // plank seams
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(tx * t, ty * t + t - SCALE, t, SCALE);
      }
    }
    // walls
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
    // door gap: dark opening
    ctx.fillStyle = "#3a2d1e";
    ctx.fillRect(room.doorX * t, room.doorY * t, t, t);

    // worker / boss (drawn first so the desk overlaps their lower body)
    const deskX = x + Math.floor(w / 2) - 1.5;
    const deskY = y + Math.floor(h / 2);
    if (style.enabled) {
      const px = PX * SCALE;
      const spriteW = 8 * px;
      const wx = deskX * t + 1.5 * t - spriteW / 2;
      const bob = style.busy ? Math.round(Math.sin(now / 120)) * SCALE : 0;
      const wy = deskY * t - 9 * px + bob + t * 0.3;
      if (style.isBoss) {
        drawSprite(ctx, BOSS, BOSS_PALETTE, wx, wy - px, px);
      } else {
        const grid = style.busy && Math.sin(now / 120) > 0 ? WORKER_TYPING : WORKER;
        drawSprite(ctx, grid, workerPalette(shirtColor(room.id)), wx, wy, px);
      }
      // busy particles
      if (style.busy) {
        for (let i = 0; i < 3; i++) {
          const phase = (now / 700 + i / 3) % 1;
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

    // desk (3 tiles wide) centered, in front of the worker
    ctx.fillStyle = style.enabled ? "#7d5a33" : "#55432c";
    ctx.fillRect(deskX * t, deskY * t, 3 * t, Math.floor(t * 0.75));
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(deskX * t, deskY * t + Math.floor(t * 0.75) - SCALE * 2, 3 * t, SCALE * 2);

    // monitor on desk
    const monX = deskX * t + t * 1.1;
    const monY = deskY * t - t * 0.15;
    ctx.fillStyle = "#222";
    ctx.fillRect(monX, monY, t * 0.8, t * 0.55);
    ctx.fillStyle = style.busy
      ? `rgba(80,220,255,${0.7 + 0.3 * Math.sin(now / 150)})`
      : style.enabled
        ? "#31506e"
        : "#111";
    ctx.fillRect(monX + SCALE, monY + SCALE, t * 0.8 - SCALE * 2, t * 0.55 - SCALE * 2);

    if (!style.enabled) {
      // dark overlay: lights off
      ctx.fillStyle = "rgba(10,10,20,0.45)";
      ctx.fillRect((x + 1) * t, (y + 1) * t, (w - 2) * t, (h - 2) * t);
    }

    // status lamp above door
    ctx.fillStyle = style.busy ? "#e8a33d" : style.enabled ? "#4cc38a" : "#555";
    ctx.fillRect(room.doorX * t + t / 2 - SCALE * 2, room.doorY * t - SCALE * 3, SCALE * 4, SCALE * 3);

    // name banner
    ctx.font = `${7 * SCALE}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    const label = style.title.length > 16 ? style.title.slice(0, 15) + "…" : style.title;
    const bw = ctx.measureText(label).width + 8 * SCALE;
    const bx = (x + w / 2) * t;
    ctx.fillStyle = style.selected ? "#e8a33d" : "rgba(20,22,28,0.85)";
    ctx.fillRect(bx - bw / 2, y * t - 6 * SCALE, bw, 9 * SCALE);
    ctx.fillStyle = style.selected ? "#14161c" : "#e6d9b8";
    ctx.fillText(label, bx, y * t + SCALE);
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
