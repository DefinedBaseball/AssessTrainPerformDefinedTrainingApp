'use client';

/* ─────────────────────────────────────────────────────────────────────
   VideoDrawingOverlay — canvas overlay + tool palette that lets a
   coach draw circles, lines, arrows, or freehand strokes on top of
   any playing video. Sized via ResizeObserver to track the video
   element's display dimensions, so the canvas stays aligned through
   window resizes and fullscreen toggles.

   Storage is in-component only (annotations live in React state).
   Wire to a persistence API by lifting the `annotations` state up
   if the host needs the markup saved with a report.

   Toolbar layout (compact, top-left of the video):
     • Tool buttons: Circle, Line, Arrow, Freehand, Erase-all
     • Color swatches: red / yellow / blue (sensible scouting palette)
     • Active tool gets a highlighted border so the coach sees which
       interaction the canvas is in.

   When NO tool is selected (`tool === null`) the canvas has
   `pointer-events: none` so clicks pass through to the video — the
   native controls and the `<EnhancedVideoPlayer>` control bar
   remain interactive.
   ───────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState, type RefObject } from 'react';

type Tool = 'circle' | 'line' | 'arrow' | 'freehand' | null;
type Color = '#ef4444' | '#facc15' | '#7eb6ff';

interface Stroke {
  tool: Exclude<Tool, null>;
  color: Color;
  /** All strokes are stored as a list of {x,y} points in canvas
   *  coordinates. Circle / line / arrow use exactly TWO points
   *  (start, end); freehand uses the full mousemove trail. */
  points: { x: number; y: number }[];
}

interface Props {
  /** Ref to the video the canvas should overlay. Used to read the
   *  current rendered size so the canvas matches pixel-for-pixel. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Optional callback that fires once the canvas element mounts.
   *  Lets the host capture a reference to the drawing canvas so it
   *  can be composited into a screen-recording stream (e.g., the
   *  Record-narration feature in VideoPlayerModal). */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /** Externally-controlled tool. When provided, replaces internal
   *  tool state — the host owns the tool selection (used by the
   *  bundle modal's global drawing toolbar at the bottom so all
   *  panes share a single tool picker). */
  externalTool?: Tool;
  /** Externally-controlled color. Same lift-state-up pattern as
   *  `externalTool`. */
  externalColor?: Color;
  /** When true, the in-overlay tool palette + color swatches do
   *  NOT render. Host is expected to surface its own controls (the
   *  bundle modal does this at the bottom of the modal). */
  hideToolbar?: boolean;
  /** Receives a `clearStrokes` callback once the overlay mounts.
   *  Lets the host trigger Clear from a global "Clear All" button
   *  even when `hideToolbar` is true. */
  onClearReady?: (clearStrokes: () => void) => void;
}

const COLORS: Color[] = ['#ef4444', '#facc15', '#7eb6ff'];

