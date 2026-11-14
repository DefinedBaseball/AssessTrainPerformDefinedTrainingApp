import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { INTEGRATION_PROVIDERS, providerBySlug } from './integration-providers';
import { MOVE_PROVIDER, MoveProcessor } from './move/move.processor';
import { parseMoveSession } from './move/move-session';

/* ─────────────────────────────────────────────────────────────────────────
   Integrations: API keys for outside companies + the log of what they send.

   Keys look like  dbk_live_<40 random chars>  /  dbk_test_<...>. Only a
   SHA-256 of the key is stored (it is long and random, so a fast hash is
   safe); the plain key is returned once, at creation, and never again.

   Deliveries are stored UNTOUCHED (raw JSON text) so a partner can start
   sending before the data format is final -- we read what really arrives
   and build the mapping onto reports from that.
   ───────────────────────────────────────────────────────────────────────── */

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const MAX_PAYLOAD_CHARS = 2_000_000; // ~2 MB of JSON per delivery
const LABEL_MAX = 80;

export function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

function newKey(mode: 'live' | 'test'): string {
  const bytes = randomBytes(40);
  let s = '';
  for (const b of bytes) s += KEY_ALPHABET[b % KEY_ALPHABET.length];
  return `dbk_${mode}_${s}`;
}

