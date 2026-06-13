import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TrainingService } from './training.service';
import { TrainingController } from './training.controller';
import { VideosModule } from '../videos/videos.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    NotificationsModule,
    MulterModule.register({ limits: { fileSize: 500 * 1024 * 1024 } }), // 500 MB
    /* Pull in S3Service so drill demo uploads can write to the same
     * bucket as athlete videos when STORAGE_DRIVER=s3. Falls back to
     * local disk in dev. */
    VideosModule,
  ],
  controllers: [TrainingController],
  providers: [TrainingService],
  exports: [TrainingService],
})
export class TrainingModule {}
