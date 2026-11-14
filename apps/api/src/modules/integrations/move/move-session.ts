/* ─────────────────────────────────────────────────────────────────────────
   MOVE Catching Sensor -- reading one "move.session.v1" delivery.

   Pure functions (no database) so they can be unit-tested. A session is one
   catcher's set of catches; each catch carries MOVE's own metric keys
   (gloveSpeedMph, timeToStickSec, ...) plus links to a video and a raw CSV
   that expire after about a week.

   Metrics are kept under MOVE's OWN keys. Which of our report metrics each
   one feeds is decided on the web (lib/move-metrics.ts), so a mapping fix
   never needs saved data rewritten.
   ───────────────────────────────────────────────────────────────────────── */

export interface MoveFile {
  url: string;
  contentType: string | null;
  bytes: number | null;
  expiresAt: string | null;
}

export interface MoveCatch {
  catchId: string;
  number: number | null;
  /** Taken back by the athlete in MOVE -- kept, but left out of best / average. */
  withdrawn: boolean;
  reach: boolean;
  contactAt: string | null;
  metrics: Record<string, number>;
  video: MoveFile | null;
  raw: MoveFile | null;
  /** The catch's 3D glove path (JSON), copied into MovePath on arrival. */
  path3d: MoveFile | null;
}

export interface MoveSession {
  schema: string;
  sessionId: string;
  /** Same for every revision of one session; a higher revision replaces a lower one. */
  baseSessionId: string;
  revision: number;
  /** The athlete as MOVE knows them: their email, or an ID we gave them. */
  externalId: string | null;
  /** MOVE's own user id. */
  moveId: string | null;
  /** MOVE's session name -- the athlete's device-local start time, "YYYYMMDD_HHMMSS". */
  moveSessionId: string | null;
  firstCatchAt: string;
  lastCatchAt: string | null;
  catchCount: number;
  catches: MoveCatch[];
}

const MAX_CATCHES = 500;
const MAX_METRICS = 60;

const str = (v: unknown, max = 300): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const isoOrNull = (v: unknown): string | null => {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

function file(v: unknown): MoveFile | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Record<string, unknown>;
  const url = str(f.url, 2000);
  if (!url || !/^https:\/\//i.test(url)) return null;
  return {
    url,
    contentType: str(f.contentType, 100),
    bytes: num(f.bytes),
    expiresAt: isoOrNull(f.expiresAt),
  };
}

function metrics(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_METRICS) break;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(k)) continue;
    const n = num(val);
    if (n != null) out[k] = n;
  }
  return out;
}

/** Read a MOVE session body. Throws an Error whose message says what's wrong. */
export function parseMoveSession(body: unknown): MoveSession {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Not a JSON object');
  const b = body as Record<string, any>;
  const schema = str(b.schema, 60) ?? '';
  if (!schema.startsWith('move.session.')) throw new Error(`Unknown schema "${schema || '(none)'}"`);
  const sessionId = str(b.sessionId, 200);
  if (!sessionId) throw new Error('Missing sessionId');

  const externalId = str(b.player?.externalId, 200);
  const moveId = str(b.player?.moveId, 200);
  if (!externalId && !moveId) throw new Error('Missing player.externalId');

  if (!Array.isArray(b.catches)) throw new Error('Missing catches list');
  const catches: MoveCatch[] = b.catches.slice(0, MAX_CATCHES).map((c: any, i: number) => ({
    catchId: str(c?.catchId, 200) ?? `${sessionId}#${i + 1}`,
    number: num(c?.number),
    withdrawn: c?.withdrawn === true,
    reach: c?.reach === true,
    contactAt: isoOrNull(c?.contactAt),
    metrics: metrics(c?.metrics),
    video: file(c?.files?.video),
    raw: file(c?.files?.raw),
    path3d: file(c?.files?.path3d),
  }));

  const contactTimes = catches.map((c) => c.contactAt).filter((t): t is string => !!t).sort();
  const firstCatchAt = isoOrNull(b.session?.firstCatchAt) ?? contactTimes[0] ?? null;
  if (!firstCatchAt) throw new Error('No session time (session.firstCatchAt)');

  const revision = num(b.revision);
  return {
    schema,
    sessionId,
    baseSessionId: str(b.baseSessionId, 200) ?? sessionId,
    revision: revision != null && revision >= 0 ? Math.trunc(revision) : 1,
    externalId,
    moveId,
    moveSessionId: str(b.session?.moveSessionId, 40),
    firstCatchAt,
    lastCatchAt: isoOrNull(b.session?.lastCatchAt) ?? contactTimes[contactTimes.length - 1] ?? null,
    catchCount: catches.length,
    catches,
  };
}

/**
 * Where the session happened, in the athlete's local time. MOVE names a
 * session after the device-local start time ("20261113_204311"); compared
 * with the UTC firstCatchAt that gives both the local date and the UTC
 * offset. Without it, the academy time zone (or UTC) decides the date.
 */
