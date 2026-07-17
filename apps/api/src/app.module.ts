import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { PlayersModule } from './modules/players/players.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { VideosModule } from './modules/videos/videos.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TrainingModule } from './modules/training/training.module';
import { LiveSessionsModule } from './modules/live-sessions/live-sessions.module';
import { LeaderboardsModule } from './modules/leaderboards/leaderboards.module';
import { GamesModule } from './modules/games/games.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { HealthModule } from './modules/health/health.module';
import { EducationModule } from './modules/education/education.module';
import { PostsModule } from './modules/posts/posts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ClubTeamsModule } from './modules/club-teams/club-teams.module';
import { CollegesModule } from './modules/colleges/colleges.module';
import { MessagesModule } from './modules/messages/messages.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MailModule } from './modules/mail/mail.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    /* Two throttler buckets, sized for the app's real fan-out:
     *   - "short" : 120 req / 10 s   — a single profile page load fans
     *                                  out to ~30 parallel requests
     *                                  (top metrics + videos + reports
     *                                  + 27 progress series). Coaches
     *                                  routinely click between athletes
     *                                  inside the 10-second window, so
     *                                  the cap needs headroom for at
     *                                  least 3-4 page loads back-to-
     *                                  back. The previous 20-req cap
     *                                  silently 429'd the second half
     *                                  of every profile load.
     *   - "long"  : 600 req / 60 s   — sustained-abuse ceiling.
     *
     * /auth/login + /auth/register override `short` locally with a
     * strict 5/min cap via @Throttle on the controller, so brute-force
     * protection stays tight where it matters. */
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 10_000, limit: 120 },
      { name: 'long', ttl: 60_000, limit: 600 },
    ]),
    PrismaModule,
    MailModule,
    HealthModule,
    AuthModule,
    PlayersModule,
    MetricsModule,
    VideosModule,
    ReportsModule,
    TrainingModule,
    LiveSessionsModule,
    LeaderboardsModule,
    GamesModule,
    UploadsModule,
    EducationModule,
    PostsModule,
    AnalyticsModule,
    ClubTeamsModule,
    CollegesModule,
    MessagesModule,
    NotificationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
