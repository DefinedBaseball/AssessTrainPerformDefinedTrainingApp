import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { PlayersModule } from './modules/players/players.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { VideosModule } from './modules/videos/videos.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TrainingModule } from './modules/training/training.module';
import { LeaderboardsModule } from './modules/leaderboards/leaderboards.module';
import { GamesModule } from './modules/games/games.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { HealthModule } from './modules/health/health.module';
import { EducationModule } from './modules/education/education.module';
import { PostsModule } from './modules/posts/posts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ClubTeamsModule } from './modules/club-teams/club-teams.module';
import { CollegesModule } from './modules/colleges/colleges.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    AuthModule,
    PlayersModule,
    MetricsModule,
    VideosModule,
    ReportsModule,
    TrainingModule,
    LeaderboardsModule,
    GamesModule,
    UploadsModule,
    EducationModule,
    PostsModule,
    AnalyticsModule,
    ClubTeamsModule,
    CollegesModule,
  ],
})
export class AppModule {}
