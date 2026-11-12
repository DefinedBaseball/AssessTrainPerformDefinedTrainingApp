import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationKeyGuard } from './integration-key.guard';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationKeyGuard],
})
export class IntegrationsModule {}
