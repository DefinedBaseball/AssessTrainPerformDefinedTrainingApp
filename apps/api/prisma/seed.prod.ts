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
import { seedColleges } from './colleges.seed';

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

  // 3. Sample inquiries — seed a few the FIRST time only (skip if any exist) so
  //    the coach's Inquiry roster has data to review before the public inquiry
  //    form ships. These are clearly-fake demo rows (…@example.com) — delete
  //    them from the roster once real inquiries start coming in.
  const inquiryCount = await prisma.inquiry.count();
  if (inquiryCount === 0) {
    await prisma.inquiry.createMany({
      data: [
        {
          firstName: 'Mason', lastName: 'Reed', email: 'mason.reed.demo@example.com',
          phone: '(612) 555-0142', school: 'Wayzata High School', gradYear: 2027,
          clubTeam: 'Minnesota Blizzard', positions: 'SS,2B', birthDate: '2009-04-18',
          otherSports: 'Basketball', injuryHistory: 'Right elbow soreness, summer 2025 — fully cleared',
          otherHobbies: 'Fishing, video editing',
          goalLevel: 'College', goals: 'Play D1 middle infield. Want to add strength and get my exit velo up over the winter.',
          status: 'NEW',
        },
        {
          firstName: 'Ethan', lastName: 'Novak', email: 'ethan.novak.demo@example.com',
          phone: '(651) 555-0197', school: 'Eastview High School', gradYear: 2026,
          clubTeam: 'Gopher State Tide', positions: 'P,CF', birthDate: '2008-09-02',
          otherSports: 'Cross country', injuryHistory: 'None',
          otherHobbies: 'Golf',
          goalLevel: 'Professional', goals: 'Out of state — looking for remote programming and video review to keep velo climbing.',
          status: 'NEW',
        },
        {
          firstName: 'Caleb', lastName: 'Turner', email: 'caleb.turner.demo@example.com',
          phone: '(763) 555-0168', school: 'Maple Grove Senior High', gradYear: 2028,
          clubTeam: 'Miller Baseball', positions: 'C', birthDate: '2010-01-27',
          otherSports: 'Football (QB)', injuryHistory: 'Left knee sprain 2024 — no restrictions',
          otherHobbies: 'Drums',
          goalLevel: 'High School', goals: 'Make varsity as a sophomore. Want to cut down my pop time and get better at receiving.',
          status: 'NEW',
        },
      ],
    });
    console.log('[seed.prod] seeded 3 sample inquiries (demo — delete once the real form is live)');
  } else {
    console.log(`[seed.prod] inquiries already present (${inquiryCount}) — skipped`);
  }

  /* 4. College list — upsert the curated Minnesota programs by name. Unlike
   *    the drill/inquiry blocks above this is NOT gated on an empty table:
   *    it fills only missing fields on schools that already exist and never
   *    overwrites a curated division/website or touches logoUrl, so running
   *    it on every deploy is safe and keeps the list current as rows are
   *    added to colleges.seed.ts. */
  const collegeTally = await seedColleges(prisma);
  console.log(
    `[seed.prod] colleges: ${collegeTally.created} created, `
    + `${collegeTally.updated} back-filled, ${collegeTally.unchanged} already current`,
  );

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
