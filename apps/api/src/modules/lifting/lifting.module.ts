import { Module } from '@nestjs/common';
import { LiftingController } from './lifting.controller';
import { LiftingService } from './lifting.service';

@Module({
  controllers: [LiftingController],
  providers: [LiftingService],
  exports: [LiftingService],
})
export class LiftingModule {}
