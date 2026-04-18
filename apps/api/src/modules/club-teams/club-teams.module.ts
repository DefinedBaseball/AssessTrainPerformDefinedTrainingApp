import { Module } from '@nestjs/common';
import { ClubTeamsController } from './club-teams.controller';
import { ClubTeamsService } from './club-teams.service';

@Module({
  controllers: [ClubTeamsController],
  providers: [ClubTeamsService],
  exports: [ClubTeamsService],
})
export class ClubTeamsModule {}