export interface AuthedIntegrationKey {
  id: string;
  provider: string;
  label: string;
  mode: 'live' | 'test';
}

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService, private move: MoveProcessor) {}

  providers() {
    return INTEGRATION_PROVIDERS;
  }

  // ── Keys (admin) ──────────────────────────────────────────────────────

  async listKeys() {
    const keys = await this.prisma.integrationKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, provider: true, label: true, mode: true, keyPrefix: true,
        createdAt: true, lastUsedAt: true, revokedAt: true,
        _count: { select: { deliveries: true } },
      },
    });
    return keys.map(({ _count, ...k }) => ({ ...k, deliveries: _count.deliveries }));
  }

  async createKey(dto: { provider?: unknown; label?: unknown; mode?: unknown }, actorUserId?: string) {
    const provider = typeof dto?.provider === 'string' ? dto.provider : '';
    if (!providerBySlug(provider)) throw new BadRequestException('Pick an integration');
    const mode = dto?.mode === 'live' ? 'live' : dto?.mode === 'test' ? 'test' : null;
    if (!mode) throw new BadRequestException('Pick Test or Live');
    const label = (typeof dto?.label === 'string' ? dto.label.trim() : '').slice(0, LABEL_MAX)
      || `${providerBySlug(provider)!.label} (${mode})`;

    const key = newKey(mode);
    const row = await this.prisma.integrationKey.create({
      data: {
        provider, label, mode,
        keyHash: hashKey(key),
        keyPrefix: key.slice(0, 13), // "dbk_live_AbCd" -- enough to tell keys apart
        createdById: actorUserId ?? null,
      },
      select: { id: true, provider: true, label: true, mode: true, keyPrefix: true, createdAt: true },
    });
    /* The ONLY time the plain key leaves the server. */
    return { ...row, key };
  }

  async revokeKey(id: string) {
    const row = await this.prisma.integrationKey.findUnique({ where: { id }, select: { id: true, revokedAt: true } });
    if (!row) throw new NotFoundException('Key not found');
    if (row.revokedAt) return { ok: true, alreadyRevoked: true };
    await this.prisma.integrationKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  // ── Auth (partner requests) ───────────────────────────────────────────

  /** The live, un-revoked key behind a plain key string, or null. */
  async authenticate(plain: string): Promise<AuthedIntegrationKey | null> {
    if (!plain || !/^dbk_(live|test)_[A-Za-z0-9]{20,80}$/.test(plain)) return null;
    const row = await this.prisma.integrationKey.findUnique({
      where: { keyHash: hashKey(plain) },
      select: { id: true, provider: true, label: true, mode: true, revokedAt: true, lastUsedAt: true },
    });
    if (!row || row.revokedAt) return null;
    /* lastUsedAt at most once a minute -- no write per request. */
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      void this.prisma.integrationKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }
    return { id: row.id, provider: row.provider, label: row.label, mode: row.mode as 'live' | 'test' };
  }

  // ── Deliveries ────────────────────────────────────────────────────────

  /**
   * Store one delivery as received. `externalId` (the partner's own session
   * id, from the body or an Idempotency-Key header) makes a resend of the
   * same session a no-op rather than a duplicate.
   */
  async receive(key: AuthedIntegrationKey, kind: string, body: unknown, idempotencyKey?: string) {
    if (body === undefined || body === null || (typeof body === 'object' && Object.keys(body as object).length === 0)) {
      throw new BadRequestException('Send a JSON body');
    }
    const payload = JSON.stringify(body);
    if (payload.length > MAX_PAYLOAD_CHARS) throw new BadRequestException('That delivery is too large');

    const b = body as Record<string, unknown>;
    const fromBody = [b?.sessionId, b?.session_id, b?.id].find((v) => typeof v === 'string' || typeof v === 'number');
    const externalId = (idempotencyKey || (fromBody != null ? String(fromBody) : '')).trim().slice(0, 200) || null;

    if (externalId) {
      const dup = await this.prisma.integrationDelivery.findFirst({
        where: { keyId: key.id, kind, externalId },
        select: { id: true, createdAt: true },
      });
      if (dup) return { status: 'duplicate' as const, deliveryId: dup.id, receivedAt: dup.createdAt };
    }
    const row = await this.prisma.integrationDelivery.create({
      data: { keyId: key.id, provider: key.provider, mode: key.mode, kind, externalId, payload, status: 'received' },
      select: { id: true, createdAt: true },
    });
    /* Place it right away. The delivery is already stored, so a processing
       problem never fails the partner's request -- it shows in the log. */
    const processing = await this.processIfMapped(row.id, key.provider, kind);
    return { status: 'received' as const, deliveryId: row.id, receivedAt: row.createdAt, ...(processing ? { processing } : {}) };
  }

  /** Run the provider's mapping, if it has one. Returns the outcome status. */
  private async processIfMapped(deliveryId: string, provider: string, kind: string): Promise<string | null> {
    if (provider !== MOVE_PROVIDER || kind !== 'sessions') return null;
    try {
      return (await this.move.process(deliveryId)).status;
    } catch {
      return 'error';
    }
  }

  /** Admin: process (again) one delivery -- e.g. one stored before mapping existed. */
  async reprocess(id: string) {
    const d = await this.prisma.integrationDelivery.findUnique({ where: { id }, select: { id: true, provider: true, kind: true } });
    if (!d) throw new NotFoundException('Delivery not found');
    const status = await this.processIfMapped(d.id, d.provider, d.kind);
    if (!status) throw new BadRequestException('This kind of delivery is not mapped yet');
    return this.getDelivery(id);
  }

  /**
   * Admin: "this MOVE player is that athlete". Saves the link for MOVE's
   * externalId and moveId, then places this delivery and every other
   * unmatched one (they may be the same athlete).
   */
  async linkAthlete(id: string, playerId: unknown, actorUserId?: string) {
    if (typeof playerId !== 'string' || !playerId) throw new BadRequestException('Pick an athlete');
    const d = await this.prisma.integrationDelivery.findUnique({ where: { id }, select: { id: true, provider: true, payload: true } });
    if (!d) throw new NotFoundException('Delivery not found');
    if (d.provider !== MOVE_PROVIDER) throw new BadRequestException('Only MOVE deliveries can be linked');
    const player = await this.prisma.player.findUnique({ where: { id: playerId }, select: { id: true } });
    if (!player) throw new NotFoundException('Athlete not found');
    let refs: string[];
    try {
      const s = parseMoveSession(JSON.parse(d.payload));
      refs = [s.externalId, s.moveId].filter((r): r is string => !!r).map((r) => r.toLowerCase());
    } catch (err: any) {
      throw new BadRequestException(`Can not read this delivery: ${err?.message || err}`);
    }
    for (const externalRef of refs) {
      await this.prisma.integrationAthleteLink.upsert({
        where: { provider_externalRef: { provider: MOVE_PROVIDER, externalRef } },
        create: { provider: MOVE_PROVIDER, externalRef, playerId, createdById: actorUserId ?? null },
        update: { playerId, createdById: actorUserId ?? null },
      });
    }
    await this.move.process(d.id);
    await this.move.retryUnmatched();
    return this.getDelivery(id);
  }

  /** Admin: the saved "outside account = athlete" links. */
  async listLinks(provider = MOVE_PROVIDER) {
    const rows = await this.prisma.integrationAthleteLink.findMany({
      where: { provider },
      orderBy: { createdAt: 'desc' },
      select: { id: true, provider: true, externalRef: true, createdAt: true, player: { select: { id: true, firstName: true, lastName: true } } },
    });
    return rows.map(({ player, ...r }) => ({ ...r, playerId: player.id, athlete: `${player.firstName} ${player.lastName}`.trim() }));
  }

  async removeLink(id: string) {
    await this.prisma.integrationAthleteLink.deleteMany({ where: { id } });
    return { ok: true };
  }

  /**
   * Coach: set an athlete's Athlete ID (the secondary ID outside apps can
   * send instead of the email). Upper-cased; blank clears it. Unmatched MOVE
   * sessions are retried afterwards.
   */
  async setAthleteCode(playerId: string, raw: unknown) {
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (code && !/^[A-Z0-9][A-Z0-9._@-]{0,79}$/.test(code)) {
      throw new BadRequestException('Athlete ID: letters, numbers, and . _ - @ only (80 max)');
    }
    const player = await this.prisma.player.findUnique({ where: { id: playerId }, select: { id: true } });
    if (!player) throw new NotFoundException('Athlete not found');
    if (code) {
      const taken = await this.prisma.player.findFirst({ where: { athleteCode: code }, select: { id: true, firstName: true, lastName: true } });
      if (taken && taken.id !== playerId) {
        throw new ConflictException(`${taken.firstName} ${taken.lastName} already has Athlete ID ${code}`);
      }
    }
    await this.prisma.player.update({ where: { id: playerId }, data: { athleteCode: code || null } });
    const placed = code ? await this.move.retryUnmatched() : 0;
    return { athleteCode: code || null, placed };
  }

  async listDeliveries(opts: { provider?: string; limit?: number }) {
    const take = Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 50, 1), 200);
    const rows = await this.prisma.integrationDelivery.findMany({
      where: opts.provider ? { provider: opts.provider } : {},
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, provider: true, mode: true, kind: true, externalId: true, status: true, createdAt: true, payload: true,
        playerId: true, reportId: true, result: true, processedAt: true,
        key: { select: { label: true, keyPrefix: true } },
      },
    });
    return rows.map(({ payload, key, result, ...r }) => ({
      ...r,
      keyLabel: key?.label ?? null,
      keyPrefix: key?.keyPrefix ?? null,
      bytes: payload.length,
      preview: payload.slice(0, 280),
      result: parseResult(result),
    }));
  }

  async getDelivery(id: string) {
    const row = await this.prisma.integrationDelivery.findUnique({
      where: { id },
      include: { key: { select: { label: true, keyPrefix: true } } },
    });
    if (!row) throw new NotFoundException('Delivery not found');
    let json: unknown = null;
    try { json = JSON.parse(row.payload); } catch { /* stored as sent */ }
    const { payload, key, result, ...rest } = row;
    return { ...rest, keyLabel: key?.label ?? null, keyPrefix: key?.keyPrefix ?? null, result: parseResult(result), payload: json ?? payload };
  }

  /** Clear TEST deliveries (live data is never bulk-deleted). */
  async clearTestDeliveries(provider?: string) {
    const r = await this.prisma.integrationDelivery.deleteMany({
      where: { mode: 'test', ...(provider ? { provider } : {}) },
    });
    return { deleted: r.count };
  }
}

function parseResult(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { note: raw }; }
}
