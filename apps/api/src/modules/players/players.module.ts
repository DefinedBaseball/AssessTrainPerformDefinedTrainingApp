import { Module } from '@nestjs/common';
import { PlayersService } from './players.service';
import { PlayersController, PlayerPhotosController } from './players.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeaderboardsModule } from '../leaderboards/leaderboards.module';
import { VideosModule } from '../videos/videos.module';
import { FacilityProgramsModule } from '../facility-programs/facility-programs.module';

@Module({
  imports: [NotificationsModule, LeaderboardsModule, VideosModule, FacilityProgramsModule],
  controllers: [PlayersController, PlayerPhotosController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
