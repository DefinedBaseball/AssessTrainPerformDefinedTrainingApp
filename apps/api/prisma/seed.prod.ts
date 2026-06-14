/*
 * seed.prod.ts — PRODUCTION seed. Unlike seed.ts (the demo seed, which WIPES
 * the DB and creates fake coaches/players), this is idempotent and additive:
 * it never deletes anything, so it's safe to run on every deploy.
 *
 * It does two things:
 *   1. Ensures the primary-admin coach exists. Credentials come from env
 *      (ADMIN_EMAIL + ADMIN_PASSWORD) so no password is ever hardcoded in the
 *      repo. On re-runs an existing admin is left untouched (password not
 *      clobbered).
 *   2. Seeds the curated Drill library (from drills.seed.ts) the first time
 *      only — skipped if the Drill table already has rows.
 *
 * Real players / MLB-video entries are created by the coach through the app
 * after first login (so we never fabricate player login credentials here).
 *
 * Run:  ADMIN_EMAIL=… ADMIN_PASSWORD=… node dist-or-ts seed.prod
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { DRILLS } from './drills.seed';

const prisma = new PrismaClient();

// Same scheme the demo seed + auth layer use: `${salt}:${sha256(pw+salt)}`.
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(password + salt).digest('hex');
  return `${salt}:${hash}`;
}

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = (process.env.ADMIN_NAME || 'Connor Olson').trim();

  if (!email || !password) {
    throw new Error(
      'seed.prod: ADMIN_EMAIL and ADMIN_PASSWORD must be set (set them in the host env). Aborting so no broken admin is created.',
    );
  }

  // 1. Primary-admin coach — create if missing, otherwise leave as-is.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        password: hashPassword(password),
        role: 'COACH',
        status: 'ACTIVE',
        name,
        isPrimaryAdmin: true,
      },
    });
    console.log(`[seed.prod] created primary-admin coach: ${email}`);
  } else {
    // Make sure the flag/role are right, but never overwrite their password.
    await prisma.user.update({
      where: { email },
      data: { role: 'COACH', status: 'ACTIVE', isPrimaryAdmin: true },
    });
    console.log(`[seed.prod] primary-admin coach already exists: ${email} (left password untouched)`);
  }

  // 2. Drill library — seed once (skip if any drills already present).
  const drillCount = await prisma.drill.count();
  if (drillCount === 0) {
    await prisma.drill.createMany({ data: DRILLS });
    console.log(`[seed.prod] seeded ${DRILLS.length} drills into the library`);
  } else {
    console.log(`[seed.prod] drill library already populated (${drillCount} rows) — skipped`);
  }

  console.log('[seed.prod] done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
