import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import { UploadsController } from './uploads.controller';
import { CsvProcessingService } from './csv-processing.service';
import { LeaderboardsModule } from '../leaderboards/leaderboards.module';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB max CSV
      },
    }),
    LeaderboardsModule,
  ],
  controllers: [UploadsController],
  providers: [UploadsService, CsvProcessingService],
  exports: [UploadsService, CsvProcessingService],
})
export class UploadsModule {}
