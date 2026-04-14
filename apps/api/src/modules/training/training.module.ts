import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TrainingService } from './training.service';
import { TrainingController } from './training.controller';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 500 * 1024 * 1024 } }), // 500 MB
  ],
  controllers: [TrainingController],
  providers: [TrainingService],
  exports: [TrainingService],
})
export class TrainingModule {}
