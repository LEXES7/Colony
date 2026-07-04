import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { computeLayout, doorPath, type PathPoint } from "./../office/layout";
import { animateScene, buildOfficeScene, type OfficeScene } from "./../office3d/scene";
import { useHub, type ActivityItem } from "./../store";

const MESSENGER_SPEED = 7; // tiles per second

interface Messenger {
  path: PathPoint[];
  progress: number;
  total: number;
  mesh: THREE.Group;
}

interface Office3DProps {
  onSelect: (name: string | null) => void;
  selected: string | null;
}

export default function Office3D({ onSelect }: Office3DProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    holder.appendChild(renderer.domElement);

    const scene3 = new THREE.Scene();
    scene3.background = new THREE.Color(0x1a2c1a);
    scene3.fog = new THREE.Fog(0x1a2c1a, 60, 140);

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.minDistance = 6;
    controls.maxDistance = 90;

    // lights
    scene3.add(new THREE.AmbientLight(0xbfd4ff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene3.add(sun);
    const fill = new THREE.HemisphereLight(0xa8c8ff, 0x3a5c33, 0.5);
    scene3.add(fill);

    let office: OfficeScene | null = null;
    let signature = "";
    let messengers: Messenger[] = [];
    let seenActivity = 0;

    const envelopeMesh = (kind: "question" | "answer") => {
      const g = new THREE.Group();
      const paper = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.34, 0.07),
        new THREE.MeshStandardMaterial({
          color: kind === "question" ? 0xf2e6c9 : 0xd7f2d7,
          emissive: kind === "question" ? 0x554411 : 0x1a5533,
          emissiveIntensity: 0.5,
        })
      );
      paper.castShadow = true;
      g.add(paper);
      return g;
    };

    const rebuild = () => {
      const s = useHub.getState();
      const layout = computeLayout(
        s.projects.map((p) => p.name),
        s.teams.map((t) => ({ id: t.id, seats: Math.max(1, t.members.length) }))
      );
      const sig = JSON.stringify([
        s.projects.map((p) => p.name),
        s.teams.map((t) => [t.id, t.members.map((m) => m.name + m.role)]),
      ]);
      if (sig === signature && office) return;
      signature = sig;
      if (office) {
        scene3.remove(office.root);
        office.root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
        });
      }
      office = buildOfficeScene({
        layout,
        projects: s.projects.map((p) => ({ name: p.name, enabled: p.enabled })),
        teams: s.teams.map((t) => ({ id: t.id, name: t.name, members: t.members })),
      });
      scene3.add(office.root);

      sun.position.set(office.center.x - 18, 30, office.center.z + 24);
      sun.target.position.copy(office.center);
      scene3.add(sun.target);
      const span = office.size;
      sun.shadow.camera.left = -span;
      sun.shadow.camera.right = span;
      sun.shadow.camera.top = span;
      sun.shadow.camera.bottom = -span;
      sun.shadow.camera.far = 120;
      sun.shadow.camera.updateProjectionMatrix();

      controls.target.copy(office.center);
      if (camera.position.lengthSq() < 1) {
        camera.position.set(office.center.x, office.size * 0.85, office.center.z + office.size * 0.95);
      }
    };

    const spawnMessenger = (item: ActivityItem) => {
      if (!office || (item.kind !== "question" && item.kind !== "answer")) return;
      const roomIdOf = (agentId: string) => {
        const at = agentId.indexOf("@");
        return at === -1 ? agentId : agentId.slice(at + 1);
      };
      const from = office.rooms.get(roomIdOf(item.from))?.room;
      const to = office.rooms.get(roomIdOf(item.to))?.room;
      if (!from || !to || from === to) return;
      const path = doorPath(from, to);
      let total = 0;
      for (let i = 1; i < path.length; i++) {
        total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
      }
      const mesh = envelopeMesh(item.kind);
      scene3.add(mesh);
      messengers.push({ path, progress: 0, total, mesh });
    };

    const syncStore = () => {
      rebuild();
      const s = useHub.getState();
      for (let i = seenActivity; i < s.activity.length; i++) spawnMessenger(s.activity[i]!);
      seenActivity = s.activity.length;
    };
    syncStore();
    const unsubscribe = useHub.subscribe(syncStore);

    // click select via raycast on room hit boxes
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = 0;
    const onDown = () => {
      downAt = performance.now();
    };
    const onUp = (e: MouseEvent) => {
      if (performance.now() - downAt > 250) return; // it was a drag
      if (!office) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(
        [...office.rooms.values()].map((r) => r.hitBox),
        false
      );
      onSelectRef.current(hits.length > 0 ? (hits[0]!.object.userData.roomId as string) : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = holder.clientWidth;
      const h = holder.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(holder);

    let raf = 0;
    let last = performance.now();
    const pointAlong = (path: PathPoint[], dist: number): PathPoint => {
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
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const s = useHub.getState();
      if (office) {
        const projectEnabled = new Map(s.projects.map((p) => [p.name, p.enabled]));
        animateScene(office, now, s.statuses, (roomId) => {
          if (roomId === "main") return true;
          if (projectEnabled.has(roomId)) return projectEnabled.get(roomId)!;
          return true; // team rooms always lit
        });
      }
      messengers = messengers.filter((m) => {
        m.progress += dt * MESSENGER_SPEED;
        if (m.progress >= m.total) {
          scene3.remove(m.mesh);
          return false;
        }
        const p = pointAlong(m.path, m.progress);
        m.mesh.position.set(p.x, 1.4 + Math.sin(now / 110) * 0.12, p.y);
        m.mesh.rotation.y = now / 400;
        return true;
      });
      controls.update();
      renderer.render(scene3, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.dispose();
      holder.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={holderRef} className="office3d" title="drag to orbit · scroll to zoom · click a room" />;
}
