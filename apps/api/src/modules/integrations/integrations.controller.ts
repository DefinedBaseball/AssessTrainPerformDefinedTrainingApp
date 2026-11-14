import {
  Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, Patch, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly, AuthenticatedRequest, Public, Roles } from '../auth/jwt.guard';
import { IntegrationKeyGuard } from './integration-key.guard';
import { IntegrationsService, AuthedIntegrationKey } from './integrations.service';
import { providerBySlug } from './integration-providers';

/* ─────────────────────────────────────────────────────────────────────────
   /api/integrations

   Partner routes (API key, no user login):
     GET  /api/integrations/ping                 -- "is my key working?"
     POST /api/integrations/:provider/:kind       -- e.g. /integrations/move/sessions

   Admin routes (coach login, Admin level) -- Settings -> Integrations:
     keys (list / create / revoke) and the delivery log.
   Static admin paths are declared before the :provider routes.
   ───────────────────────────────────────────────────────────────────────── */
@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private svc: IntegrationsService) {}

  // ── Admin ─────────────────────────────────────────────────────────────

  @Get('providers')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Integrations the app can accept data from (admin)' })
  providers() {
    return this.svc.providers();
  }

  @Get('keys')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'API keys (never the key itself) (admin)' })
  listKeys() {
    return this.svc.listKeys();
  }

  @Post('keys')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Create an API key -- the key is returned ONCE (admin)' })
  createKey(@Request() req: AuthenticatedRequest, @Body() dto: { provider?: string; label?: string; mode?: string }) {
    return this.svc.createKey(dto, req.user?.sub);
  }

  @Post('keys/:id/revoke')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Revoke an API key immediately (admin)' })
  revokeKey(@Param('id') id: string) {
    return this.svc.revokeKey(id);
  }

  @Get('deliveries')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Recent deliveries from partners, newest first (admin)' })
  listDeliveries(@Query('provider') provider?: string, @Query('limit') limit?: string) {
    return this.svc.listDeliveries({ provider: provider || undefined, limit: limit ? Number(limit) : undefined });
  }

  @Get('deliveries/:id')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'One delivery with its full payload (admin)' })
  getDelivery(@Param('id') id: string) {
    return this.svc.getDelivery(id);
  }

  @Delete('deliveries/test')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Delete TEST deliveries (admin)' })
  clearTest(@Query('provider') provider?: string) {
    return this.svc.clearTestDeliveries(provider || undefined);
  }

  @Post('deliveries/:id/process')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Process a delivery again (admin)' })
  reprocess(@Param('id') id: string) {
    return this.svc.reprocess(id);
  }

  @Post('deliveries/:id/link')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: "Link an unmatched delivery's outside athlete to one of ours (admin)" })
  link(@Request() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: { playerId?: string }) {
    return this.svc.linkAthlete(id, dto?.playerId, req.user?.sub);
  }

  @Get('links')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Saved outside-account -> athlete links (admin)' })
  links(@Query('provider') provider?: string) {
    return this.svc.listLinks(provider || undefined);
  }

  @Delete('links/:id')
  @ApiBearerAuth()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Remove a saved athlete link (admin)' })
  removeLink(@Param('id') id: string) {
    return this.svc.removeLink(id);
  }

  /* Any coach who can write (Viewers are blocked by the global guard) --
     it's part of the athlete's profile, edited from Edit Profile. */
  @Patch('athlete-code/:playerId')
  @ApiBearerAuth()
  @Roles('COACH')
  @ApiOperation({ summary: "Set an athlete's Athlete ID (secondary ID outside apps can send)" })
  setAthleteCode(@Param('playerId') playerId: string, @Body() dto: { athleteCode?: string | null }) {
    return this.svc.setAthleteCode(playerId, dto?.athleteCode ?? '');
  }

  // ── Partner (API key) ─────────────────────────────────────────────────

  @Get('ping')
  @Public()
  @UseGuards(IntegrationKeyGuard)
  @ApiOperation({ summary: 'Check an API key: returns which integration it belongs to' })
  ping(@Request() req: { integrationKey: AuthedIntegrationKey }) {
    const k = req.integrationKey;
    return {
      ok: true,
      integration: k.provider,
      integrationName: providerBySlug(k.provider)?.label ?? k.provider,
      mode: k.mode,
      keyLabel: k.label,
      serverTime: new Date().toISOString(),
    };
  }

  @Post(':provider/:kind')
  @Public()
  @UseGuards(IntegrationKeyGuard)
  @Throttle({ short: { limit: 60, ttl: 10_000 } })
  @HttpCode(202)
  @ApiOperation({ summary: 'Send data, e.g. POST /integrations/move/sessions (API key)' })
  receive(
    @Request() req: { integrationKey: AuthedIntegrationKey },
    @Param('provider') provider: string,
    @Param('kind') kind: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const p = providerBySlug(provider);
    if (!p || !p.kinds.includes(kind)) throw new NotFoundException(`Unknown endpoint /integrations/${provider}/${kind}`);
    return this.svc.receive(req.integrationKey, kind, body, idempotencyKey);
  }
}
