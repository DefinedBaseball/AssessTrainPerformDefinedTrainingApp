import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { DRILLS } from './drills.seed';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(password + salt).digest('hex');
  return `${salt}:${hash}`;
}

async function main() {
  console.log('Seeding database...');

  // Clean existing data (order matters for foreign keys).
  // PERMANENT PLAYERS ARE PRESERVED — Jack Setterland (and any other
  // player flagged `isPermanent`) keeps their record + every linked
  // metric / report / video / etc. through re-seeds, so coach-uploaded
  // data on the sandbox player isn't wiped each time `db:seed` runs.
  console.log('Cleaning existing data...');

  const permanentPlayers = await prisma.player.findMany({
    where: { isPermanent: true },
    select: { id: true, userId: true },
  });
  const keepPlayerIds = permanentPlayers.map((p) => p.id);
  const keepUserIds = permanentPlayers.map((p) => p.userId);
  // `notIn: []` matches every row in Prisma → without permanent
  // players the conditions become "delete every row", which is the
  // pre-permanent behavior. With permanent players present, every
  // row tied to one of those IDs is spared.
  const wherePlayer = { playerId: { notIn: keepPlayerIds } };
  const whereUploadedBy = { uploadedById: { notIn: keepPlayerIds } };

  await prisma.mlbVideo.deleteMany();
  await prisma.mlbPlayer.deleteMany();
  await prisma.eduClass.deleteMany();
  await prisma.scheduledDrill.deleteMany({ where: wherePlayer });
  await prisma.drill.deleteMany();
  await prisma.leaderboardEntry.deleteMany({ where: wherePlayer });
  await prisma.gameReport.deleteMany({ where: wherePlayer });
  await prisma.trainingExercise.deleteMany();
  await prisma.trainingDay.deleteMany();
  await prisma.trainingProgram.deleteMany({ where: wherePlayer });
  await prisma.voiceOver.deleteMany();
  await prisma.annotation.deleteMany();
  await prisma.video.deleteMany({ where: { AND: [wherePlayer, whereUploadedBy] } });
  await prisma.report.deleteMany({ where: wherePlayer });
  await prisma.metric.deleteMany({ where: wherePlayer });
  await prisma.csvUpload.deleteMany();
  await prisma.post.deleteMany();
  await prisma.player.deleteMany({ where: { isPermanent: false } });
  await prisma.user.deleteMany({ where: { id: { notIn: keepUserIds } } });

  // Create coach user
  const coachUser = await prisma.user.create({
    data: {
      email: 'coach@playerdev.com',
      password: hashPassword('coach123'),
      role: 'COACH',
    },
  });
  const coach = await prisma.player.create({
    data: {
      userId: coachUser.id,
      firstName: 'Mike',
      lastName: 'Johnson',
      positions: 'COACH',
    },
  });

  // Create sample players
  const playersData = [
    { first: 'John', last: 'Smith', positions: 'INF,OF', gradYear: 2026, height: 73, weight: 185, email: 'john@playerdev.com' },
    { first: 'Tyler', last: 'Davis', positions: 'P,INF', gradYear: 2026, height: 75, weight: 195, email: 'tyler@playerdev.com' },
    { first: 'Ryan', last: 'Martinez', positions: 'C', gradYear: 2027, height: 71, weight: 200, email: 'ryan@playerdev.com' },
    { first: 'Jake', last: 'Williams', positions: 'OF', gradYear: 2026, height: 74, weight: 180, email: 'jake@playerdev.com' },
    { first: 'Cole', last: 'Anderson', positions: 'P', gradYear: 2027, height: 76, weight: 190, email: 'cole@playerdev.com' },
    { first: 'Dylan', last: 'Thomas', positions: 'INF', gradYear: 2028, height: 70, weight: 170, email: 'dylan@playerdev.com' },
    { first: 'Bryce', last: 'Wilson', positions: 'OF,INF', gradYear: 2026, height: 72, weight: 175, email: 'bryce@playerdev.com' },
    { first: 'Mason', last: 'Brown', positions: 'C,INF', gradYear: 2027, height: 73, weight: 205, email: 'mason@playerdev.com' },
    { first: 'Ethan', last: 'Taylor', positions: 'P,OF', gradYear: 2028, height: 77, weight: 200, email: 'ethan@playerdev.com' },
    { first: 'Luke', last: 'Garcia', positions: 'INF', gradYear: 2026, height: 71, weight: 178, email: 'luke@playerdev.com' },
  ];

  const players = [];
  for (const p of playersData) {
    const user = await prisma.user.create({
      data: { email: p.email, password: hashPassword('player123'), role: 'PLAYER' },
    });
    const player = await prisma.player.create({
      data: {
        userId: user.id,
        firstName: p.first,
        lastName: p.last,
        positions: p.positions,
        gradYear: p.gradYear,
        heightInches: p.height,
        weightLbs: p.weight,
        pbrNational: Math.floor(Math.random() * 500) + 1,
        pbrState: Math.floor(Math.random() * 50) + 1,
        pgScore: Math.round((7 + Math.random() * 3) * 10) / 10,
      },
    });
    players.push(player);
  }

  console.log(`Created ${players.length} players`);

  // ── Jack Setterland (sandbox / permanent player) ──
  // Created once via upsert so re-running this seed keeps his record
  // (and every metric, report, video uploaded to him) intact. The
  // cleanup phase above already spares any player flagged
  // `isPermanent`, but we still upsert here so a freshly-cleared
  // database also gets Jack on first seed.
  const jackEmail = 'jack.setterland@playerdev.com';
  let jackUser = await prisma.user.findUnique({ where: { email: jackEmail } });
  if (!jackUser) {
    jackUser = await prisma.user.create({
      data: {
        email: jackEmail,
        password: hashPassword('player123'),
        role: 'PLAYER',
      },
    });
  }
  const jackExisting = await prisma.player.findUnique({ where: { userId: jackUser.id } });
  if (jackExisting) {
    // Re-seed run — Jack already exists and his data is preserved.
    // Just normalize the flag in case it ever drifted to false.
    await prisma.player.update({
      where: { id: jackExisting.id },
      data: { isPermanent: true },
    });
    console.log('Permanent player Jack Setterland already exists — preserved with data intact.');
  } else {
    await prisma.player.create({
      data: {
        userId: jackUser.id,
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
    console.log('Created permanent player Jack Setterland.');
  }

  // Seed metrics, CsvUploads, and Reports for each player
  // Helper: add random variation to a grade (±range, clamped 20-80)
  function varyGrade(base: number, range = 5): number {
    return Math.max(20, Math.min(80, base + Math.floor(Math.random() * (range * 2 + 1)) - range));
  }

  const now = new Date();
  for (const player of players) {
    const positions = player.positions.split(',');
    const isHitter = positions.some(p => ['INF', 'OF', 'C'].includes(p));
    const isPitcher = positions.includes('P');
    const isCatcher = positions.includes('C');
    const isInfielder = positions.includes('INF');
    const isOutfielder = positions.includes('OF');

    // ── Create CsvUpload records per data source ──

    let fullSwingUpload: { id: string } | null = null;
    let blastUpload: { id: string } | null = null;
    let hitTraxUpload: { id: string } | null = null;
    let trackmanUpload: { id: string } | null = null;
    let valdUpload: { id: string } | null = null;
    let manualUpload: { id: string } | null = null;

    if (isHitter) {
      fullSwingUpload = await prisma.csvUpload.create({
        data: {
          uploadedById: coachUser.id,
          source: 'FULL_SWING',
          fileUrl: `s3://player-dev/uploads/${player.id}/full_swing_session.csv`,
          status: 'COMPLETED',
          totalRows: 200,
          successRows: 200,
        },
      });
      blastUpload = await prisma.csvUpload.create({
        data: {
          uploadedById: coachUser.id,
          source: 'BLAST_MOTION',
          fileUrl: `s3://player-dev/uploads/${player.id}/blast_motion_session.csv`,
          status: 'COMPLETED',
          totalRows: 64,
          successRows: 64,
        },
      });
      hitTraxUpload = await prisma.csvUpload.create({
        data: {
          uploadedById: coachUser.id,
          source: 'HITTRAX',
          fileUrl: `s3://player-dev/uploads/${player.id}/hittrax_session.csv`,
          status: 'COMPLETED',
          totalRows: 8,
          successRows: 8,
        },
      });
    }

    if (isPitcher) {
      trackmanUpload = await prisma.csvUpload.create({
        data: {
          uploadedById: coachUser.id,
          source: 'TRACKMAN',
          fileUrl: `s3://player-dev/uploads/${player.id}/trackman_session.csv`,
          status: 'COMPLETED',
          totalRows: 48,
          successRows: 48,
        },
      });
    }

    // Everyone gets VALD
    valdUpload = await prisma.csvUpload.create({
      data: {
        uploadedById: coachUser.id,
        source: 'VALD',
        fileUrl: `s3://player-dev/uploads/${player.id}/vald_session.csv`,
        status: 'COMPLETED',
        totalRows: 8,
        successRows: 8,
      },
    });

    // Manual metrics (infield_velo, outfield_velo, catcher metrics) get a FULL_SWING upload
    // as a catch-all — or we create a dedicated one. We'll reuse fullSwingUpload for manual
    // hitter-adjacent metrics if available, otherwise create a generic upload for manual data.
    if (isInfielder || isOutfielder || isCatcher) {
      if (!manualUpload) {
        // Use the fullSwingUpload if available, otherwise create a generic one
        // For manual metrics we just need an uploadId to link them
        manualUpload = fullSwingUpload;
      }
    }

    // ── Generate metrics over the last 8 sessions (spread over 2 months) ──

    for (let session = 0; session < 8; session++) {
      const date = new Date(now);
      date.setDate(date.getDate() - session * 7);

      if (isHitter) {
        const baseEV = 80 + Math.random() * 15;
        const baseBS = 60 + Math.random() * 15;
        const metrics = [
          { type: 'max_exit_velo', value: baseEV + 5 + session * 0.3, unit: 'mph', source: 'FULL_SWING' },
          { type: 'avg_exit_velo', value: baseEV + session * 0.2, unit: 'mph', source: 'FULL_SWING' },
          { type: 'max_bat_speed', value: baseBS + 3 + session * 0.2, unit: 'mph', source: 'BLAST_MOTION' },
          { type: 'avg_bat_speed', value: baseBS + session * 0.15, unit: 'mph', source: 'BLAST_MOTION' },
          { type: 'squared_up_pct', value: 30 + Math.random() * 25, unit: '%', source: 'FULL_SWING' },
          { type: 'attack_angle', value: 8 + Math.random() * 10, unit: 'deg', source: 'BLAST_MOTION' },
          { type: 'plane_angle', value: 28 + Math.random() * 12, unit: 'deg', source: 'BLAST_MOTION' },
        ];
        for (const m of metrics) {
          const uploadId = m.source === 'FULL_SWING' ? fullSwingUpload!.id : blastUpload!.id;
          await prisma.metric.create({
            data: {
              playerId: player.id,
              source: m.source,
              metricType: m.type,
              value: Math.round(m.value * 10) / 10,
              unit: m.unit,
              recordedAt: date,
              uploadId,
            },
          });
        }

        // Full Swing per-pitch data (bat_speed, smash_factor, spray_angle, distance)
        const pitchCount = 15 + Math.floor(Math.random() * 10);
        for (let p = 0; p < pitchCount; p++) {
          const pitchDate = new Date(date.getTime() + p * 8000); // 8 sec apart
          const ev = baseEV - 5 + Math.random() * 20;
          const la = -10 + Math.random() * 40;
          const dir = -35 + Math.random() * 70; // spray angle
          const dist = Math.max(10, ev * (1.5 + Math.random()) * Math.max(0.1, Math.cos(la * Math.PI / 180)));
          const bs = baseBS - 3 + Math.random() * 12;
          const sf = ev / Math.max(40, bs - 5 + Math.random() * 10);
          const sq = 0.5 + Math.random() * 0.5;
          const pitchMetrics = [
            { type: 'max_exit_velo', value: ev, unit: 'mph' },
            { type: 'launch_angle', value: la, unit: 'deg' },
            { type: 'spray_angle', value: dir, unit: 'deg' },
            { type: 'distance', value: dist, unit: 'ft' },
            { type: 'bat_speed', value: bs, unit: 'mph' },
            { type: 'smash_factor', value: sf, unit: '' },
            { type: 'squared_up_pct', value: sq * 100, unit: '%' },
          ];
          for (const m of pitchMetrics) {
            await prisma.metric.create({
              data: {
                playerId: player.id,
                source: 'FULL_SWING',
                metricType: m.type,
                value: Math.round(m.value * 100) / 100,
                unit: m.unit,
                recordedAt: pitchDate,
                uploadId: fullSwingUpload!.id,
              },
            });
          }
        }

        // HitTrax metrics
        await prisma.metric.create({
          data: { playerId: player.id, source: 'HITTRAX', metricType: 'max_exit_velo', value: Math.round((baseEV + 6 + session * 0.3) * 10) / 10, unit: 'mph', recordedAt: date, uploadId: hitTraxUpload!.id },
        });
      }

      if (isPitcher) {
        const baseFB = 82 + Math.random() * 12;
        const pitchMetrics = [
          { type: 'fb_max_velo', value: baseFB + 3 + session * 0.2, unit: 'mph' },
          { type: 'fb_avg_velo', value: baseFB + session * 0.15, unit: 'mph' },
          { type: 'h_break', value: -12 + Math.random() * 8, unit: 'in' },
          { type: 'v_break', value: 12 + Math.random() * 8, unit: 'in' },
          { type: 'release_height', value: 5.5 + Math.random() * 0.8, unit: 'ft' },
          { type: 'extension', value: 5.8 + Math.random() * 1.2, unit: 'ft' },
        ];
        for (const m of pitchMetrics) {
          await prisma.metric.create({
            data: {
              playerId: player.id,
              source: 'TRACKMAN',
              metricType: m.type,
              value: Math.round(m.value * 10) / 10,
              unit: m.unit,
              recordedAt: date,
              uploadId: trackmanUpload!.id,
            },
          });
        }
      }

      if (isCatcher) {
        const catcherUploadId = manualUpload?.id ?? fullSwingUpload?.id;
        await prisma.metric.create({
          data: { playerId: player.id, source: 'MANUAL', metricType: 'pop_time', value: Math.round((1.85 + Math.random() * 0.3) * 100) / 100, unit: 'sec', recordedAt: date, uploadId: catcherUploadId },
        });
        await prisma.metric.create({
          data: { playerId: player.id, source: 'MANUAL', metricType: 'exchange_time', value: Math.round((0.65 + Math.random() * 0.15) * 100) / 100, unit: 'sec', recordedAt: date, uploadId: catcherUploadId },
        });
        await prisma.metric.create({
          data: { playerId: player.id, source: 'MANUAL', metricType: 'catcher_velo', value: Math.round((72 + Math.random() * 10) * 10) / 10, unit: 'mph', recordedAt: date, uploadId: catcherUploadId },
        });
      }

      // Defensive metrics for fielders
      if (isInfielder) {
        await prisma.metric.create({
          data: { playerId: player.id, source: 'MANUAL', metricType: 'infield_velo', value: Math.round((76 + Math.random() * 10) * 10) / 10, unit: 'mph', recordedAt: date, uploadId: manualUpload?.id ?? fullSwingUpload?.id },
        });
      }
      if (isOutfielder) {
        await prisma.metric.create({
          data: { playerId: player.id, source: 'MANUAL', metricType: 'outfield_velo', value: Math.round((82 + Math.random() * 12) * 10) / 10, unit: 'mph', recordedAt: date, uploadId: manualUpload?.id ?? fullSwingUpload?.id },
        });
      }

      // VALD physical metrics (everyone gets these)
      await prisma.metric.create({
        data: { playerId: player.id, source: 'VALD', metricType: 'jump_height', value: Math.round((24 + Math.random() * 8) * 10) / 10, unit: 'in', recordedAt: date, uploadId: valdUpload!.id },
      });
    }

    // ── Create Report records for this player ──

    if (isHitter) {
      await prisma.report.create({
        data: {
          playerId: player.id,
          createdById: coachUser.id,
          reportType: 'HITTING',
          content: JSON.stringify({
            csvUploads: {
              fullswing: { uploadId: fullSwingUpload!.id },
              blast: { uploadId: blastUpload!.id },
            },
          }),
          notes: 'Seed hitting report',
        },
      });
    }

    if (isPitcher) {
      await prisma.report.create({
        data: {
          playerId: player.id,
          createdById: coachUser.id,
          reportType: 'PITCHING',
          content: JSON.stringify({
            csvUploads: {
              trackman: { uploadId: trackmanUpload!.id },
            },
          }),
          notes: 'Seed pitching report',
        },
      });
    }

    if (isCatcher) {
      await prisma.report.create({
        data: {
          playerId: player.id,
          createdById: coachUser.id,
          reportType: 'CATCHING',
          content: JSON.stringify({
            catchingAssessment: {
              throwing: {
                popTime2B: { attempts: [1.95, 1.92, 1.98], best: 1.92, avg: 1.95, notes: '' },
                popTime3B: { attempts: [1.42, 1.38, 1.45], best: 1.38, avg: 1.42, notes: '' },
                exchangeTime: { attempts: [0.72, 0.68, 0.75], best: 0.68, avg: 0.72, notes: '' },
                velocity: { attempts: [75, 77, 74], best: 77, avg: 75.3, notes: '' },
                overallGrade: varyGrade(55),
              },
              receiving: {
                topOfZone: { grade: varyGrade(55), notes: '' },
                bottomOfZone: { grade: varyGrade(50), notes: '' },
                gloveSide: { grade: varyGrade(60), notes: '' },
                armSide: { grade: varyGrade(50), notes: '' },
                quietHands: { grade: varyGrade(55), notes: '' },
                stanceSetup: { grade: varyGrade(60), notes: '' },
                overallGrade: varyGrade(55),
              },
              blocking: {
                range: { grade: varyGrade(50), notes: '' },
                accuracy: { grade: varyGrade(55), notes: '' },
                gloveBodyAngle: { grade: varyGrade(50), notes: '' },
                overallGrade: varyGrade(52),
              },
            },
          }),
          notes: 'Seed catching report',
        },
      });
    }

    if (isInfielder) {
      await prisma.report.create({
        data: {
          playerId: player.id,
          createdById: coachUser.id,
          reportType: 'INFIELD',
          content: JSON.stringify({
            infieldAssessment: {
              arm: {
                velocity: { attempts: [82, 84, 81], best: 84, avg: 82.3, notes: '' },
                accuracy: { attempts: [null, null, null], best: null, avg: null, notes: '' },
              },
              rangeFootwork: {
                jumps: { grade: varyGrade(55), notes: '' },
                routes: { grade: varyGrade(50), notes: '' },
                rangeGloveSide: { grade: varyGrade(55), notes: '' },
                rangeArmSide: { grade: varyGrade(50), notes: '' },
                breakdownFootwork: { grade: varyGrade(55), notes: '' },
                athleticism: { grade: varyGrade(60), notes: '' },
                overallGrade: varyGrade(54),
              },
              handsGlove: {
                exchanges: { grade: varyGrade(55), notes: '' },
                shortHops: { grade: varyGrade(50), notes: '' },
                forehand: { grade: varyGrade(55), notes: '' },
                backhand: { grade: varyGrade(50), notes: '' },
                doublePlays: { grade: varyGrade(55), notes: '' },
                overallGrade: varyGrade(53),
              },
            },
          }),
          notes: 'Seed infield report',
        },
      });
    }

    if (isOutfielder) {
      await prisma.report.create({
        data: {
          playerId: player.id,
          createdById: coachUser.id,
          reportType: 'OUTFIELD',
          content: JSON.stringify({
            outfieldAssessment: {
              arm: {
                velocity: { attempts: [88, 90, 87], best: 90, avg: 88.3, notes: '' },
                crowHop: { attempts: [null, null, null], best: null, avg: null, notes: '' },
                releaseTime: { attempts: [null, null, null], best: null, avg: null, notes: '' },
                accuracy: { attempts: [null, null, null], best: null, avg: null, notes: '' },
                overallGrade: varyGrade(55),
              },
              routesReads: {
                firstStepJump: { grade: varyGrade(55), notes: '' },
                flyBallBack: { grade: varyGrade(50), notes: '' },
                flyBallIn: { grade: varyGrade(55), notes: '' },
                lineDriveRead: { grade: varyGrade(50), notes: '' },
                routes: { grade: varyGrade(55), notes: '' },
                range: { grade: varyGrade(60), notes: '' },
                gloveWork: { grade: varyGrade(55), notes: '' },
                overallGrade: varyGrade(54),
              },
            },
          }),
          notes: 'Seed outfield report',
        },
      });
    }

    // Everyone gets a STRENGTH report (VALD)
    await prisma.report.create({
      data: {
        playerId: player.id,
        createdById: coachUser.id,
        reportType: 'STRENGTH',
        content: JSON.stringify({
          csvUploads: {
            vald: { uploadId: valdUpload!.id },
          },
        }),
        notes: 'Seed strength & conditioning report',
      },
    });
  }

  console.log('Metrics seeded');

  // Seed a training program for the first player
  const program = await prisma.trainingProgram.create({
    data: {
      playerId: players[0].id,
      name: 'Spring Training 2026',
      startDate: new Date(2026, 2, 1),
      endDate: new Date(2026, 4, 31),
    },
  });

  // Add a few training days
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 2) {
    const dayDate = new Date(2026, 3, 1 + dayOffset);
    const day = await prisma.trainingDay.create({
      data: { programId: program.id, date: dayDate },
    });

    const categories = ['HITTING', 'DEFENSIVE', 'PITCHING', 'WEIGHTROOM'];
    const dayCategories = categories.slice(0, 2 + (dayOffset % 3));

    for (const cat of dayCategories) {
      await prisma.trainingExercise.create({
        data: {
          dayId: day.id,
          category: cat,
          name: `${cat.charAt(0) + cat.slice(1).toLowerCase()} Drill ${dayOffset + 1}`,
          description: `Standard ${cat.toLowerCase()} workout`,
          sortOrder: dayCategories.indexOf(cat),
        },
      });
    }
  }

  console.log('Training programs seeded');

  // ─── Seed Drill Library ─────────────────────────────────────────
  console.log('Seeding drill library...');
  await prisma.scheduledDrill.deleteMany();
  await prisma.drill.deleteMany();

  // Drill library is generated from the coaches' Drills Workbook (drills.seed.ts).
  const drillsData = DRILLS;
  // Legacy hand-written demo drills below — superseded; kept for reference, not inserted.
  const _legacyDemoDrills = [
    // Hitting drills
    { name: 'Dynamic Warmup', tab: 'hitting', category: 'Movement Prep', description: 'Full body dynamic stretching routine' },
    { name: 'Band Work — Shoulders', tab: 'hitting', category: 'Movement Prep', description: 'Resistance band shoulder activation' },
    { name: 'Core Activation', tab: 'hitting', category: 'Movement Prep', description: 'Core engagement exercises for swing stability' },
    { name: 'Tee Work — Inside/Out', tab: 'hitting', category: 'Drills', description: 'Focus on inside-out swing path using tee' },
    { name: 'Tee Work — Opposite Field', tab: 'hitting', category: 'Drills', description: 'Drive balls to opposite field off tee' },
    { name: 'Tee Work — Elevated', tab: 'hitting', category: 'Drills', description: 'Tee set at top of zone for high pitch practice' },
    { name: 'Flip Drills — Front Toss', tab: 'hitting', category: 'Drills', description: 'Soft toss from front for timing work' },
    { name: 'Flip Drills — Side Toss', tab: 'hitting', category: 'Drills', description: 'Lateral soft toss for bat path work' },
    { name: 'One-Handed Drill', tab: 'hitting', category: 'Drills', description: 'Single arm swing isolation' },
    { name: 'Walking Drill', tab: 'hitting', category: 'Drills', description: 'Rhythm and weight transfer drill' },
    { name: 'Overload/Underload', tab: 'hitting', category: 'Drills', description: 'Heavy/light bat speed training' },
    { name: 'Connection Ball', tab: 'hitting', category: 'Drills', description: 'Connection ball between forearms for swing connection' },
    { name: 'Batting Practice — Fastball', tab: 'hitting', category: 'Batting Practice', description: 'Live BP focusing on fastball' },
    { name: 'Batting Practice — Off-Speed', tab: 'hitting', category: 'Batting Practice', description: 'Live BP with off-speed pitches' },
    { name: 'Batting Practice — Mixed', tab: 'hitting', category: 'Batting Practice', description: 'Mixed pitch BP session' },
    { name: 'Situational BP', tab: 'hitting', category: 'Batting Practice', description: 'Practice with specific count and situation scenarios' },
    { name: 'Machine BP — Fastball', tab: 'hitting', category: 'Machine', description: 'Pitching machine work — fastball sequences' },
    { name: 'Machine BP — Breaking Ball', tab: 'hitting', category: 'Machine', description: 'Pitching machine work — curveball/slider' },
    { name: 'Machine BP — Changeup', tab: 'hitting', category: 'Machine', description: 'Pitching machine work — off-speed' },
    { name: 'Machine BP — Velocity Ladder', tab: 'hitting', category: 'Machine', description: 'Progressive velocity increase on machine' },

    // Pitching drills
    { name: 'Arm Care Circuit', tab: 'pitching', category: 'Movement Prep', description: 'Band work, J-band, and arm circles' },
    { name: 'Dynamic Warmup', tab: 'pitching', category: 'Movement Prep', description: 'Pitcher-specific dynamic stretching' },
    { name: 'Long Toss', tab: 'pitching', category: 'Drills', description: 'Progressive distance throwing program' },
    { name: 'Flat Ground Work', tab: 'pitching', category: 'Drills', description: 'Mechanical work from flat ground' },
    { name: 'Towel Drills', tab: 'pitching', category: 'Drills', description: 'Towel drill for extension and finish' },
    { name: 'Rocker Drill', tab: 'pitching', category: 'Drills', description: 'Hip and weight transfer drill from windup' },
    { name: 'Pick-off Work', tab: 'pitching', category: 'Drills', description: 'First and second base pick-off moves' },
    { name: 'PFP — Pitchers Fielding Practice', tab: 'pitching', category: 'Drills', description: 'Fielding bunts, covering first, double plays' },
    { name: 'Spin Rate Work', tab: 'pitching', category: 'Drills', description: 'Focus on maximizing spin and movement' },
    { name: 'Command Work', tab: 'pitching', category: 'Drills', description: 'Pitch location and zone targeting' },
    { name: 'Bullpen — Fastball', tab: 'pitching', category: 'Bullpen', description: 'Bullpen session focusing on fastball command' },
    { name: 'Bullpen — Full Mix', tab: 'pitching', category: 'Bullpen', description: 'Full pitch arsenal bullpen session' },
    { name: 'Bullpen — Situational', tab: 'pitching', category: 'Bullpen', description: 'Simulate game situations during bullpen' },
    { name: 'Live ABs', tab: 'pitching', category: 'Live', description: 'Live at-bats against hitters' },
    { name: 'Simulated Game', tab: 'pitching', category: 'Live', description: 'Full simulated game outing with pitch count' },
    { name: 'Intrasquad', tab: 'pitching', category: 'Live', description: 'Intrasquad game appearance' },

    // Defense drills
    { name: 'Dynamic Warmup', tab: 'defense', category: 'Movement Prep', description: 'Defensive-specific agility warmup' },
    { name: 'Cone Agility', tab: 'defense', category: 'Movement Prep', description: 'Cone drills for lateral quickness' },
    { name: 'Ground Ball Work — Forehand', tab: 'defense', category: 'Drills', description: 'Fielding ground balls to glove side' },
    { name: 'Ground Ball Work — Backhand', tab: 'defense', category: 'Drills', description: 'Fielding ground balls to throwing side' },
    { name: 'Ground Ball Work — Slow Roller', tab: 'defense', category: 'Drills', description: 'Charging and barehanding slow rollers' },
    { name: 'Double Play Feeds', tab: 'defense', category: 'Drills', description: 'Turning double plays from various positions' },
    { name: 'Pop Time Work', tab: 'defense', category: 'Drills', description: 'Catcher throw-down timing and accuracy' },
    { name: 'Blocking Fundamentals', tab: 'defense', category: 'Drills', description: 'Catcher blocking drills in the dirt' },
    { name: 'Receiving / Framing', tab: 'defense', category: 'Drills', description: 'Pitch framing and presentation' },
    { name: 'Footwork Patterns', tab: 'defense', category: 'Drills', description: 'Infield footwork for throws across diamond' },
    { name: 'Relay and Cutoff', tab: 'defense', category: 'Drills', description: 'Outfield relay and cutoff positioning' },
    { name: 'Fly Ball Reads', tab: 'defense', category: 'Drills', description: 'Outfield first step and route work' },
    { name: 'Fence Drill', tab: 'defense', category: 'Drills', description: 'Playing balls at the fence safely' },
    { name: 'Live Defense — Fungo', tab: 'defense', category: 'Live', description: 'Live fungo defensive reps' },
    { name: 'Live Defense — BP', tab: 'defense', category: 'Live', description: 'Fielding during live batting practice' },

    // Pitching — Post-Throw
    { name: 'Band Work — Recovery', tab: 'pitching', category: 'Post-Throw', description: 'Light band work for arm recovery' },
    { name: 'Shoulder Tube Work', tab: 'pitching', category: 'Post-Throw', description: 'Surgical tubing shoulder deceleration exercises' },
    { name: 'Ice + Flush', tab: 'pitching', category: 'Post-Throw', description: 'Post-throw icing and flush routine' },
    { name: 'Foam Roll + Stretch', tab: 'pitching', category: 'Post-Throw', description: 'Pitcher-specific foam roll and static stretch cooldown' },

    // Defense — Machine drills
    { name: 'Machine Ground Balls', tab: 'defense', category: 'Machine', description: 'Fielding machine-hit ground balls for consistency' },
    { name: 'Machine Fly Balls', tab: 'defense', category: 'Machine', description: 'Tracking machine-launched fly balls' },
    { name: 'Machine Pop-Ups', tab: 'defense', category: 'Machine', description: 'Catching machine-launched pop-ups for catchers/infielders' },

    // Strength & Conditioning drills
    { name: 'Foam Roll + Stretch', tab: 'strength', category: 'Movement Prep', description: 'Soft tissue work and static stretching' },
    { name: 'Activation Circuit', tab: 'strength', category: 'Movement Prep', description: 'Glute, hip, and core activation' },
    { name: 'Squat 5x5', tab: 'strength', category: 'Exercises', description: 'Back squat — 5 sets of 5 reps' },
    { name: 'Deadlift 5x3', tab: 'strength', category: 'Exercises', description: 'Conventional deadlift — 5 sets of 3 reps' },
    { name: 'Bench Press 4x6', tab: 'strength', category: 'Exercises', description: 'Flat bench press — 4 sets of 6 reps' },
    { name: 'Power Clean 4x3', tab: 'strength', category: 'Exercises', description: 'Olympic power clean — 4 sets of 3 reps' },
    { name: 'Hex Bar Jump Squat', tab: 'strength', category: 'Exercises', description: 'Explosive hex bar jumps for power' },
    { name: 'Lunges + RDL', tab: 'strength', category: 'Exercises', description: 'Walking lunges and Romanian deadlifts' },
    { name: 'Pull-ups + Rows', tab: 'strength', category: 'Exercises', description: 'Upper back pulling exercises' },
    { name: 'Med Ball Series', tab: 'strength', category: 'Exercises', description: 'Rotational and overhead med ball throws' },
    { name: 'Sprint Work — 60yd', tab: 'strength', category: 'Exercises', description: '60-yard dash practice and splits' },
    { name: 'Agility Ladder', tab: 'strength', category: 'Exercises', description: 'Speed ladder footwork patterns' },
    { name: 'Sled Pushes', tab: 'strength', category: 'Exercises', description: 'Heavy sled push for power endurance' },
    { name: 'Box Jumps', tab: 'strength', category: 'Exercises', description: 'Plyometric box jump variations' },
    { name: 'Conditioning — Poles', tab: 'strength', category: 'Exercises', description: 'Foul pole to foul pole conditioning runs' },
    { name: 'Static Stretch Routine', tab: 'strength', category: 'Cool Down', description: 'Full body static stretching cooldown' },
    { name: 'Yoga Flow', tab: 'strength', category: 'Cool Down', description: 'Recovery yoga flow for flexibility' },
    { name: 'Breathing + Recovery', tab: 'strength', category: 'Cool Down', description: 'Diaphragmatic breathing and parasympathetic recovery' },

    // Vision drills
    { name: 'Vizual Edge — Depth Perception', tab: 'vision', category: 'Vizual Edge', description: 'Digital depth perception training module' },
    { name: 'Vizual Edge — Tracking', tab: 'vision', category: 'Vizual Edge', description: 'Object tracking speed training' },
    { name: 'Vizual Edge — Recognition', tab: 'vision', category: 'Vizual Edge', description: 'Pitch type recognition drills' },
    { name: 'Vizual Edge — Alignment', tab: 'vision', category: 'Vizual Edge', description: 'Visual alignment and focus training' },
    { name: 'Brock String', tab: 'vision', category: 'Drills', description: 'Convergence and divergence eye training' },
    { name: 'Near-Far Focus', tab: 'vision', category: 'Drills', description: 'Alternating focus distance exercises' },
    { name: 'Pitch Recognition Video', tab: 'vision', category: 'Drills', description: 'Video-based pitch identification practice' },
    { name: 'Colored Ball Tracking', tab: 'vision', category: 'Drills', description: 'Colored ball reaction and identification' },
    { name: 'Live Pitch Tracking', tab: 'vision', category: 'Live', description: 'Track live pitches for spin and movement identification' },
    { name: 'Game Film Analysis', tab: 'vision', category: 'Live', description: 'Review game footage for pitch recognition patterns' },
  ];
  void _legacyDemoDrills;

  const drills = [];
  for (const d of drillsData) {
    const drill = await prisma.drill.create({ data: d });
    drills.push(drill);
  }
  console.log(`Seeded ${drills.length} drills in library`);

  // Seed some scheduled drills for the first two players in April 2026
  const schedulePlayers = [players[0], players[1]];
  for (const sp of schedulePlayers) {
    const hittingDrills = drills.filter(d => d.tab === 'hitting');
    const pitchingDrills = drills.filter(d => d.tab === 'pitching');
    const defenseDrills = drills.filter(d => d.tab === 'defense');
    const strengthDrills = drills.filter(d => d.tab === 'strength');
    const visionDrills = drills.filter(d => d.tab === 'vision');

    // Schedule drills for April 2026
    for (let day = 1; day <= 30; day++) {
      const dateStr = `2026-04-${String(day).padStart(2, '0')}`;
      const dayOfWeek = new Date(2026, 3, day).getDay(); // 0=Sun
      if (dayOfWeek === 0) continue; // Skip Sundays

      // Monday/Wednesday/Friday: hitting + strength
      if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
        const warmup = hittingDrills.find(d => d.category === 'Movement Prep');
        const drill1 = hittingDrills.filter(d => d.category === 'Drills')[day % 5];
        const bp = hittingDrills.filter(d => d.category === 'Batting Practice')[day % 3];
        const lift = strengthDrills.filter(d => d.category === 'Drills')[day % 6];

        if (warmup) await prisma.scheduledDrill.create({ data: { playerId: sp.id, drillId: warmup.id, tab: 'hitting', category: warmup.category, name: warmup.name, date: dateStr, time: '09:00', duration: 15 } });
        if (drill1) await prisma.scheduledDrill.create({ data: { playerId: sp.id, drillId: drill1.id, tab: 'hitting', category: drill1.category, name: drill1.name, date: dateStr, time: '09:15', duration: 20 } });
        if (bp) await prisma.scheduledDrill.create({ data: { playerId: sp.id, drillId: bp.id, tab: 'hitting', category: bp.category, name: bp.name, date: dateStr, time: '09:45', duration: 25 } });
        if (lift) await prisma.scheduledDrill.create({ data: { playerId: sp.id, drillId: lift.id, tab: 'strength', category: lift.category, name: lift.name, date: dateStr, time: '14:00', duration: 45 } });
      }

      // Tuesday/Thursday: pitching + defense
      if (dayOfWeek === 2 || dayOfWeek === 4) {
        const armCare = pitchingDrills.find(d => d.name.includes('Arm Care'));
        const pitchDrill = pitchingDrills.filter(d => d.category === 'Drills')[day % 5];
        const bullpen = pitchingDrills.filter(d => d.category === 'Bullpen')[day % 2];
        const defDrill = defenseDrills.filter(d => d.category === 'Drills')[day % 6];

        if (armCare) await prisma.scheduledDrill.create({ data: { playerId: sp.id, drillId: armCare.id, tab: 'pitching', category: armCare.category, name: armCare.name, date: dateStr, time: '09:00', duration: 15 } });
        if (pitchDrill) await prisma.scheduledDrill.create({ data: { playerId: sp.id, drillId: pitchDrill.id, tab: 'pitching', category: pitchDrill.category, name: pitchDrill.name, date: dateStr, time: '09:15', duration: 20 } });
        if (bullpen) await prisma.scheduledDrill.create({ data: { playerId: sp.id, drillId: bullpen.id, tab: 'pitching', category: bullpen.category, name: bullpen.name, date: dateStr, time: '09:45', duration: 30 } });
        if (defDrill) await prisma.scheduledDrill.create({ data: { playerId: sp.id, drillId: defDrill.id, tab: 'defense', category: defDrill.category, name: defDrill.name, date: dateStr, time: '14:00', duration: 25 } });
      }

      // Saturday: vision
      if (dayOfWeek === 6) {
        const visDrill = visionDrills[day % visionDrills.length];
        if (visDrill) await prisma.scheduledDrill.create({ data: { playerId: sp.id, drillId: visDrill.id, tab: 'vision', category: visDrill.category, name: visDrill.name, date: dateStr, time: '10:00', duration: 30 } });
      }
    }
  }
  console.log('Scheduled drills seeded for first 2 players');

  // Seed a couple game reports for the first player
  await prisma.gameReport.create({
    data: {
      playerId: players[0].id,
      gameDate: new Date(2026, 2, 28),
      opponent: 'Central High',
      stats: JSON.stringify({ atBats: 4, hits: 2, rbi: 3, runs: 1 }),
      journal: 'Hit well off fastballs today. Struggled a bit with the changeup in the 3rd.',
      season: '2026-spring',
    },
  });
  await prisma.gameReport.create({
    data: {
      playerId: players[0].id,
      gameDate: new Date(2026, 2, 25),
      opponent: 'Lakewood Prep',
      stats: JSON.stringify({ atBats: 3, hits: 1, rbi: 0, runs: 1 }),
      journal: 'Off-speed was tough today. Need to work on recognizing the slider earlier.',
      season: '2026-spring',
    },
  });

  console.log('Game reports seeded');

  // ─── Seed Education: Classes ───────────────────────────────────
  console.log('Seeding education classes...');
  await prisma.eduClass.deleteMany();

  const classesData = [
    { sport: 'hitting', level: 'beginner', name: 'Hitting Fundamentals 101', desc: 'Grip, stance, and load — the foundation of every swing.', lessons: 6, duration: 30, emoji: '🏏' },
    { sport: 'hitting', level: 'beginner', name: 'Contact Point Basics', desc: 'Learning where to make contact with different pitch locations.', lessons: 4, duration: 25, emoji: '⚾' },
    { sport: 'hitting', level: 'intermediate', name: 'Bat Speed Development', desc: 'Rotational mechanics and hip-to-hands sequencing for max bat speed.', lessons: 8, duration: 40, emoji: '💨' },
    { sport: 'hitting', level: 'intermediate', name: 'Two-Strike Approach', desc: 'Adjusting swing path, widening zone, and protecting the plate.', lessons: 5, duration: 30, emoji: '🎯' },
    { sport: 'hitting', level: 'advanced', name: 'Advanced Pitch Recognition', desc: 'Reading spin, tunnel points, and early pitch ID at game speed.', lessons: 10, duration: 45, emoji: '👁️' },
    { sport: 'hitting', level: 'expert', name: 'Elite Swing Biomechanics', desc: 'Detailed kinematic chain analysis — ground reaction force to barrel.', lessons: 12, duration: 60, emoji: '🧬' },
    { sport: 'pitching', level: 'beginner', name: 'Pitching Mechanics 101', desc: 'Wind-up, stretch, balance point, and basic arm path.', lessons: 6, duration: 35, emoji: '⚾' },
    { sport: 'pitching', level: 'intermediate', name: '4-Seam Command Program', desc: 'Consistent release, spin axis, and location control.', lessons: 8, duration: 40, emoji: '🎯' },
    { sport: 'pitching', level: 'advanced', name: 'Pitch Design & Tunneling', desc: 'Designing a pitch arsenal that shares the same tunnel.', lessons: 10, duration: 50, emoji: '🔬' },
    { sport: 'defense', level: 'beginner', name: 'Catcher Fundamentals', desc: 'Receiving, blocking, and throwing basics for catchers.', lessons: 6, duration: 30, emoji: '🧤' },
    { sport: 'defense', level: 'intermediate', name: 'Framing & Game Calling', desc: 'Pitch framing technique and advanced game-calling strategy.', lessons: 7, duration: 40, emoji: '🎲' },
    { sport: 'strength', level: 'beginner', name: 'Athlete Movement Foundations', desc: 'Fundamental movement patterns, mobility, and injury prevention.', lessons: 5, duration: 30, emoji: '🏃' },
    { sport: 'strength', level: 'intermediate', name: 'Rotational Power Program', desc: 'Med ball, landmine, and Olympic lifting for rotational athletes.', lessons: 8, duration: 50, emoji: '💪' },
    { sport: 'vision', level: 'beginner', name: 'Visual Tracking Basics', desc: 'Smooth pursuit, saccades, and focus tracking fundamentals.', lessons: 4, duration: 20, emoji: '👁️' },
    { sport: 'vision', level: 'advanced', name: 'Cognitive Performance Training', desc: 'Decision speed, working memory, and mental rep strategies.', lessons: 9, duration: 45, emoji: '🧠' },
  ];
  // Demo classes are no longer seeded — the Education library starts empty so
  // coaches only ever see real classes they create.
  void classesData;
  console.log('Education classes: demo seed disabled (library starts empty).');

  // ─── Seed Education: MLB Players & Videos ──────────────────────
  console.log('Seeding MLB players...');
  await prisma.mlbVideo.deleteMany();
  await prisma.mlbPlayer.deleteMany();

  const mlbData = [
    { name: 'Mike Trout', positions: 'Hitter,Outfield', bats: 'RHH', team: 'LA Angels', emoji: '⭐',
      videos: [
        { title: '2019 MVP Swing Sequence', category: 'Swing', notes: 'Watch hip rotation and back shoulder stay level' },
        { title: 'Pull Side Home Run — 2023', category: 'At-Bat' },
        { title: 'Oppo Field Double Mechanics', category: 'Swing', notes: 'Focus on front arm extension' },
      ]},
    { name: 'Shohei Ohtani', positions: 'Hitter,Pitcher,Outfield', bats: 'LHH', throws: 'RHP', team: 'LA Dodgers', emoji: '🌟',
      videos: [
        { title: 'Swing Path Analysis 2023', category: 'Swing', notes: 'Notice the hip load and launch angle' },
        { title: '100mph Splitter Breakdown', category: 'Pitching', notes: 'Grip and release point' },
        { title: 'At-Bat vs Cole — 2021 ALCS', category: 'At-Bat' },
      ]},
    { name: 'Freddie Freeman', positions: 'Hitter', bats: 'LHH', team: 'LA Dodgers', emoji: '🔨',
      videos: [
        { title: 'Contact Approach Film', category: 'At-Bat', notes: '2-strike adjustments are excellent study' },
        { title: 'Swing vs LHP — 2022', category: 'Swing' },
      ]},
    { name: 'Sandy Alcantara', positions: 'Pitcher', throws: 'RHP', team: 'Miami Marlins', emoji: '🔥',
      videos: [
        { title: 'Sinker Movement Plot 2022', category: 'Mechanics', notes: 'Elite horizontal break on sinker' },
        { title: 'Complete Game Breakdown', category: 'Pitching' },
      ]},
    { name: 'Clayton Kershaw', positions: 'Pitcher', throws: 'LHP', team: 'LA Dodgers', emoji: '👑',
      videos: [
        { title: 'Curveball Grip & Release', category: 'Mechanics', notes: '12-6 shape, elite spin efficiency' },
        { title: '2-Seam Pitching Deep Dive', category: 'Pitching' },
        { title: 'NLDS Dominance — 2013', category: 'Highlight' },
      ]},
    { name: 'J.T. Realmuto', positions: 'Hitter,Catcher', bats: 'RHH', team: 'Philadelphia Phillies', emoji: '🧤',
      videos: [
        { title: 'Framing at Edges — Study', category: 'Defense', notes: 'Elite borderline pitch receiving' },
        { title: 'Pop Time Mechanics', category: 'Defense', notes: 'Sub 1.9 pop time breakdown' },
        { title: 'Barrel Rate Analysis 2023', category: 'Swing' },
      ]},
    { name: 'Manny Machado', positions: 'Hitter,Infield', bats: 'RHH', team: 'San Diego Padres', emoji: '⚡',
      videos: [
        { title: '3B Range & Footwork', category: 'Defense' },
        { title: 'Swing Mechanics Deep Dive', category: 'Swing' },
      ]},
    { name: 'Corbin Carroll', positions: 'Hitter,Outfield', bats: 'LHH', team: 'Arizona Diamondbacks', emoji: '🚀',
      videos: [
        { title: 'Speed & Route Running', category: 'Defense', notes: 'Elite first step and closing speed' },
        { title: 'LHH Contact Swing — 2023', category: 'Swing' },
      ]},
  ];

  // Demo MLB players/videos are no longer seeded — the Major League Video
  // library starts empty so coaches only see real clips they upload.
  void mlbData;
  console.log('MLB library: demo seed disabled (library starts empty).');

  // ─── Compute Leaderboards ─────────────────────────────────────
  console.log('Computing leaderboards...');

  const LEADERBOARD_METRICS = [
    'max_exit_velo', 'avg_exit_velo', 'max_bat_speed', 'fb_max_velo',
    'infield_velo', 'outfield_velo', 'catcher_velo', 'pop_time',
    'jump_height', 'sixty_yard',
  ];
  const LOWER_IS_BETTER = new Set(['pop_time', 'sixty_yard']);

  const distinctGradYears = await prisma.player
    .findMany({ select: { gradYear: true }, distinct: ['gradYear'] })
    .then(rows => rows.map(r => r.gradYear).filter((y): y is number => y !== null));

  for (const year of distinctGradYears) {
    for (const metricType of LEADERBOARD_METRICS) {
      const lowerIsBetter = LOWER_IS_BETTER.has(metricType);
      const playersWithMetrics = await prisma.player.findMany({
        where: { gradYear: year },
        include: {
          metrics: {
            where: { metricType },
            orderBy: { value: lowerIsBetter ? 'asc' : 'desc' },
            take: 1,
          },
        },
      });

      const ranked = playersWithMetrics
        .filter(p => p.metrics.length > 0)
        .map(p => ({ playerId: p.id, value: p.metrics[0].value }))
        .sort((a, b) => lowerIsBetter ? a.value - b.value : b.value - a.value)
        .slice(0, 15)
        .map((entry, i) => ({
          gradYear: year,
          metricType,
          playerId: entry.playerId,
          value: entry.value,
          rank: i + 1,
        }));

      if (ranked.length > 0) {
        await prisma.leaderboardEntry.createMany({ data: ranked });
      }
    }
  }

  console.log(`Leaderboards computed for grad years: ${distinctGradYears.join(', ')}`);
  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
