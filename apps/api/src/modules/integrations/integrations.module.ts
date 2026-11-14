import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationKeyGuard } from './integration-key.guard';
import { MoveProcessor } from './move/move.processor';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [ReportsModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationKeyGuard, MoveProcessor],
})
export class IntegrationsModule {}
