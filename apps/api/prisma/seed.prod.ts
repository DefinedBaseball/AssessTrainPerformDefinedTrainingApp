/*
 * seed.prod.ts — PRODUCTION seed. Unlike seed.ts (the demo seed, which WIPES
 * the DB and creates fake coaches/players), this is idempotent and additive:
 * it never deletes anything, so it's safe to run on every deploy.
 *
 * It does two things:
 *   1. Ensures the 3 Admin coach accounts exist (connor/jacob/daniel). Their
 *      passwords default to "PasswordCoach" but can be overridden per-account
 *      via env (SEED_PW_CONNOR / SEED_PW_JACOB / SEED_PW_DANIEL) so the real
 *      launch passwords never have to live in the repo. On re-runs an existing
 *      account is left untouched (password not clobbered) — rotate via the app
 *      (Settings → Account) or by setting the env + redeploying.
 *   2. Seeds the curated Drill library (from drills.seed.ts) the first time
 *      only — skipped if the Drill table already has rows.
 *
 * Real players / MLB-video entries are created by the coach through the app
 * after first login (so we never fabricate player login credentials here).
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

/* The three Admin-level coach accounts that ship with the app. Passwords
   default to "PasswordCoach" but can be overridden per-account via env
   (SEED_PW_CONNOR / SEED_PW_JACOB / SEED_PW_DANIEL) so the real launch
   passwords never have to live in the repo. Rotate these at go-live. */
const ADMIN_ACCOUNTS = [
  { email: 'connor@definedbaseball.com', name: 'Connor Olson', envKey: 'SEED_PW_CONNOR', primary: true },
  { email: 'jacob@definedbaseball.com', name: 'Jacob', envKey: 'SEED_PW_JACOB', primary: false },
  { email: 'daniel@definedbaseball.com', name: 'Daniel', envKey: 'SEED_PW_DANIEL', primary: false },
];
const DEFAULT_ADMIN_PASSWORD = 'PasswordCoach';

async function main() {
  // 1. The three Admin coach accounts — create if missing; on re-runs ensure
  //    role/level/flags are right but never overwrite an existing password.
  for (const a of ADMIN_ACCOUNTS) {
    const email = a.email.toLowerCase();
    const password = process.env[a.envKey] || DEFAULT_ADMIN_PASSWORD;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email,
          password: hashPassword(password),
          role: 'COACH',
          coachLevel: 'ADMIN',
          status: 'ACTIVE',
          name: a.name,
          isPrimaryAdmin: a.primary,
        },
      });
      console.log(`[seed.prod] created ADMIN coach: ${email}`);
    } else {
      await prisma.user.update({
        where: { email },
        data: { role: 'COACH', coachLevel: 'ADMIN', status: 'ACTIVE', isPrimaryAdmin: a.primary },
      });
      console.log(`[seed.prod] ADMIN coach already exists: ${email} (password untouched)`);
    }
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
