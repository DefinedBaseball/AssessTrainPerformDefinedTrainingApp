/**
 * API Unit Tests
 *
 * Pure-function tests that don't need a running server or database.
 * Same custom runner pattern as api.test.ts.
 *
 * Run: npm run test:unit
 */

import { signJwt, verifyJwt } from '../src/modules/auth/jwt.util';
import { assertPlayerOwnership, AuthenticatedRequest } from '../src/modules/auth/jwt.guard';
import { detectParser, getParserBySource, getRegisteredSources } from '../src/modules/uploads/parsers/parser-registry';
import { BlastMotionParser } from '../src/modules/uploads/parsers/blast-motion-parser';
import { TrackmanParser } from '../src/modules/uploads/parsers/trackman-parser';
import { HitTraxParser } from '../src/modules/uploads/parsers/hittrax-parser';
import { HitTraxPoiParser } from '../src/modules/uploads/parsers/hittrax-poi-parser';
import { SendLimiter } from '../src/modules/auth/send-limiter';
import { parseMoveSession, sessionLocalDay, localDate, mergeMoveSession, isMoveFileUrl, parseMovePath } from '../src/modules/integrations/move/move-session';
import { isMoveOnly, pickReportForDay } from '../src/modules/integrations/move/move.processor';
import { parseMeasureId, cleanDataRequest, cleanStudy } from '../src/modules/studies/study-measures';
import { aggregateDaily } from '../src/modules/analytics/analytics.service';
import { tmPitchValue, cleanDataSet } from '../src/modules/analytics/player-data';
import { aggregateForceDecks, aggregateDynamo, aggregateSmartSpeed, dynamoTestCode, dynamoTestLabel, smartSpeedTestCode, weighInLbs, localDay, ianaFromVald, dayAtOffset, matchProfile, cleanFilters, passesTags, AVG_SUFFIX } from '../src/modules/lifting/vald-mapping';
import { decideRendition, withRendition, isPlay720, describeSource } from '../src/modules/videos/bunny-renditions';
import { defaultLiftingConfig, validateLiftingConfig, validateMetrics, LIFTING_CATALOG, mergeCatalog, humanizeMetricKey, humanizeTestCode, validatePlayerIds } from '../src/modules/lifting/lifting-catalog';

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, pass: true, detail: 'OK' });
  } catch (err: any) {
    results.push({ name, pass: false, detail: err.message });
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── JWT Tests ───────────────────────────────────────────────────────────

async function jwtTests() {
  await test('signJwt returns a 3-part token', () => {
    const token = signJwt({ sub: 'u1', email: 'a@b.com', role: 'COACH', playerId: null });
    assertEqual(token.split('.').length, 3, 'JWT should have header.body.signature');
  });

  await test('verifyJwt round-trips a valid token', () => {
    const token = signJwt({ sub: 'u1', email: 'a@b.com', role: 'COACH', playerId: 'p1' });
    const payload = verifyJwt(token);
    assert(payload !== null, 'Payload should not be null');
    assertEqual(payload!.sub, 'u1', 'sub');
    assertEqual(payload!.email, 'a@b.com', 'email');
    assertEqual(payload!.role, 'COACH', 'role');
    assertEqual(payload!.playerId, 'p1', 'playerId');
    assert(typeof payload!.iat === 'number', 'iat is a number');
    assert(typeof payload!.exp === 'number', 'exp is a number');
    assert(payload!.exp > payload!.iat, 'exp > iat');
  });

  await test('verifyJwt returns null for tampered token', () => {
    const token = signJwt({ sub: 'u1', email: 'a@b.com', role: 'COACH', playerId: null });
    // Flip the role in the body and re-encode
    const [h, b, s] = token.split('.');
    const decoded = JSON.parse(Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    decoded.role = 'PLAYER';
    const tamperedBody = Buffer.from(JSON.stringify(decoded)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tampered = `${h}.${tamperedBody}.${s}`;
    const result = verifyJwt(tampered);
    assertEqual(result, null, 'Tampered token should fail verification');
  });

  await test('verifyJwt returns null for malformed token', () => {
    assertEqual(verifyJwt(''), null, 'empty string');
    assertEqual(verifyJwt('not.a.jwt'), null, 'three dots, garbage');
    assertEqual(verifyJwt('only.two'), null, 'two parts');
  });

  await test('verifyJwt returns null for expired token', () => {
    // Manually craft a token with exp in the past
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const expired = { sub: 'u1', email: 'x', role: 'COACH', playerId: null, iat: 1, exp: 2 };
    const body = Buffer.from(JSON.stringify(expired)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // Re-sign properly so the signature passes but exp check fails
    const crypto = require('crypto');
    const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production-please-use-aws-secrets-manager';
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${header}.${body}.${sig}`;
    assertEqual(verifyJwt(token), null, 'Expired token rejected');
  });
}

// ─── Parser Registry Tests ──────────────────────────────────────────────

async function parserRegistryTests() {
  await test('getRegisteredSources returns all 6 parsers', () => {
    const sources = getRegisteredSources();
    assertEqual(sources.length, 6, '6 parsers');
    assert(sources.includes('BLAST_MOTION'), 'has BLAST_MOTION');
    assert(sources.includes('TRACKMAN'), 'has TRACKMAN');
    assert(sources.includes('HITTRAX'), 'has HITTRAX');
    assert(sources.includes('HITTRAX_POI'), 'has HITTRAX_POI');
    assert(sources.includes('VALD'), 'has VALD');
    assert(sources.includes('FULL_SWING'), 'has FULL_SWING');
  });

  await test('HitTrax POI parser is never auto-detected (same headers as HitTrax)', () => {
    const headers = ['#', 'AB', 'Date', 'Velo', 'LA', 'Dist', 'Res', 'Type', 'Horiz. Angle', 'POI X', 'POI Y', 'POI Z'];
    const detected = detectParser(headers);
    assert(detected?.parser.source === 'HITTRAX', `detected ${detected?.parser.source}`);
  });

  await test('getParserBySource is case-insensitive', () => {
    assert(getParserBySource('BLAST_MOTION') !== null, 'BLAST_MOTION');
    assert(getParserBySource('blast_motion') !== null, 'lowercase');
    assert(getParserBySource('Blast_Motion') !== null, 'mixed case');
    assertEqual(getParserBySource('UNKNOWN_VENDOR'), null, 'unknown returns null');
  });

  await test('detectParser identifies Blast Motion CSV', () => {
    const headers = ['Player Name', 'Date', 'Bat Speed (mph)', 'Attack Angle (deg)', 'Time to Contact (s)', 'On Plane Efficiency (%)'];
    const result = detectParser(headers);
    assert(result !== null, 'Should detect a parser');
    assertEqual(result!.parser.source, 'BLAST_MOTION', 'detected source');
    assert(result!.confidence >= 0.3, 'confidence above threshold');
  });

  await test('detectParser returns null for unknown CSV', () => {
    const headers = ['col1', 'col2', 'col3'];
    const result = detectParser(headers);
    assertEqual(result, null, 'No parser detected');
  });
}

// ─── Blast Motion Parser Tests ──────────────────────────────────────────

async function blastParserTests() {
  await test('Blast parser extracts metrics from a valid row', () => {
    const parser = new BlastMotionParser();
    const rows = [
      {
        'Player Name': 'John Smith',
        'Date': '2026-04-01',
        'Bat Speed (mph)': '72.5',
        'Attack Angle (deg)': '12.3',
      },
    ];
    const result = parser.parse(rows, new Date('2026-04-01'));
    assertEqual(result.totalRows, 1, 'totalRows');
    assertEqual(result.errors.length, 0, 'no errors');
    /* Bat Speed expands into TWO session-summary metrics
       (`max_bat_speed` AND `avg_bat_speed`) — see parser comment
       "Bat speed produces both max_bat_speed (top swing) and
       avg_bat_speed (mean across every swing)". Attack Angle emits
       one metric. So a row with Bat Speed + Attack Angle = 3 emits. */
    assertEqual(result.success.length, 3, '3 metrics extracted (max+avg bat speed, attack angle)');
    const maxBatSpeed = result.success.find(m => m.metricType === 'max_bat_speed');
    assert(maxBatSpeed !== undefined, 'max bat speed metric exists');
    assertEqual(maxBatSpeed!.value, 72.5, 'max bat speed value');
    assertEqual(maxBatSpeed!.unit, 'mph', 'max bat speed unit');
    assertEqual(maxBatSpeed!.playerName, 'John Smith', 'player name');
    const avgBatSpeed = result.success.find(m => m.metricType === 'avg_bat_speed');
    assert(avgBatSpeed !== undefined, 'avg bat speed metric exists');
    assertEqual(avgBatSpeed!.value, 72.5, 'avg bat speed value (single-row mean = the value itself)');
    const attackAngle = result.success.find(m => m.metricType === 'attack_angle');
    assert(attackAngle !== undefined, 'attack angle metric exists');
    assertEqual(attackAngle!.value, 12.3, 'attack angle value');
  });

  await test('Blast parser falls back to placeholder name for rows with no player name', () => {
    /* The current Blast parser is "session-summary first": it pools
       every numeric reading across every row into per-metric buckets
       and emits ONE summary metric per bucket at the end. When no
       row provides a player name, the parser falls back to the
       sentinel `_blast_upload_` (a placeholder the upload service
       later resolves to the report's `playerId`). It does NOT
       error out — the session is still valuable even when the CSV
       header didn't carry a name. This test pins that behavior. */
    const parser = new BlastMotionParser();
    const rows = [
      { 'Player Name': '', 'Bat Speed (mph)': '70.0' },
    ];
    const result = parser.parse(rows, new Date());
    assertEqual(result.errors.length, 0, 'no errors for missing player name');
    /* Bat Speed → 2 metrics (max + avg). */
    assertEqual(result.success.length, 2, 'both max_bat_speed + avg_bat_speed emitted');
    assertEqual(result.success[0].playerName, '_blast_upload_', 'placeholder name used');
  });

  await test('Blast parser skips non-numeric values', () => {
    const parser = new BlastMotionParser();
    const rows = [
      { 'Player Name': 'X', 'Bat Speed (mph)': 'not-a-number', 'Attack Angle (deg)': '10' },
    ];
    const result = parser.parse(rows, new Date());
    assertEqual(result.success.length, 1, 'only the numeric metric extracted');
    assertEqual(result.success[0].metricType, 'attack_angle', 'kept the valid one');
  });

  await test('Blast parser detectConfidence recognizes its own headers', () => {
    const parser = new BlastMotionParser();
    const headers = ['Player Name', 'Bat Speed (mph)', 'Attack Angle (deg)', 'On Plane Efficiency (%)'];
    const conf = parser.detectConfidence(headers);
    assert(conf >= 0.3, `expected >= 0.3, got ${conf}`);
  });

  await test('Blast parser detectConfidence rejects unrelated headers', () => {
    const parser = new BlastMotionParser();
    const conf = parser.detectConfidence(['name', 'age', 'email']);
    assertEqual(conf, 0, 'zero confidence for unrelated headers');
  });
}

// ─── Trackman Parser Tests ──────────────────────────────────────────────

async function trackmanParserTests() {
  await test('Trackman parser is registered', () => {
    const p = getParserBySource('TRACKMAN');
    assert(p !== null, 'Trackman registered');
    assert(p instanceof TrackmanParser, 'correct class');
  });

  await test('Trackman detectConfidence rejects unrelated headers', () => {
    const parser = new TrackmanParser();
    assertEqual(parser.detectConfidence(['unrelated', 'columns']), 0, 'zero confidence');
  });
}

// ─── HitTrax Parser Tests ───────────────────────────────────────────────

/* Two rows from a real HitTrax export (Cole Miller, 2026-11-03): a single
   (Strike Zone 8) and a take (Velo 0, no contact). */
const HITTRAX_ROWS: Record<string, string>[] = [
  { '#': '2', 'Date': '11/3/2026 19:33:21.413', 'Strike Zone': '8', 'Velo': '92.4', 'LA': '2.3', 'Dist': '72', 'Res': '1B-8', 'Type': 'GB',
    'Horiz. Angle': '10', 'POI X': '0.54', 'POI Y': '24.14', 'POI Z': '26.06', 'Spray Chart X': '12.4', 'Spray Chart Z': '73.6', 'Batting': 'Right' },
  { '#': '3', 'Date': '11/3/2026 19:33:29.024', 'Strike Zone': '7', 'Velo': '0', 'LA': '0', 'Dist': '0', 'Res': '', 'Type': '',
    'Horiz. Angle': '0', 'POI X': '0', 'POI Y': '0', 'POI Z': '0', 'Spray Chart X': '0', 'Spray Chart Z': '0', 'Batting': 'Right' },
];

async function hittraxParserTests() {
  await test('HitTrax parser is registered', () => {
    const p = getParserBySource('HITTRAX');
    assert(p !== null, 'HitTrax registered');
    assert(p instanceof HitTraxParser, 'correct class');
  });

  await test('HitTrax upload also saves Point of Impact (POI Z - 17)', () => {
    const out = new HitTraxParser().parse(HITTRAX_ROWS, new Date('2026-11-03'));
    const poi = out.success.filter((m) => m.metricType === 'poi_depth');
    assertEqual(poi.length, 1, 'one contact -> one POI point (the take is skipped)');
    assertEqual(poi[0].value, 9.06, 'depth in front of the plate');
    assertEqual(poi[0].rawData.x, 0.54, 'side to side');
    assertEqual(poi[0].rawData.res, '1B-8', 'result kept for the chart');
    const ev = out.success.find((m) => m.metricType === 'max_exit_velo');
    assertEqual(ev?.recordedAt.getTime(), poi[0].recordedAt.getTime(), 'shares the swing stamp');
  });

  await test('HitTrax POI card and HitTrax card read a swing identically', () => {
    const a = new HitTraxParser().parse(HITTRAX_ROWS, new Date('2026-11-03')).success.find((m) => m.metricType === 'poi_depth')!;
    const b = new HitTraxPoiParser().parse(HITTRAX_ROWS, new Date('2026-11-03')).success[0];
    assertEqual(JSON.stringify([a.value, a.rawData, a.recordedAt.getTime()]), JSON.stringify([b.value, b.rawData, b.recordedAt.getTime()]), 'same reading');
  });

  await test('HitTrax export without POI columns still parses (no POI points)', () => {
    const rows = HITTRAX_ROWS.map(({ ['POI X']: _x, ['POI Y']: _y, ['POI Z']: _z, ...rest }) => rest);
    const out = new HitTraxParser().parse(rows, new Date('2026-11-03'));
    assert(out.success.some((m) => m.metricType === 'max_exit_velo'), 'batted ball kept');
    assert(!out.success.some((m) => m.metricType === 'poi_depth'), 'no POI');
  });
}

async function sendLimiterTests() {
  await test('reset emails: one a minute per address', () => {
    const lim = new SendLimiter(60_000, 5);
    assert(lim.allow('a@x.com', 0), 'first send');
    assert(!lim.allow('a@x.com', 30_000), 'blocked inside the minute');
    assert(lim.allow('b@x.com', 30_000), 'other addresses unaffected');
    assert(lim.allow('a@x.com', 61_000), 'allowed after a minute');
  });

  await test('reset emails: five a day per address', () => {
    const lim = new SendLimiter(60_000, 5);
    for (let i = 0; i < 5; i++) assert(lim.allow('a@x.com', i * 120_000), `send ${i + 1}`);
    assert(!lim.allow('a@x.com', 6 * 120_000), 'sixth refused');
    assert(lim.allow('a@x.com', 24 * 60 * 60 * 1000 + 1), 'allowed again a day after the first');
  });
}

// ─── assertPlayerOwnership Tests ────────────────────────────────────────
// Pure-function tests for the ownership gate that protects every player-
// scoped GET endpoint. If anyone refactors and forgets the call, these
// catch the regression without needing a live server.

function mockReq(role: 'COACH' | 'PLAYER', playerId: string | null): AuthenticatedRequest {
  return {
    user: {
      sub: 'user-1',
      email: 'a@b.com',
      role,
      playerId,
      iat: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  } as any;
}

function expectThrows(fn: () => void, msg: string) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`Expected to throw: ${msg}`);
}

async function ownershipTests() {
  await test('coach can access any player', () => {
    assertPlayerOwnership(mockReq('COACH', null), 'player-anything');
    assertPlayerOwnership(mockReq('COACH', 'their-own-link'), 'player-different');
  });

  await test('player can access their own playerId', () => {
    assertPlayerOwnership(mockReq('PLAYER', 'p-mine'), 'p-mine');
  });

  await test('player blocked from another player\'s id', () => {
    expectThrows(
      () => assertPlayerOwnership(mockReq('PLAYER', 'p-mine'), 'p-someone-else'),
      'cross-player access',
    );
  });

  await test('player without linked playerId is blocked even from a matching id', () => {
    // playerId === null on the JWT means the user role is PLAYER but no
    // Player record was linked. Should never pass — falsy guard catches
    // null === null lookalikes.
    expectThrows(
      () => assertPlayerOwnership(mockReq('PLAYER', null), 'any-id'),
      'unlinked player',
    );
  });

  await test('missing user object throws unauthorized', () => {
    expectThrows(
      () => assertPlayerOwnership({} as any, 'any-id'),
      'no user on request',
    );
  });
}


// ─── MOVE Catching Sensor sessions ─────────────────────────────────────

/* Trimmed copy of the first real test delivery (2026-11-13). */
function moveFixture(over: Record<string, unknown> = {}) {
  const c = (n: number, extra: Record<string, unknown> = {}) => ({
    catchId: `c_${n}`, number: n, withdrawn: false, contactAt: `2026-11-14T02:43:1${n}.000Z`,
    metrics: { gloveSpeedMph: 8 + n / 10, timeToStickSec: 0.2 - n / 100, junk: 'x' },
    reach: false,
    files: { video: { url: `https://example.test/v${n}`, contentType: 'video/quicktime', bytes: 100, expiresAt: '2026-11-21T03:08:06.630Z' } },
    ...extra,
  });
  return {
    schema: 'move.session.v1',
    sessionId: 'move_abc_r1', baseSessionId: 'move_abc', revision: 1,
    player: { externalId: 'DEFINED-TEST-1', moveId: 'MoveUser1' },
    session: { moveSessionId: '20261113_204311', firstCatchAt: '2026-11-14T02:43:11.680Z', lastCatchAt: '2026-11-14T02:43:40.566Z', catchCount: 2 },
    catches: [c(1), c(2, { withdrawn: true })],
    ...over,
  };
}

async function moveSessionTests() {
  await test('MOVE: reads a session, keeps numeric metrics only', () => {
    const s = parseMoveSession(moveFixture());
    assertEqual(s.baseSessionId, 'move_abc', 'base id');
    assertEqual(s.revision, 1, 'revision');
    assertEqual(s.externalId, 'DEFINED-TEST-1', 'externalId');
    assertEqual(s.catches.length, 2, 'catch count');
    assertEqual(s.catches[1].withdrawn, true, 'withdrawn kept');
    assert(!('junk' in s.catches[0].metrics), 'non-numeric metric dropped');
    assertEqual(s.catches[0].video?.url, 'https://example.test/v1', 'video url');
  });

  await test('MOVE: rejects other schemas and missing athlete', () => {
    expectThrows(() => parseMoveSession(moveFixture({ schema: 'other.v1' })), 'schema');
    expectThrows(() => parseMoveSession(moveFixture({ player: {} })), 'no athlete');
    expectThrows(() => parseMoveSession(moveFixture({ catches: 'nope' })), 'no catches');
  });

  await test('MOVE: non-https file links are ignored', () => {
    const s = parseMoveSession(moveFixture({ catches: [{ catchId: 'x', metrics: {}, files: { video: { url: 'http://insecure.test/v' } } }] }));
    assertEqual(s.catches[0].video, null, 'http dropped');
  });

  await test('MOVE: local date + offset come from the device session name', () => {
    const d = sessionLocalDay(parseMoveSession(moveFixture()));
    assertEqual(d.date, '2026-11-13', 'evening session stays on the 13th, not UTC 14th');
    assertEqual(d.offsetMinutes, -360, 'UTC-6');
    assertEqual(localDate(new Date('2026-11-14T05:59:00Z'), d), '2026-11-13', 'still the 13th locally');
    assertEqual(localDate(new Date('2026-11-14T06:01:00Z'), d), '2026-11-14', 'midnight local');
  });

  await test('MOVE: without a session name the time zone decides the date', () => {
    const d = sessionLocalDay({ moveSessionId: null, firstCatchAt: '2026-11-14T02:43:11.680Z' }, 'America/Chicago');
    assertEqual(d.date, '2026-11-13', 'Chicago date');
  });

  await test('MOVE: a newer revision replaces, an older one is refused', () => {
    const r1 = parseMoveSession(moveFixture());
    const r2 = parseMoveSession(moveFixture({ sessionId: 'move_abc_r2', revision: 2 }));
    const first = mergeMoveSession(undefined, r1, 'd1')!;
    const second = mergeMoveSession(first, r2, 'd2')!;
    assertEqual(second.sessions.length, 1, 'one session per base id');
    assertEqual(second.sessions[0].revision, 2, 'r2 kept');
    assertEqual(mergeMoveSession(second, r1, 'd3'), null, 'older revision refused');
    const other = parseMoveSession(moveFixture({ sessionId: 'move_xyz_r1', baseSessionId: 'move_xyz' }));
    assertEqual(mergeMoveSession(second, other, 'd4')!.sessions.length, 2, 'different sessions both kept');
  });

  await test('MOVE: only MOVE file links are ever fetched', () => {
    assert(isMoveFileUrl('https://us-central1-move-catching-sensor.cloudfunctions.net/orgFile/abc'), 'MOVE host ok');
    assert(!isMoveFileUrl('http://us-central1-move-catching-sensor.cloudfunctions.net/orgFile/abc'), 'http refused');
    assert(!isMoveFileUrl('https://evil.test/move-catching-sensor.cloudfunctions.net'), 'other host refused');
    assert(!isMoveFileUrl('https://x.cloudfunctions.net.evil.test/a'), 'look-alike refused');
    assert(!isMoveFileUrl('https://169.254.169.254/latest'), 'metadata IP refused');
  });

  await test('MOVE: 3D path files are checked and trimmed', () => {
    const p = parseMovePath({ v: 6, ta: 1, contact: 2, stick: 3, t: [0, 0.1, 0.2, 0.3],
      p: [[0, 0.765, 0.482], [0.01, 0.7, 0.5], [0.02, 0.9, 0.3], [0.123456789, 1, 0.2]],
      q: [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]], sm: { t: [], m: [] } });
    assertEqual(p.contact, 2, 'contact index');
    assertEqual(p.p[3][0], 0.1235, 'rounded to 0.1 mm');
    assert(!('sm' in p), 'extra blocks dropped');
    const clamped = parseMovePath({ t: [0, 1], p: [[0, 0, 0], [1, 1, 1]], ta: 9, contact: -1, stick: 'x' });
    assertEqual(clamped.stick, 1, 'bad stick -> last sample');
    assert(clamped.ta <= clamped.contact && clamped.contact <= clamped.stick, 'markers in order');
    expectThrows(() => parseMovePath({ t: [0, 1], p: [[0, 0, 0]] }), 'length mismatch');
    expectThrows(() => parseMovePath({ t: [0, 1], p: [[0, 0], [1, 1]] }), 'not 3D');
    expectThrows(() => parseMovePath(null), 'not an object');
  });

  await test('MOVE: only untouched auto-made reports count as MOVE-only', () => {
    const base = { title: 'MOVE Session', notes: null, videoIds: null };
    assert(isMoveOnly({ ...base, content: JSON.stringify({ moveReceiving: { sessions: [] } }) }), 'plain MOVE report');
    assert(!isMoveOnly({ ...base, content: JSON.stringify({ moveReceiving: {}, catchingAssessment: {} }) }), 'coach data added');
    assert(!isMoveOnly({ ...base, notes: 'note', content: JSON.stringify({ moveReceiving: {} }) }), 'notes added');
    assert(!isMoveOnly({ ...base, videoIds: 'v1', content: JSON.stringify({ moveReceiving: {} }) }), 'video added');
    assert(!isMoveOnly({ ...base, title: 'Nov bullpen', content: JSON.stringify({ moveReceiving: {} }) }), 'renamed by a coach');
    assert(!isMoveOnly({ ...base, content: 'not json' }), 'unreadable content kept');
  });

  await test('MOVE: sessions join the coach report, never a MOVE-only one', () => {
    const day = { date: '2026-11-14', offsetMinutes: -360, tz: null };
    const r = (id: string, iso: string, moveOnly = false) => ({
      id, createdAt: new Date(iso), title: moveOnly ? 'MOVE Session' : 'Catching', notes: null, videoIds: null,
      content: JSON.stringify(moveOnly ? { moveReceiving: {} } : { catchingAssessment: {} }),
    });
    const sameDay = r('same', '2026-11-14T18:00:00Z');
    const moveOnlySameDay = r('mo', '2026-11-14T17:00:00Z', true);
    const older = r('older', '2026-11-01T18:00:00Z');
    const newer = r('newer', '2026-11-20T18:00:00Z');
    assertEqual(pickReportForDay([moveOnlySameDay, sameDay, older], day)?.id, 'same', 'coach report that day');
    assertEqual(pickReportForDay([moveOnlySameDay, older], day)?.id, 'older', 'latest coach report before, not the MOVE-only one');
    assertEqual(pickReportForDay([newer, older], day)?.id, 'older', 'on-or-before beats a later report');
    assertEqual(pickReportForDay([newer], day)?.id, 'newer', 'only a later coach report: use it');
    assertEqual(pickReportForDay([moveOnlySameDay], day)?.id, 'mo', 'no coach report: the MOVE one');
    assertEqual(pickReportForDay([], day), null, 'nothing: caller creates one');
  });
}


// ─── Lifting Dashboard layout ───────────────────────────────────────────

async function liftingTests() {
  await test('Lifting: default layout is valid and matches the strength coach list', () => {
    const d = defaultLiftingConfig();
    const v = validateLiftingConfig(d);
    assertEqual(v.bubbles.map((b) => b.title).join(','), 'Body Weight,CMJ,SJ,Single Leg Jump,Plyo Push-up,Push-up,Grip Strength,IR (Standing),ER (Standing),IR (90/90),ER (90/90),6 lb Med Ball', 'bubble order');
    assertEqual(v.bubbles[1].kpis.length, 4, 'CMJ has 4 KPIs');
    assertEqual(v.bubbles[1].kpis[0].metric, 'JUMP_HEIGHT_INCHES_IMP_MOM', 'CMJ jump height = Imp-Mom inches');
    assertEqual(v.bubbles[1].kpis[3].metric, 'PEAK_TAKEOFF_FORCE_ASYM', 'asymmetry = takeoff peak force');
    const ratio = v.bubbles.find((b) => b.id === 'er-9090')!.kpis.find((k) => k.ratio);
    assert(!!ratio && ratio.ratio!.den.test === 'IR_9090' && ratio.ratio!.num.metric === 'PEAK_FORCE_LEFT', 'ER:IR ratio uses the same position + arm');
    for (const b of v.bubbles) {
      const cat = LIFTING_CATALOG.find((t) => t.code === b.test);
      assert(!!cat, `catalog has ${b.test}`);
      for (const k of b.kpis) if (k.metric) assert(cat!.metrics.some((m) => m.key === k.metric), `${b.test}.${k.metric} in catalog`);
    }
  });

  await test('Lifting: layout edits are checked', () => {
    expectThrows(() => validateLiftingConfig({ bubbles: 'x' }), 'no list');
    expectThrows(() => validateLiftingConfig({ bubbles: [{ title: '', test: 'CMJ', kpis: [{ label: 'a', metric: 'x' }] }] }), 'no name');
    expectThrows(() => validateLiftingConfig({ bubbles: [{ title: 'A', test: 'cm j!', kpis: [{ label: 'a', metric: 'x' }] }] }), 'bad test');
    expectThrows(() => validateLiftingConfig({ bubbles: [{ title: 'A', test: 'CMJ', kpis: [] }] }), 'no boxes');
    expectThrows(() => validateLiftingConfig({ bubbles: [{ title: 'A', test: 'CMJ', kpis: [{ label: 'a', metric: '1bad' }] }] }), 'bad metric');
    const ok = validateLiftingConfig({ bubbles: [{ title: ' Jump ', test: 'cmj', kpis: [{ label: 'JH', metric: 'jumpHeight', digits: 9, factor: -1, better: 'up' }] }] });
    assertEqual(ok.bubbles[0].test, 'CMJ', 'test code upper-cased');
    assertEqual(ok.bubbles[0].title, 'Jump', 'name trimmed');
    assertEqual(ok.bubbles[0].kpis[0].digits, 1, 'bad digits -> 1');
    assertEqual(ok.bubbles[0].kpis[0].factor, 1, 'bad factor -> 1');
    assertEqual(ok.bubbles[0].kpis[0].better, null, 'bad direction -> none');
  });

  await test('Lifting: anything saved results hold can be picked', () => {
    for (const t of LIFTING_CATALOG) {
      assertEqual(new Set(t.metrics.map((m) => m.key)).size, t.metrics.length, `${t.code} has no duplicate keys`);
    }
    const seen = new Map<string, Set<string>>([
      ['CMJ', new Set(['jumpHeight', 'lowerLimbStiffnessX'])],
      ['ISO_SQUAT', new Set(['peakForce', 'rfd0to100msLeft'])],
    ]);
    const merged = mergeCatalog(LIFTING_CATALOG, seen);
    const cmj = merged.find((t) => t.code === 'CMJ')!;
    assertEqual(cmj.metrics.filter((m) => m.key === 'jumpHeight').length, 1, 'known metric not repeated');
    assertEqual(cmj.metrics[cmj.metrics.length - 1].key, 'lowerLimbStiffnessX', 'new metric added at the end');
    const iso = merged.find((t) => t.code === 'ISO_SQUAT')!;
    assertEqual(iso.label, 'Iso Squat', 'new test named');
    assertEqual(iso.source, 'other', 'new test marked other');
    assertEqual(LIFTING_CATALOG.find((t) => t.code === 'CMJ')!.metrics.some((m) => m.key === 'lowerLimbStiffnessX'), false, 'base catalog untouched');
    assertEqual(humanizeMetricKey('eccentricBrakingRfdLeft'), 'Eccentric Braking RFD (Left)', 'side + acronym');
    assertEqual(humanizeMetricKey('peakPowerAsym'), 'Peak Power Asymmetry', 'asymmetry');
    assertEqual(humanizeMetricKey('rfd0to100ms'), 'RFD 0 to 100 ms', 'digits split');
    assertEqual(humanizeTestCode('SHOULDER_IR'), 'Shoulder IR', 'test code');
  });

  await test('Lifting: many-athlete changes need a clean list', () => {
    assertEqual(validatePlayerIds([' a1 ', 'a1', 'b-2', 7]).join(','), 'a1,b-2', 'trimmed, de-duplicated, non-strings dropped');
    expectThrows(() => validatePlayerIds([]), 'empty');
    expectThrows(() => validatePlayerIds('a1'), 'not a list');
    expectThrows(() => validatePlayerIds(['a b']), 'bad id');
    expectThrows(() => validatePlayerIds(Array.from({ length: 301 }, (_, i) => `p${i}`)), 'too many');
  });

  await test('Lifting: typed results need real numbers', () => {
    assertEqual(JSON.stringify(validateMetrics({ velocity: '62.5', blank: '' })), '{"velocity":62.5}', 'string number kept, blank skipped');
    expectThrows(() => validateMetrics({}), 'nothing entered');
    expectThrows(() => validateMetrics({ velocity: 'fast' }), 'not a number');
    expectThrows(() => validateMetrics({ 'bad key': 1 }), 'bad key');
  });
}

// ─── Bunny 1080p renditions ─────────────────────────────────────────────

async function renditionTests() {
  await test('Renditions: only a finished encode with 1080p moves up', () => {
    assertEqual(decideRendition(null).state, 'pending', 'no info yet');
    assertEqual(decideRendition({ status: 3, encodeProgress: 60 }).state, 'pending', 'transcoding');
    assertEqual(decideRendition({ status: 5 }).state, 'failed', 'encode error');
    const order = (d: ReturnType<typeof decideRendition>) => (d.state === 'ready' ? d.candidates.join(',') : d.state);
    assertEqual(order(decideRendition({ status: 4, availableResolutions: '240p,360p,480p,720p,1080p' })), '1080p,720p,480p,360p,240p', 'best first');
    assertEqual(order(decideRendition({ status: 4, availableResolutions: '240p,360p,720p' })), '720p,360p,240p', '720p source: 720p first');
    assertEqual(order(decideRendition({ status: 4, availableResolutions: '240p,360p' })), '360p,240p', 'small source: no 720p at all');
    assertEqual(order(decideRendition({ status: 8, encodeProgress: 100, availableResolutions: '720p, 1080P' })), '1080p,720p', 'done by progress, case/space tolerant');
  });

  await test('Renditions: link rewrite + detection', () => {
    const u = 'https://vz-abc.b-cdn.net/11111111-2222-3333-4444-555555555555/play_720p.mp4';
    assertEqual(withRendition(u, '1080p'), 'https://vz-abc.b-cdn.net/11111111-2222-3333-4444-555555555555/play_1080p.mp4', '720 -> 1080');
    assertEqual(withRendition(u, '360p').endsWith('/play_360p.mp4'), true, '720 -> 360');
    assert(isPlay720(u), 'detects 720p');
    assert(!isPlay720(withRendition(u, '1080p')), '1080p is not 720p');
    assertEqual(describeSource({ width: 1080, height: 1920, framerate: 29.97 }), '1080x1920 @ 29.97fps', 'source text');
  });
}

// ─── VALD import ────────────────────────────────────────────────────────

async function valdTests() {
  const defs = new Map<string, any>([
    ['JUMP_HEIGHT_INCHES_IMP_MOM', { resultIdString: 'JUMP_HEIGHT_INCHES_IMP_MOM', resultName: 'Jump Height (Imp-Mom) in Inches', resultUnitName: 'in', numberOfDecimalPlaces: 1, trendDirection: 'Positive' }],
    ['CONTRACTION_TIME', { resultIdString: 'CONTRACTION_TIME', resultName: 'Contraction Time', resultUnitName: 'ms', numberOfDecimalPlaces: 0, trendDirection: 'Negative' }],
    ['PEAK_TAKEOFF_FORCE', { resultIdString: 'PEAK_TAKEOFF_FORCE', resultName: 'Takeoff Peak Force', resultUnitName: 'N', numberOfDecimalPlaces: 0, trendDirection: 'Positive' }],
  ]);
  const r = (result: string, value: number, limb = 'Trial') => ({ value, limb, definition: { result } });

  await test('VALD: a session keeps its best and average per result', () => {
    const { metrics, meta } = aggregateForceDecks([
      { limb: 'Trial', results: [r('JUMP_HEIGHT_INCHES_IMP_MOM', 16), r('CONTRACTION_TIME', 0.8), r('PEAK_TAKEOFF_FORCE', 1.5, 'Asym')] },
      { limb: 'Trial', results: [r('JUMP_HEIGHT_INCHES_IMP_MOM', 18), r('CONTRACTION_TIME', 0.7), r('PEAK_TAKEOFF_FORCE', -0.5, 'Asym')] },
    ], defs);
    assertEqual(metrics.JUMP_HEIGHT_INCHES_IMP_MOM, 18, 'best jump = highest');
    assertEqual(metrics['JUMP_HEIGHT_INCHES_IMP_MOM' + AVG_SUFFIX], 17, 'average jump');
    assertEqual(metrics.CONTRACTION_TIME, 700, 'lower-is-better result: best = lowest');
    assertEqual(metrics.PEAK_TAKEOFF_FORCE_ASYM, -0.5, 'asymmetry best = closest to 0');
    assertEqual(meta.PEAK_TAKEOFF_FORCE_ASYM.unit, '%', 'asymmetry in %');
    assertEqual(meta.JUMP_HEIGHT_INCHES_IMP_MOM.unit, 'in', 'VALD unit kept');
    assertEqual(meta.CONTRACTION_TIME.better, 'low', 'VALD direction kept');
  });

  await test('VALD: values put into the unit VALD names (ms, lbs, RSI)', () => {
    const d = new Map<string, any>([
      ['CONTRACTION_TIME', { resultIdString: 'CONTRACTION_TIME', resultName: 'Contraction Time', resultUnitName: 'ms', numberOfDecimalPlaces: 0, trendDirection: 'Negative' }],
      ['BODY_WEIGHT_LBS', { resultIdString: 'BODY_WEIGHT_LBS', resultName: 'Bodyweight in Pounds', resultUnitName: 'lbs', numberOfDecimalPlaces: 1, trendDirection: null }],
      ['RSI_MODIFIED', { resultIdString: 'RSI_MODIFIED', resultName: 'RSI-modified', resultUnitName: 'm/s', numberOfDecimalPlaces: 2, trendDirection: 'Positive' }],
      ['TAKEOFF_VELOCITY', { resultIdString: 'TAKEOFF_VELOCITY', resultName: 'Takeoff Velocity', resultUnitName: 'm/s', numberOfDecimalPlaces: 2, trendDirection: 'Positive' }],
    ]);
    const { metrics } = aggregateForceDecks([{ limb: 'Trial', results: [r('CONTRACTION_TIME', 0.806), r('BODY_WEIGHT_LBS', 66.1), r('RSI_MODIFIED', 67.5), r('TAKEOFF_VELOCITY', 2.9), r('CONTRACTION_TIME', 3.2, 'Asym')] }], d);
    assertEqual(metrics.CONTRACTION_TIME, 806, 'seconds -> ms');
    assertEqual(Math.round(metrics.BODY_WEIGHT_LBS), 146, 'kg -> lb');
    assertEqual(metrics.RSI_MODIFIED, 0.675, 'RSI cm/s -> m/s');
    assertEqual(metrics.TAKEOFF_VELOCITY, 2.9, 'a real m/s value left alone');
    assertEqual(metrics.CONTRACTION_TIME_ASYM, 3.2, 'asymmetry % left alone');
  });

  await test('VALD: single-leg trials split by leg', () => {
    const { metrics } = aggregateForceDecks([
      { limb: 'Left', results: [r('JUMP_HEIGHT_INCHES_IMP_MOM', 8)] },
      { limb: 'Right', results: [r('JUMP_HEIGHT_INCHES_IMP_MOM', 7)] },
      { limb: 'Right', results: [r('JUMP_HEIGHT_INCHES_IMP_MOM', 9)] },
    ], defs);
    assertEqual(metrics.JUMP_HEIGHT_INCHES_IMP_MOM_LEFT, 8, 'left leg');
    assertEqual(metrics.JUMP_HEIGHT_INCHES_IMP_MOM_RIGHT, 9, 'right leg best');
    assertEqual(metrics['JUMP_HEIGHT_INCHES_IMP_MOM_RIGHT' + AVG_SUFFIX], 8, 'right leg average');
    assert(!('JUMP_HEIGHT_INCHES_IMP_MOM' in metrics), 'no both-legs value');
  });

  await test('VALD: DynaMo positions, sides and skipped zeros', () => {
    assertEqual(dynamoTestCode({ movement: 'InternalRotation', position: 'StandingElbow90Degrees' }), 'IR_STANDING', 'IR standing');
    assertEqual(dynamoTestCode({ movement: 'InternalRotation', position: 'SupineElbow90Degrees90DegreeShoulderAbduction' }), 'IR_9090', 'IR 90/90 supine');
    assertEqual(dynamoTestCode({ movement: 'ExternalRotation', position: 'SeatedElbow90Degrees90DegreeShoulderAbduction' }), 'ER_9090', 'ER 90/90 seated');
    assertEqual(dynamoTestCode({ movement: 'ExternalRotation', position: 'SeatedElbow90Degrees90DegreeShoulderAbduction', testCategory: 'RangeofMotion' }), 'ER_9090_ROM', 'ROM test');
    assertEqual(dynamoTestCode({ movement: 'GripSqueeze', position: 'p90DegreesElbowFlexion' }), 'GRIP', 'grip');
    const [g] = aggregateDynamo({
      id: 't', athleteId: 'a', movement: 'GripSqueeze', position: 'p90DegreesElbowFlexion',
      repetitionTypeSummaries: [
        { laterality: 'RightSide', maxForceNewtons: 381.9, avgForceNewtons: 377, maxRangeOfMotionDegrees: 0 },
        { laterality: 'LeftSide', maxForceNewtons: 394.4, avgForceNewtons: 377.5 },
      ],
      asymmetries: [{ movement: 'GripSqueeze', valuePercentage: -3.2 }],
    });
    assertEqual(g.metrics.PEAK_FORCE_RIGHT, 381.9, 'right best');
    assertEqual(g.metrics['PEAK_FORCE_LEFT' + AVG_SUFFIX], 377.5, 'left average');
    assertEqual(g.metrics.PEAK_FORCE_ASYM, -3.2, 'asymmetry');
    assert(!('RANGE_OF_MOTION_RIGHT' in g.metrics), 'unmeasured (0) left out');
  });

  await test('VALD: combined IR + ER test splits into IR and ER sessions', () => {
    const sessions = aggregateDynamo({
      id: 't', athleteId: 'a', testCategory: 'Strength', bodyRegion: 'Shoulder', movement: 'InternalRotationExternalRotation', position: 'StandingElbow90Degrees',
      repetitionTypeSummaries: [
        { movement: 'InternalRotation', laterality: 'LeftSide', maxForceNewtons: 207, avgForceNewtons: 206 },
        { movement: 'ExternalRotation', laterality: 'RightSide', maxForceNewtons: 123.6, avgForceNewtons: 113.6 },
        { movement: 'ExternalRotation', laterality: 'LeftSide', maxForceNewtons: 142.7, avgForceNewtons: 142.7 },
        { movement: 'InternalRotation', laterality: 'RightSide', maxForceNewtons: 240.2, avgForceNewtons: 227.7 },
      ],
      asymmetries: [{ movement: 'InternalRotation', valuePercentage: 13.8 }, { movement: 'ExternalRotation', valuePercentage: -13.4 }],
      ratios: [
        { laterality: 'RightSide', numeratorMovement: 'InternalRotation', denominatorMovement: 'ExternalRotation', value: 1.94 },
        { laterality: 'RightSide', numeratorMovement: 'ExternalRotation', denominatorMovement: 'InternalRotation', value: 0.51 },
      ],
    });
    assertEqual(sessions.map((x) => `${x.code}${x.idSuffix}`).join(','), 'IR_STANDING:IR,ER_STANDING:ER', 'two sessions');
    const [ir, er] = sessions;
    assertEqual(ir.metrics.PEAK_FORCE_RIGHT, 240.2, 'IR right = the IR rep, not ER');
    assertEqual(er.metrics.PEAK_FORCE_RIGHT, 123.6, 'ER right');
    assertEqual(er.metrics.PEAK_FORCE_LEFT, 142.7, 'ER left');
    assertEqual(ir.metrics.PEAK_FORCE_ASYM, 13.8, 'IR asymmetry');
    assertEqual(er.metrics.PEAK_FORCE_ASYM, -13.4, 'ER asymmetry');
    assertEqual(er.metrics.ER_IR_RATIO_RIGHT, 0.51, 'VALD ER:IR ratio on the ER session');
    assertEqual(ir.metrics.IR_ER_RATIO_RIGHT, 1.94, 'VALD IR:ER ratio on the IR session');
    assertEqual(ir.label, 'Shoulder IR (Standing)', 'label');
  });

  await test('VALD: flexion tests are named by body region', () => {
    assertEqual(dynamoTestCode({ bodyRegion: 'Knee', movement: 'Flexion', position: 'Seated', testCategory: 'Strength' }), 'KNEE_FLEXION_SEATED', 'knee flexion seated');
    assertEqual(dynamoTestCode({ bodyRegion: 'Knee', movement: 'Flexion', position: 'Prone', testCategory: 'Strength' }), 'KNEE_FLEXION_PRONE', 'knee flexion prone');
    assertEqual(dynamoTestCode({ bodyRegion: 'Shoulder', movement: 'Flexion', position: 'Standing', testCategory: 'RangeofMotion' }), 'SHOULDER_FLEXION_STANDING_ROM', 'shoulder flexion ROM');
    assertEqual(dynamoTestLabel('KNEE_FLEXION_SEATED'), 'Knee Flexion (Seated)', 'knee label');
    assertEqual(dynamoTestCode({ movement: 'InternalRotation', position: 'SeatedElbow90Degrees' }), 'IR_SEATED', 'IR seated (arm at side)');
    assertEqual(dynamoTestLabel('ER_SEATED'), 'Shoulder ER (Seated)', 'seated label');
    assertEqual(dynamoTestLabel('HIP_EXTENSION_PRONE', { bodyRegion: 'Hip', movement: 'Extension', position: 'Prone', testCategory: 'Strength' }), 'Hip Extension (Prone)', 'unknown test named from its fields');
  });

  await test('VALD: SmartSpeed sessions, junk velocity and weigh-ins', () => {
    const rep = (total: number, v: number, splits: number[] = [total]) => ({
      id: 'r', profileId: 'p', testDateUtc: '2026-08-27T22:14:45.785', testName: '10yd Sprint', isValid: true,
      runningSummaryFields: {
        totalTimeSeconds: total,
        velocityFields: { peakVelocityMetersPerSecond: v, meanVelocityMetersPerSecond: v },
        gateSummaryFields: { splitOne: splits[0] ?? 0, splitTwo: splits[1] ?? 0, splitThree: 0, splitFour: 0 },
      },
    });
    assertEqual(smartSpeedTestCode('10yd Sprint'), 'SS_10YD_SPRINT', 'code');
    const a = aggregateSmartSpeed([rep(0.951, 9.6), rep(0.927, 9.9), { ...rep(0.8, 11), isValid: false }]);
    assertEqual(a.metrics.TOTAL_TIME, 0.927, 'best = fastest valid rep');
    assertEqual(a.metrics['TOTAL_TIME' + AVG_SUFFIX], 0.939, 'average time');
    assertEqual(a.metrics.PEAK_VELOCITY, 9.9, 'best velocity');
    assertEqual(a.metrics.REPS, 2, 'invalid rep left out');
    assert(!('SPLIT_1' in a.metrics), 'one-split drill: no split boxes');
    const junk = aggregateSmartSpeed([rep(0.923, 99.1)]);
    assert(!('PEAK_VELOCITY' in junk.metrics), 'impossible velocity left out');
    const pa = aggregateSmartSpeed([rep(4.878, 0, [2.494, 2.384]), rep(4.93, 0, [2.623, 2.307])]);
    assertEqual(pa.metrics.SPLIT_2, 2.307, 'split 2 best');
    assert(!('PEAK_VELOCITY' in pa.metrics), 'no velocity recorded -> none');
    assertEqual(weighInLbs(81.6), 180, 'kg -> whole lb');
    assertEqual(weighInLbs(0), null, '0 = no weigh-in');
    assertEqual(weighInLbs(81.6, 'CMJ'), 180, 'jump = bodyweight');
    assertEqual(weighInLbs(28, 'PPU'), null, 'push-up weighs only the hands');
    assertEqual(localDay(new Date('2026-08-28T02:00:00Z'), 'America/Chicago'), '2026-08-27', 'evening session keeps its local day');
    assertEqual(ianaFromVald('Central Standard Time'), 'America/Chicago', 'VALD Windows time zone name');
    assertEqual(dayAtOffset('2026-06-16T01:30:00Z', -300), '2026-06-15', 'weigh-in day from the test offset');
  });

  await test('VALD: athletes match by External ID, else name + birthday', () => {
    const roster = [
      { id: 'p1', firstName: 'Mason', lastName: 'Brown', birthDate: '2009-04-02', athleteCode: null },
      { id: 'p2', firstName: 'Tyler', lastName: 'Davis', birthDate: null, athleteCode: 'TD07' },
      { id: 'p3', firstName: 'Luke', lastName: 'Garcia', birthDate: '2010-01-01', athleteCode: null },
    ];
    assertEqual(JSON.stringify(matchProfile({ profileId: 'v', givenName: ' mason ', familyName: 'BROWN', dateOfBirth: '2009-04-02T00:00:00' }, roster)), '{"playerId":"p1","by":"nameBirthday"}', 'name + birthday (case / spaces ignored)');
    assertEqual(JSON.stringify(matchProfile({ profileId: 'v', givenName: 'T', familyName: 'D', externalId: 'td07' }, roster)), '{"playerId":"p2","by":"externalId"}', 'External ID wins');
    assertEqual((matchProfile({ profileId: 'v', givenName: 'Tyler', familyName: 'Davis', dateOfBirth: '2009-01-01T00:00:00' }, roster) as any).reason, 'birthday-missing-in-app', 'app has no birthday');
    assertEqual((matchProfile({ profileId: 'v', givenName: 'Luke', familyName: 'Garcia', dateOfBirth: '2011-01-01T00:00:00' }, roster) as any).reason, 'birthday-different', 'birthday differs');
    assertEqual((matchProfile({ profileId: 'v', givenName: 'Nobody', familyName: 'Here' }, roster) as any).reason, 'no-match', 'not on the roster');
  });

  await test('VALD: filters and tags', () => {
    const f = cleanFilters({ devices: ['dynamo', 'bogus'], excludedTestTypes: ['cmj'], groupIds: ['g1', 'g1', 'bad id!'], tagIds: 'x' });
    assertEqual(f.devices.join(','), 'dynamo', 'unknown device dropped');
    assertEqual(f.excludedTestTypes.join(','), 'CMJ', 'test types upper-cased');
    assertEqual(f.groupIds.join(','), 'g1', 'de-duplicated, bad ids dropped');
    assertEqual(f.tagIds.length, 0, 'non-list ignored');
    assertEqual(cleanFilters({}).devices.join(','), 'forcedecks,dynamo,smartspeed', 'every device by default');
    assert(passesTags([], []), 'no tag filter -> passes');
    assert(!passesTags([], ['t1']), 'untagged test fails a tag filter');
    assert(passesTags([{ attributeValueId: 't1' }], ['t1', 't2']), 'any chosen tag');
  });
}

// ─── Studies ────────────────────────────────────────────────────────────

async function studiesTests() {
  await test('Studies: measure ids', () => {
    assertEqual(JSON.stringify(parseMeasureId('report:max_exit_velo')), '{"kind":"report","key":"max_exit_velo"}', 'report metric');
    assertEqual(JSON.stringify(parseMeasureId('lift:CMJ:JUMP_HEIGHT_INCHES_IMP_MOM')), '{"kind":"lift","test":"CMJ","key":"JUMP_HEIGHT_INCHES_IMP_MOM","avg":false}', 'lifting best');
    assertEqual((parseMeasureId('lift:CMJ:PEAK_TAKEOFF_POWER:avg') as any).avg, true, 'lifting average');
    assertEqual(parseMeasureId('weight')?.kind, 'weight', 'body weight');
    assertEqual((parseMeasureId('checkin:sleep') as any).field, 'sleepRating', 'check-in');
    assertEqual(parseMeasureId('lift:cmj;drop:X'), null, 'junk refused');
    assertEqual(parseMeasureId({}), null, 'non-string refused');
  });

  await test('Chart Builder: one point per day (average / max)', () => {
    const pts = [
      { date: '2026-11-01T15:00:00.000Z', value: 90 },
      { date: '2026-11-01T15:05:00.000Z', value: 100 },
      { date: '2026-11-03T15:00:00.000Z', value: 95 },
    ];
    assertEqual(aggregateDaily(pts, 'AVG').map((p) => p.value).join(','), '95,95', 'daily average');
    assertEqual(aggregateDaily(pts, 'MAX').map((p) => p.value).join(','), '100,95', 'daily max');
    assertEqual(aggregateDaily(pts, null).length, 3, 'no aggregation keeps every reading');
  });

  await test('Chart Builder: TrackMan pitch values + Data Set checks', () => {
    const raw = { pitchType: 'Fastball', relSpeed: 88.4, spinRate: '2210' };
    assertEqual(tmPitchValue(raw, 'relSpeed|Fastball'), 88.4, 'fastball velo');
    assertEqual(tmPitchValue(raw, 'relSpeed|Slider'), null, 'other pitch type left out');
    assertEqual(tmPitchValue(raw, 'spinRate|ALL'), 2210, 'all pitches, text number');
    const d = cleanDataSet({
      name: ' MLB averages ', labelColumn: 'Level',
      columns: [{ key: 'ev', name: 'Exit Velo', unit: 'mph', link: { source: 'BATTED_BALL', metricType: 'max_exit_velo' } }, { key: 'bad key!', name: 'Spin' }],
      rows: [{ label: 'MLB', values: { ev: '88.6', c1: '2,300' } }, { label: '', values: { ev: 'n/a' } }],
    });
    assertEqual(d.name, 'MLB averages', 'name trimmed');
    assertEqual(d.columns[1].key, 'c1', 'bad column key replaced');
    assertEqual(d.rows[0].values.ev, 88.6, 'number from text');
    assertEqual(d.rows[0].values.c1, 2300, 'thousands comma');
    assertEqual(d.rows[1].values.ev, null, 'not a number -> blank');
    assertEqual(d.rows[1].label, 'Row 2', 'blank group named');
    let threw = false;
    try { cleanDataSet({ name: 'x', columns: [], rows: [] }); } catch { threw = true; }
    assert(threw, 'no columns refused');
  });

  await test('Studies: data request + saved study checks', () => {
    const r = cleanDataRequest({ measures: ['weight', 'weight', 'bogus', 'report:fb_max_velo'], from: '2026-01-01', to: 'nope' });
    assertEqual(r.ids.join(','), 'weight,report:fb_max_velo', 'deduped, junk dropped');
    assertEqual(r.to, null, 'bad date ignored');
    let threw = false;
    try { cleanDataRequest({ measures: [] }); } catch { threw = true; }
    assert(threw, 'no measures -> error');
    const st = cleanStudy({ title: '  Jump vs velo ', type: 'relationship', config: { x: { id: 'weight' } }, conclusion: ' ok ' });
    assertEqual(st.title, 'Jump vs velo', 'title trimmed');
    assertEqual(st.conclusion, 'ok', 'conclusion trimmed');
    threw = false;
    try { cleanStudy({ title: 'x', type: 'pie', config: {} }); } catch { threw = true; }
    assert(threw, 'unknown type refused');
  });
}

// ─── Runner ─────────────────────────────────────────────────────────────

async function run() {
  console.log('Running API unit tests...\n');

  await jwtTests();
  await parserRegistryTests();
  await blastParserTests();
  await trackmanParserTests();
  await hittraxParserTests();
  await sendLimiterTests();
  await ownershipTests();
  await moveSessionTests();
  await liftingTests();
  await studiesTests();
  await renditionTests();
  await valdTests();

  console.log('\n' + '='.repeat(60));
  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon} ${r.name}${r.pass ? '' : ' — ' + r.detail}`);
  }
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log('='.repeat(60));
  console.log(`${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
