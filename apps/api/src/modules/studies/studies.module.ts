import { Module } from '@nestjs/common';
import { LiftingModule } from '../lifting/lifting.module';
import { StudiesController } from './studies.controller';
import { StudiesService } from './studies.service';

@Module({
  imports: [LiftingModule],
  controllers: [StudiesController],
  providers: [StudiesService],
})
export class StudiesModule {}
