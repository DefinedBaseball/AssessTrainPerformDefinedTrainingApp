import { Module } from '@nestjs/common';
import { PlayersService } from './players.service';
import { PlayersController, PlayerPhotosController } from './players.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [PlayersController, PlayerPhotosController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
