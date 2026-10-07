import { Module } from '@nestjs/common';
import { CoachTasksController } from './coach-tasks.controller';
import { CoachTasksService } from './coach-tasks.service';

@Module({
  controllers: [CoachTasksController],
  providers: [CoachTasksService],
})
export class CoachTasksModule {}