export function VideoDrawingOverlay({
  videoRef,
  onCanvasReady,
  externalTool,
  externalColor,
  hideToolbar,
  onClearReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /* Internal tool/color state is the fallback. When `externalTool`
     / `externalColor` are supplied by the host (the bundle modal's
     bottom toolbar), the externally-controlled values win. */
  const [internalTool, setInternalTool] = useState<Tool>(null);
  const [internalColor, setInternalColor] = useState<Color>('#facc15');
  const tool = externalTool !== undefined ? externalTool : internalTool;
  const color = externalColor !== undefined ? externalColor : internalColor;
  const setTool = setInternalTool; // only used by the in-overlay toolbar path
  const setColor = setInternalColor;
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  /* Surface a clear-strokes handle to the host so a global
     "Clear All" button at the bundle modal level can purge every
     overlay's annotations in one click. Fires once when the
     callback first lands. */
  useEffect(() => {
    if (onClearReady) onClearReady(() => setStrokes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClearReady]);

  /* Notify the host once the canvas mounts so it can grab a ref —
     used by VideoPlayerModal's recording flow to composite the
     drawings into the captured stream. */
  useEffect(() => {
    if (canvasRef.current && onCanvasReady) onCanvasReady(canvasRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef.current]);
  /* The stroke currently being drawn (mouse-down → mouse-up). Stored
     in a ref so mousemove handlers can mutate without re-rendering. */
  const draftRef = useRef<Stroke | null>(null);

  /* Keep the canvas's internal pixel buffer in sync with the video's
     rendered size. Without this, drawings would stretch / squish
     when the video element resizes. */
  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    const sync = () => {
      const rect = v.getBoundingClientRect();
      if (c.width !== rect.width || c.height !== rect.height) {
        c.width = Math.max(1, Math.round(rect.width));
        c.height = Math.max(1, Math.round(rect.height));
        redraw();
      }
    };
    const ro = new ResizeObserver(sync);
    ro.observe(v);
    sync();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef.current]);

  /* Redraw every committed stroke + the in-progress draft. Pulled
     out so the resize handler and the state-change effect can both
     call it without duplicating logic. */
  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const all = draftRef.current ? [...strokes, draftRef.current] : strokes;
    for (const s of all) drawStroke(ctx, s);
  };

  useEffect(() => { redraw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [strokes]);

  /* Mouse interaction on the canvas — start a stroke on mouse-down,
     extend on mousemove, commit on mouseup. */
  const eventPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!tool) return;
    const p = eventPos(e);
    draftRef.current = { tool, color, points: [p, p] };
    redraw();
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!tool || !draftRef.current) return;
    const p = eventPos(e);
    if (tool === 'freehand') {
      draftRef.current.points.push(p);
    } else {
      /* Line / circle / arrow: drag from start; second point is
         always the current pointer position. */
      draftRef.current.points[1] = p;
    }
    redraw();
  };
  const commit = () => {
    if (!draftRef.current) return;
    const s = draftRef.current;
    draftRef.current = null;
    /* Drop trivial near-zero strokes (a single click without a
       drag) so accidental taps don't litter the canvas. */
    const [a, b] = [s.points[0], s.points[s.points.length - 1]];
    const dx = b.x - a.x; const dy = b.y - a.y;
    if (s.tool !== 'freehand' && Math.hypot(dx, dy) < 4) {
      redraw();
      return;
    }
    setStrokes(prev => [...prev, s]);
  };

  return (
    <>
      {/* Canvas overlay — absolutely positioned over the video.
         `pointerEvents` toggles based on whether a tool is active. */}
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={commit}
        onMouseLeave={commit}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: tool ? 'auto' : 'none',
          cursor: tool ? 'crosshair' : 'default',
        }}
      />

      {/* Tool palette — small floating chip row at the top-left of
         the video pane. The host positions this component inside a
         relative-positioned wrapper so absolute positioning is
         scoped to that wrapper. Suppressed when `hideToolbar` is
         true — the host then renders its own toolbar (e.g. the
         bundle modal's global drawing controls at the bottom). */}
      {!hideToolbar && (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 8, left: 8,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '3px 4px',
          borderRadius: 6,
          background: 'rgba(10, 14, 20, 0.85)',
          border: '1px solid var(--border-light)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.40)',
          /* Tool palette stays above the canvas overlay so its own
             clicks aren't captured as drawing strokes. */
          zIndex: 2,
        }}
      >
        <ToolBtn label="Circle"   active={tool === 'circle'}   onClick={() => setTool(tool === 'circle' ? null : 'circle')}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="6" cy="6" r="4.2" />
          </svg>
        </ToolBtn>
        <ToolBtn label="Line"     active={tool === 'line'}     onClick={() => setTool(tool === 'line' ? null : 'line')}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="2" y1="10" x2="10" y2="2" />
          </svg>
        </ToolBtn>
        <ToolBtn label="Arrow"    active={tool === 'arrow'}    onClick={() => setTool(tool === 'arrow' ? null : 'arrow')}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <line x1="2" y1="10" x2="9" y2="3" />
            <polyline points="5,2 9,2 9,6" />
          </svg>
        </ToolBtn>
        <ToolBtn label="Freehand" active={tool === 'freehand'} onClick={() => setTool(tool === 'freehand' ? null : 'freehand')}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 9 Q4 5 6 6 T10 3" />
          </svg>
        </ToolBtn>
        {/* Vertical separator before color swatches */}
        <span style={{ width: 1, height: 12, background: 'var(--border-light)', alignSelf: 'center', margin: '0 2px' }} />
        {COLORS.map(c => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
            style={{
              width: 14, height: 14,
              padding: 0,
              borderRadius: '50%',
              background: c,
              border: '1.5px solid ' + (color === c ? '#fff' : 'rgba(255,255,255,0.30)'),
              cursor: 'pointer',
              boxShadow: color === c ? '0 0 6px rgba(255,255,255,0.5)' : 'none',
            }}
          />
        ))}
        {strokes.length > 0 && (
          <button
            type="button"
            onClick={() => setStrokes([])}
            title="Clear all annotations"
            style={{
              marginLeft: 2,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(239, 68, 68, 0.14)',
              border: '1px solid rgba(239, 68, 68, 0.40)',
              color: '#fca5a5',
              fontFamily: 'var(--font-mono)',
              fontSize: 8.5, fontWeight: 700, letterSpacing: '0.10em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>
      )}
    </>
  );
}

/** Tool-palette icon button. Sized to match the speed bar's compact
 *  18×18 / 20×18 icon buttons so the two strips read as paired
 *  controls. */
function ToolBtn({
  label, active, onClick, children,
}: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18, height: 18,
        padding: 0,
        borderRadius: 3,
        background: active ? 'rgba(126,182,255,0.20)' : 'rgba(255,255,255,0.04)',
        border: '1px solid ' + (active ? 'rgba(126,182,255,0.55)' : 'rgba(255,255,255,0.10)'),
        color: active ? 'var(--text-bright)' : 'var(--text-muted)',
        cursor: 'pointer',
        transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
      }}
    >
      {children}
    </button>
  );
}

/** Draw a single stroke onto the canvas context. Switches on
 *  `stroke.tool` to render circle / line / arrow / freehand with
 *  consistent stroke width and rounded line caps. */
function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pts = s.points;
  if (pts.length < 2) return;
  const [a, b] = [pts[0], pts[pts.length - 1]];

  if (s.tool === 'circle') {
    /* Treat a→b as a bounding-box diagonal so the circle inscribes
       the rect the coach dragged. */
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  if (s.tool === 'line' || s.tool === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (s.tool === 'arrow') {
      /* Arrowhead: short triangle at the endpoint, oriented along
         the line's vector. */
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const headLen = 10;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
    return;
  }

  if (s.tool === 'freehand') {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}