export function sessionLocalDay(s: Pick<MoveSession, 'moveSessionId' | 'firstCatchAt'>, fallbackTz?: string):
  { date: string; offsetMinutes: number | null; tz: string | null } {
  const m = s.moveSessionId?.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (m) {
    const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const offset = Math.round((asUtc - Date.parse(s.firstCatchAt)) / 60_000);
    if (Math.abs(offset) <= 14 * 60) {
      return { date: `${m[1]}-${m[2]}-${m[3]}`, offsetMinutes: offset, tz: null };
    }
  }
  const tz = fallbackTz || 'UTC';
  return { date: localDate(new Date(s.firstCatchAt), { offsetMinutes: null, tz }), offsetMinutes: null, tz };
}

/** "YYYY-MM-DD" of an instant at a fixed UTC offset, or in a time zone. */
export function localDate(at: Date, zone: { offsetMinutes: number | null; tz: string | null }): string {
  if (zone.offsetMinutes != null) {
    return new Date(at.getTime() + zone.offsetMinutes * 60_000).toISOString().slice(0, 10);
  }
  try {
    /* en-CA formats as YYYY-MM-DD. */
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone.tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** What's stored on a Catching report under content.moveReceiving. */
export interface MoveReceivingContent {
  version: 1;
  sessions: (Omit<MoveSession, 'schema' | 'externalId' | 'moveId'> & { deliveryId: string })[];
}

/**
 * Put a session into a report's MOVE block. Replaces an earlier revision of
 * the same session; refuses (returns null) when the report already holds a
 * NEWER revision of it.
 */
export function mergeMoveSession(existing: unknown, s: MoveSession, deliveryId: string): MoveReceivingContent | null {
  const prev: MoveReceivingContent['sessions'] =
    existing && typeof existing === 'object' && Array.isArray((existing as any).sessions)
      ? (existing as any).sessions
      : [];
  const same = prev.find((p) => p?.baseSessionId === s.baseSessionId);
  if (same && typeof same.revision === 'number' && same.revision > s.revision) return null;
  const { schema: _s, externalId: _e, moveId: _m, ...keep } = s;
  const sessions = [...prev.filter((p) => p?.baseSessionId !== s.baseSessionId), { ...keep, deliveryId }]
    .sort((a, b) => String(a.firstCatchAt).localeCompare(String(b.firstCatchAt)));
  return { version: 1, sessions };
}

/* ── 3D glove paths (files.path3d) ──────────────────────────────────── */

/** MOVE serves its files from its own Cloud Functions host; nothing else is
 *  ever fetched (the URL comes from a partner payload). */
export function isMoveFileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^[a-z0-9-]+-move-catching-sensor\.cloudfunctions\.net$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** A glove path as stored: positions in metres, y = up (checked against
 *  MOVE's own approach / catch-to-stick angles), t in seconds; `ta`,
 *  `contact`, `stick` are sample indexes (approach start, ball in glove,
 *  end of the stick). */
export interface MovePathData {
  v: number;
  t: number[];
  p: [number, number, number][];
  q: [number, number, number, number][] | null;
  ta: number;
  contact: number;
  stick: number;
}

const MAX_PATH_SAMPLES = 5000;
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Check + trim a path3d file. Throws when it isn't a usable path. */
export function parseMovePath(raw: unknown): MovePathData {
  if (!raw || typeof raw !== 'object') throw new Error('Path file is not an object');
  const r = raw as Record<string, any>;
  const t = Array.isArray(r.t) ? r.t : null;
  const p = Array.isArray(r.p) ? r.p : null;
  if (!t || !p || t.length < 2 || t.length !== p.length) throw new Error('Path file needs matching t and p lists');
  if (p.length > MAX_PATH_SAMPLES) throw new Error('Path file is too long');
  const pts = p.map((v: unknown) => {
    if (!Array.isArray(v) || v.length < 3 || !v.slice(0, 3).every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 100)) {
      throw new Error('Path point is not [x, y, z]');
    }
    return [round(v[0], 4), round(v[1], 4), round(v[2], 4)] as [number, number, number];
  });
  const times = t.map((n: unknown) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Path time is not a number');
    return round(n, 4);
  });
  const q = Array.isArray(r.q) && r.q.length === p.length && r.q.every((v: unknown) => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n)))
    ? (r.q as number[][]).map((v) => v.map((n) => round(n, 4)) as [number, number, number, number])
    : null;
  const idx = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < pts.length ? v : fallback;
  const stick = idx(r.stick, pts.length - 1);
  const contact = Math.min(idx(r.contact, stick), stick);
  const ta = Math.min(idx(r.ta, 0), contact);
  return { v: typeof r.v === 'number' ? r.v : 0, t: times, p: pts, q, ta, contact, stick };
}
