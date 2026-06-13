import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  // Exported so auth / posts / reports / videos / training can fan out
  // notifications by injecting NotificationsService.
  exports: [NotificationsService],
})
export class NotificationsModule {}
