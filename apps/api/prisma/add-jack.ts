/**
 * One-off script — creates the permanent "Jack Setterland" sandbox
 * player without touching any other rows in the database. Safe to
 * run against a populated dev DB.
 *
 *   npx ts-node --project prisma/tsconfig.seed.json prisma/add-jack.ts
 *
 * Re-running is a no-op (the upsert just normalizes Jack's record).
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(password + salt).digest('hex');
  return `${salt}:${hash}`;
}

async function main() {
  const email = 'jack.setterland@playerdev.com';
  console.log(`Ensuring permanent player ${email}…`);

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        password: hashPassword('player123'),
        role: 'PLAYER',
      },
    });
    console.log(`Created user ${user.id} for ${email}`);
  } else {
    console.log(`User ${user.id} already exists for ${email}`);
  }

  const existing = await prisma.player.findUnique({ where: { userId: user.id } });
  if (existing) {
    await prisma.player.update({
      where: { id: existing.id },
      data: { isPermanent: true },
    });
    console.log(`Player ${existing.id} (Jack Setterland) already exists — isPermanent normalized to true. Data left intact.`);
  } else {
    const created = await prisma.player.create({
      data: {
        userId: user.id,
        firstName: 'Jack',
        lastName: 'Setterland',
        positions: 'INF,OF',
        gradYear: 2026,
        heightInches: 72,
        weightLbs: 180,
        bats: 'R',
        throws: 'R',
        isPermanent: true,
      },
    });
    console.log(`Created permanent player ${created.id} (Jack Setterland).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
