import { Module } from '@nestjs/common';
import { LiftingModule } from '../lifting/lifting.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  /* LiftingService: the VALD / Lifting results the builder can chart. */
  imports: [LiftingModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
