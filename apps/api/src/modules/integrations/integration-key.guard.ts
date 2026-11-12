import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

/**
 * Partner requests: the API key (not a user login) decides access.
 *
 *   Authorization: Bearer dbk_live_...      (or)      X-API-Key: dbk_live_...
 *
 * Rejects a missing / unknown / revoked key (401). When the route carries a
 * :provider, the key must belong to THAT provider (403) -- a MOVE key can
 * never post to another company's path. Sets req.integrationKey.
 */
@Injectable()
export class IntegrationKeyGuard implements CanActivate {
  constructor(private integrations: IntegrationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth = String(req.headers?.authorization || '');
    const plain = (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : String(req.headers?.['x-api-key'] || '')).trim();
    if (!plain) throw new UnauthorizedException('Missing API key (Authorization: Bearer <key>)');
    const key = await this.integrations.authenticate(plain);
    if (!key) throw new UnauthorizedException('Invalid or revoked API key');
    const provider = req.params?.provider;
    if (provider && provider !== key.provider) {
      throw new ForbiddenException('This API key is not for that integration');
    }
    req.integrationKey = key;
    return true;
  }
}
