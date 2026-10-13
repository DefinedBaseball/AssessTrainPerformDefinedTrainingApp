import { Module } from '@nestjs/common';
import { PlayersService } from './players.service';
import { PlayersController, PlayerPhotosController } from './players.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeaderboardsModule } from '../leaderboards/leaderboards.module';

@Module({
  imports: [NotificationsModule, LeaderboardsModule],
  controllers: [PlayersController, PlayerPhotosController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
