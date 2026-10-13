import { Module } from '@nestjs/common';
import { PlayersService } from './players.service';
import { PlayersController, PlayerPhotosController } from './players.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeaderboardsModule } from '../leaderboards/leaderboards.module';
import { VideosModule } from '../videos/videos.module';

@Module({
  imports: [NotificationsModule, LeaderboardsModule, VideosModule],
  controllers: [PlayersController, PlayerPhotosController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
