import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { S3Service } from './s3.service';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 500 * 1024 * 1024, // 500 MB max video
      },
    }),
  ],
  controllers: [VideosController],
  providers: [VideosService, S3Service],
  exports: [VideosService],
})
export class VideosModule {}
