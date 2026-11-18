import { Module } from '@nestjs/common';
import { LiftingController } from './lifting.controller';
import { LiftingService } from './lifting.service';
import { ValdClient } from './vald-client';
import { ValdService } from './vald.service';

@Module({
  controllers: [LiftingController],
  /* ValdService: VALD import (settings, PULL button, automatic pull). */
  providers: [LiftingService, ValdClient, ValdService],
  /* ValdService: Data -> Studies reads VALD groups / tags as athlete filters. */
  exports: [LiftingService, ValdService],
})
export class LiftingModule {}
