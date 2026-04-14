/**
 * API Integration Tests
 *
 * Tests the full HTTP request/response cycle against a running API.
 * Requires: npm run db:seed && npm run dev (on port 3001)
 *
 * Run: npx ts-node --project test/tsconfig.test.json test/api.test.ts
 */

const BASE = 'http://localhost:3001/api';

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, pass: true, detail: 'OK' });
  } catch (err: any) {
    results.push({ name, pass: false, detail: err.message });
  }
}

let bearerToken: string | null = null;

function authHeaders(): Record<string, string> {
  return bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function post<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// ─── Tests ──────────────────────────────────────────────────────────────

async function run() {
  console.log('Running API integration tests...\n');

  // Health
  await test('GET /health returns ok', async () => {
    const data = await get<any>('/health');
    assert(data.status === 'ok', `Expected status ok, got ${data.status}`);
    assert(data.database === 'connected', `DB not connected: ${data.database}`);
  });

  // Auth
  let coachId: string;
  let coachPlayerId: string;

  await test('POST /auth/login with coach credentials returns JWT', async () => {
    const data = await post<any>('/auth/login', { email: 'coach@playerdev.com', password: 'coach123' });
    assert(data.role === 'COACH', `Expected COACH role, got ${data.role}`);
    assert(data.email === 'coach@playerdev.com', `Wrong email: ${data.email}`);
    assert(!!data.id, 'Missing user id');
    assert(typeof data.token === 'string' && data.token.split('.').length === 3, 'Missing or invalid JWT token');
    coachId = data.id;
    coachPlayerId = data.playerId;
    // Use coach token for all subsequent authed calls
    bearerToken = data.token;
  });

  await test('GET /auth/me with token returns payload', async () => {
    const me = await get<any>('/auth/me');
    assert(me.email === 'coach@playerdev.com', `Wrong me.email: ${me.email}`);
    assert(me.role === 'COACH', `Wrong me.role: ${me.role}`);
    assert(typeof me.exp === 'number', 'Missing exp');
  });

  await test('GET /players without token returns 401', async () => {
    const saved = bearerToken;
    bearerToken = null;
    const res = await fetch(`${BASE}/players`);
    bearerToken = saved;
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  let playerToken: string;
  await test('POST /auth/login with player credentials returns JWT', async () => {
    const data = await post<any>('/auth/login', { email: 'john@playerdev.com', password: 'player123' });
    assert(data.role === 'PLAYER', `Expected PLAYER role, got ${data.role}`);
    assert(!!data.playerId, 'Missing playerId');
    assert(typeof data.token === 'string' && data.token.split('.').length === 3, 'Missing JWT token');
    playerToken = data.token;
  });

  await test('POST /players as PLAYER returns 401 (role guard)', async () => {
    const res = await fetch(`${BASE}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${playerToken}` },
      body: JSON.stringify({
        userId: 'fake', firstName: 'X', lastName: 'Y', positions: 'INF',
      }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('POST /leaderboards/recompute as PLAYER returns 401', async () => {
    const res = await fetch(`${BASE}/leaderboards/recompute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${playerToken}` },
      body: '{}',
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('POST /auth/login with wrong password fails', async () => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'coach@playerdev.com', password: 'wrong' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Players
  let players: any[];
  let johnId: string;

  await test('GET /players returns seeded players', async () => {
    players = await get<any[]>('/players');
    assert(players.length >= 10, `Expected >= 10 players, got ${players.length}`);
    const john = players.find((p: any) => p.firstName === 'John');
    assert(!!john, 'John Smith not found');
    johnId = john.id;
  });

  await test('GET /players/:id returns player with metrics', async () => {
    const player = await get<any>(`/players/${johnId}`);
    assert(player.firstName === 'John', `Expected John, got ${player.firstName}`);
    assert(Array.isArray(player.metrics), 'Missing metrics array');
    assert(player.metrics.length > 0, 'No metrics found');
  });

  await test('GET /players/:id/top-metrics returns keyed object', async () => {
    const top = await get<any>(`/players/${johnId}/top-metrics`);
    assert(typeof top === 'object', 'Not an object');
    assert(!!top.max_exit_velo, 'Missing max_exit_velo');
    assert(typeof top.max_exit_velo.value === 'number', 'value not a number');
    assert(typeof top.max_exit_velo.unit === 'string', 'unit not a string');
  });

  // Metrics
  await test('GET /players/:id/metrics returns array', async () => {
    const metrics = await get<any[]>(`/players/${johnId}/metrics`);
    assert(Array.isArray(metrics), 'Not an array');
    assert(metrics.length > 0, 'No metrics');
    const types = [...new Set(metrics.map((m: any) => m.metricType))];
    assert(types.includes('max_exit_velo'), `Missing max_exit_velo in ${types.join(', ')}`);
  });

  await test('GET /players/:id/metrics/progress/:type returns time series', async () => {
    const progress = await get<any[]>(`/players/${johnId}/metrics/progress/max_exit_velo`);
    assert(Array.isArray(progress), 'Not an array');
    assert(progress.length > 0, 'No progress data');
    assert(typeof progress[0].value === 'number', 'Missing value');
    assert(typeof progress[0].recordedAt === 'string', 'Missing recordedAt');
  });

  // Games
  await test('GET /games/player/:id returns game reports', async () => {
    const games = await get<any[]>(`/games/player/${johnId}`);
    assert(Array.isArray(games), 'Not an array');
    assert(games.length >= 2, `Expected >= 2 game reports, got ${games.length}`);
    assert(!!games[0].opponent, 'Missing opponent field');
  });

  // Training
  await test('GET /training/player/:id returns programs', async () => {
    const programs = await get<any[]>(`/training/player/${johnId}`);
    assert(Array.isArray(programs), 'Not an array');
    assert(programs.length >= 1, 'No training programs');
    assert(programs[0].name === 'Spring Training 2026', `Wrong name: ${programs[0].name}`);
    assert(Array.isArray(programs[0].days), 'Missing days');
    assert(programs[0].days.length >= 1, 'No training days');
  });

  // Uploads
  await test('GET /uploads/sources returns supported sources', async () => {
    const data = await get<any>('/uploads/sources');
    assert(Array.isArray(data.sources), 'sources not an array');
    assert(data.sources.includes('TRACKMAN'), 'Missing TRACKMAN');
    assert(data.sources.includes('BLAST_MOTION'), 'Missing BLAST_MOTION');
  });

  // Leaderboards
  await test('POST /leaderboards/recompute computes rankings', async () => {
    const data = await post<any>('/leaderboards/recompute', {});
    assert(data.status === 'ok' || data.computed !== undefined, `Unexpected response: ${JSON.stringify(data)}`);
  });

  await test('GET /leaderboards returns entries after recompute', async () => {
    const entries = await get<any[]>('/leaderboards?gradYear=2026&metricType=max_exit_velo');
    assert(Array.isArray(entries), 'Not an array');
    // After recompute, should have entries
    assert(entries.length > 0, 'No leaderboard entries after recompute');
    assert(entries[0].rank === 1, `First entry rank should be 1, got ${entries[0].rank}`);
  });

  // Videos (empty expected — no videos seeded)
  await test('GET /videos/player/:id returns empty array', async () => {
    const videos = await get<any[]>(`/videos/player/${johnId}`);
    assert(Array.isArray(videos), 'Not an array');
  });

  // Swagger
  await test('GET /docs returns Swagger UI', async () => {
    const res = await fetch(`${BASE}/docs`);
    assert(res.status === 200, `Swagger returned ${res.status}`);
  });

  // ─── Report ─────────────────────────────────────────────────────────

  console.log('');
  console.log('='.repeat(60));
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon} ${r.name}`);
    if (!r.pass) {
      console.log(`   → ${r.detail}`);
      failed++;
    } else {
      passed++;
    }
  }
  console.log('='.repeat(60));
  console.log(`${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  if (failed > 0) process.exit(1);
}

run();
