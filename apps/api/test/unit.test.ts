/**
 * API Unit Tests
 *
 * Pure-function tests that don't need a running server or database.
 * Same custom runner pattern as api.test.ts.
 *
 * Run: npm run test:unit
 */

import { signJwt, verifyJwt } from '../src/modules/auth/jwt.util';
import { detectParser, getParserBySource, getRegisteredSources } from '../src/modules/uploads/parsers/parser-registry';
import { BlastMotionParser } from '../src/modules/uploads/parsers/blast-motion-parser';
import { TrackmanParser } from '../src/modules/uploads/parsers/trackman-parser';
import { HitTraxParser } from '../src/modules/uploads/parsers/hittrax-parser';

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
  await test('getRegisteredSources returns all 5 parsers', () => {
    const sources = getRegisteredSources();
    assertEqual(sources.length, 5, '5 parsers');
    assert(sources.includes('BLAST_MOTION'), 'has BLAST_MOTION');
    assert(sources.includes('TRACKMAN'), 'has TRACKMAN');
    assert(sources.includes('HITTRAX'), 'has HITTRAX');
    assert(sources.includes('VALD'), 'has VALD');
    assert(sources.includes('FULL_SWING'), 'has FULL_SWING');
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
    assertEqual(result.success.length, 2, '2 metrics extracted');
    const batSpeed = result.success.find(m => m.metricType === 'max_bat_speed');
    assert(batSpeed !== undefined, 'bat speed metric exists');
    assertEqual(batSpeed!.value, 72.5, 'bat speed value');
    assertEqual(batSpeed!.unit, 'mph', 'bat speed unit');
    assertEqual(batSpeed!.playerName, 'John Smith', 'player name');
  });

  await test('Blast parser reports row with no player name as error', () => {
    const parser = new BlastMotionParser();
    const rows = [
      { 'Player Name': '', 'Bat Speed (mph)': '70.0' },
    ];
    const result = parser.parse(rows, new Date());
    assertEqual(result.success.length, 0, 'no metrics');
    assertEqual(result.errors.length, 1, 'one error');
    assert(result.errors[0].message.includes('player name'), 'error mentions player name');
  });

  await test('Blast parser skips non-numeric values', () => {
    const parser = new BlastMotionParser();
    const rows = [
      { 'Player Name': 'X', 'Bat Speed (mph)': 'not-a-number', 'Attack Angle (deg)': '10' },
    ];
    const result = parser.parse(rows, new Date());
    assertEqual(result.success.length, 1, 'only numeric metric extracted');
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

async function hittraxParserTests() {
  await test('HitTrax parser is registered', () => {
    const p = getParserBySource('HITTRAX');
    assert(p !== null, 'HitTrax registered');
    assert(p instanceof HitTraxParser, 'correct class');
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
