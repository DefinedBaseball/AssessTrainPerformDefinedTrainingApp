import { Module } from '@nestjs/common';
import { DrillOptionsController } from './drill-options.controller';
import { DrillOptionsService } from './drill-options.service';

@Module({
  controllers: [DrillOptionsController],
  providers: [DrillOptionsService],
})
export class DrillOptionsModule {}
