import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { S3Service } from './s3.service';
import { BunnyService } from './bunny.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 500 * 1024 * 1024, // 500 MB max video
      },
    }),
    NotificationsModule,
  ],
  controllers: [VideosController],
  providers: [VideosService, S3Service, BunnyService],
  // Export the storage services so other modules (TrainingModule for drill
  // clips, future avatar/upload features) can reuse the same configured
  // clients without re-instantiating them. Single source of truth for storage.
  exports: [VideosService, S3Service, BunnyService],
})
export class VideosModule {}
