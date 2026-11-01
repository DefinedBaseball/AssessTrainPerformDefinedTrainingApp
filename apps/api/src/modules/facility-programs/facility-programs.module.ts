import { Module } from '@nestjs/common';
import { FacilityProgramsController } from './facility-programs.controller';
import { FacilityProgramsService } from './facility-programs.service';

@Module({
  controllers: [FacilityProgramsController],
  providers: [FacilityProgramsService],
  exports: [FacilityProgramsService],
})
export class FacilityProgramsModule {}
