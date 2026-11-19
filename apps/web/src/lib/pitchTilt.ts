/**
 * Per-pitch-type Tilt + Spin Efficiency for the arsenal tables (app + PDF).
 *
 * TrackMan reports its own Tilt ("1:15") per pitch — in the CSV's Tilt column
 * and the session-report PDF's pitch table — so we average those clock
 * readings (circularly, so 11:45 + 12:15 → 12:00). Only when no pitch carries
 * a tilt do we fall back to deriving one from Spin Axis.
 */

type TiltPitch = { tilt?: string | null; spinAxis?: number | null; spinEfficiency?: number | null };

const clockMinutes = (t: string): number | null => {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10) % 12, mm = parseInt(m[2], 10);
  return mm > 59 ? null : h * 60 + mm;
};

export function avgTilt(pts: TiltPitch[]): string {
  const mins = pts.map(p => (p.tilt ? clockMinutes(String(p.tilt)) : null)).filter((v): v is number => v != null);
  if (mins.length) {
    let sx = 0, sy = 0;
    for (const m of mins) { const a = (m / 720) * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); }
    let mean = (Math.atan2(sy, sx) / (2 * Math.PI)) * 720;
    if (mean < 0) mean += 720;
    const r = Math.round(mean / 15) * 15 % 720;   // TrackMan reports in 15-min steps
    const h = Math.floor(r / 60) || 12;
    return `${h}:${String(r % 60).padStart(2, '0')}`;
  }
  const axes = pts.map(p => p.spinAxis).filter((v): v is number => typeof v === 'number');
  if (!axes.length) return '--';
  const avgAxis = axes.reduce((a, b) => a + b, 0) / axes.length;
  const hour = Math.floor(avgAxis / 30) || 12;
  const minute = Math.round((avgAxis % 30) / 30 * 60);
  return `${hour}:${minute.toString().padStart(2, '0')}`;
}

/** Mean of the reported per-pitch spin efficiency (%), or null when none. */
export function avgSpinEfficiency(pts: TiltPitch[]): number | null {
  const v = pts.map(p => p.spinEfficiency).filter((x): x is number => typeof x === 'number' && isFinite(x));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}
