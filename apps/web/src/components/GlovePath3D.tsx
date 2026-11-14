'use client';

/* ─────────────────────────────────────────────────────────────────────────
   GlovePath3D -- one MOVE catch's glove path, drawn in 3D.

   MOVE sends each catch's path as positions in metres (y = up; checked
   against MOVE's own approach / catch-to-stick angles) with three markers:
   approach start (ta), ball in the glove (contact) and the end of the stick.
   Drawn as an SVG with a simple orthographic camera -- drag to rotate,
   Catcher / Side / Top presets, and Play replays the catch at 1/4 speed.
   No 3D library: a few hundred points don't need one.

   World axes as MOVE sends them: x = toward the pitcher (small), y = up,
   z = across the zone. Which way across is glove side isn't confirmed yet.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';

type Vec3 = [number, number, number];

const APPROACH = '#38bdf8';
const STICK = '#f97316';
const W = 320;
const H = 300;
const PAD = 26;

const PRESETS: { key: string; label: string; yaw: number; pitch: number }[] = [
  { key: 'catcher', label: 'Catcher', yaw: 0, pitch: 0 },
  { key: 'side', label: 'Side', yaw: Math.PI / 2, pitch: 0 },
  { key: 'top', label: 'Top', yaw: 0, pitch: Math.PI / 2 },
];

/* Paths are cached for the page's life: opening another catch and coming
   back shouldn't refetch. */
const cache = new Map<string, Promise<api.MovePathData>>();
function loadPath(catchId: string) {
  let p = cache.get(catchId);
  if (!p) {
    p = api.getMovePath(catchId);
    p.catch(() => cache.delete(catchId));
    cache.set(catchId, p);
  }
  return p;
}

export function GlovePath3D({ catchId, label }: { catchId: string; label: string }) {
  const [path, setPath] = useState<api.MovePathData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  /** Replay position (seconds); null = show the whole catch. */
  const [playT, setPlayT] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    setPath(null);
    setError(null);
    setPlayT(null);
    loadPath(catchId)
      .then((p) => { if (live) setPath(p); })
      .catch((e: any) => {
        if (!live) return;
        setError(/404|No 3D path/i.test(String(e?.message)) ? 'The 3D path for this catch is still being saved -- check back in a minute.' : (e?.message || 'Could not load the 3D path'));
      });
    return () => { live = false; };
  }, [catchId]);

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  /* The part worth drawing: everything up to the end of the stick. */
  const pts = useMemo<Vec3[]>(() => (path ? path.p.slice(0, path.stick + 1) : []), [path]);

  /* Fit by a bounding sphere so the scale stays put while rotating. */
  const fit = useMemo(() => {
    if (!pts.length) return { c: [0, 0, 0] as Vec3, scale: 1 };
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const r = Math.max(0.05, ...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    return { c, scale: (Math.min(W, H) / 2 - PAD) / r };
  }, [pts]);

  const project = (p: Vec3): [number, number] => {
    const x = p[0] - fit.c[0], y = p[1] - fit.c[1], z = p[2] - fit.c[2];
    const h = z * Math.cos(yaw) + x * Math.sin(yaw);
    const d = x * Math.cos(yaw) - z * Math.sin(yaw);
    const v = y * Math.cos(pitch) - d * Math.sin(pitch);
    return [W / 2 + h * fit.scale, H / 2 - v * fit.scale];
  };

  if (error) return <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '24px 8px' }}>{error}</div>;
  if (!path) return <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '24px 8px' }}>Loading 3D path…</div>;

  /* How far to draw: the whole catch, or up to the replay time. */
  let last = pts.length - 1;
  if (playT != null) {
    last = 0;
    while (last + 1 < pts.length && path.t[last + 1] <= playT) last++;
  }
  const xy = pts.map(project);
  const poly = (from: number, to: number) =>
    xy.slice(Math.max(0, from), Math.min(to, last) + 1).map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const { ta, contact, stick } = path;
  const marker = (i: number) => (i <= last ? xy[i] : null);
  const up = project([fit.c[0], fit.c[1] + 0.12, fit.c[2]]);
  const base = project(fit.c as Vec3);
  const gizmo = { dx: up[0] - base[0], dy: up[1] - base[1] };

  const play = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const start = Math.max(0, path.t[ta] - 0.15);
    const end = path.t[stick];
    const speed = 0.25;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = start + ((now - t0) / 1000) * speed;
      if (t >= end) { setPlayT(null); raf.current = null; return; }
      setPlayT(t);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw, pitch };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setYaw(d.yaw + (e.clientX - d.x) * 0.012);
    setPitch(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d.pitch + (e.clientY - d.y) * 0.012)));
  };
  const onUp = () => { drag.current = null; };

  const chip = (on: boolean): React.CSSProperties => ({
    padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: '1px solid var(--border)', background: on ? 'var(--text-bright)' : 'transparent',
    color: on ? 'var(--bg, #fff)' : 'var(--text-muted)',
  });
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: 3D glove path, drag to rotate`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ width: '100%', height: 'auto', maxHeight: '20rem', touchAction: 'none', cursor: 'grab', borderRadius: 10, background: 'rgba(127,127,127,0.08)', color: 'var(--text-muted)' }}
      >
        {/* Up arrow, bottom-left, so the rotation always reads. */}
        <g transform={`translate(24 ${H - 24})`} opacity="0.7">
          <line x1="0" y1="0" x2={gizmo.dx * 0.6} y2={gizmo.dy * 0.6} stroke="currentColor" strokeWidth="1.5" />
          <text x={gizmo.dx * 0.6 + 3} y={gizmo.dy * 0.6 - 3} fontSize="9" fill="currentColor">UP</text>
        </g>
        {/* Before the approach: the glove's setup, faint. */}
        <polyline points={poly(0, ta)} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 3" />
        <polyline points={poly(ta, contact)} fill="none" stroke={APPROACH} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={poly(contact, stick)} fill="none" stroke={STICK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {marker(ta) && <circle cx={marker(ta)![0]} cy={marker(ta)![1]} r="4" fill="none" stroke={APPROACH} strokeWidth="2" />}
        {marker(contact) && <circle cx={marker(contact)![0]} cy={marker(contact)![1]} r="6.5" fill="#fff" stroke="#e11d48" strokeWidth="2" />}
        {marker(stick) && <rect x={marker(stick)![0] - 4.5} y={marker(stick)![1] - 4.5} width="9" height="9" fill={STICK} transform={`rotate(45 ${marker(stick)![0]} ${marker(stick)![1]})`} />}
        {/* The glove while replaying. */}
        {playT != null && <circle cx={xy[last][0]} cy={xy[last][1]} r="7" fill="currentColor" fillOpacity="0.85" />}
      </svg>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <button key={p.key} type="button" style={chip(near(yaw, p.yaw) && near(pitch, p.pitch))} onClick={() => { setYaw(p.yaw); setPitch(p.pitch); }}>
            {p.label}
          </button>
        ))}
        <button type="button" style={chip(playT != null)} onClick={play} aria-label="Replay the catch at quarter speed">
          {playT != null ? 'Playing…' : '▶ Play ¼×'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', fontSize: 10.5, color: 'var(--text-muted)' }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 3, background: APPROACH, verticalAlign: 'middle', marginRight: 4 }} />Approach</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#fff', border: '2px solid #e11d48', verticalAlign: 'middle', marginRight: 4 }} />Catch</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 3, background: STICK, verticalAlign: 'middle', marginRight: 4 }} />Stick</span>
      </div>
    </div>
  );
}
