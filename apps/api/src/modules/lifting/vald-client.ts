import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/* ─────────────────────────────────────────────────────────────────────────
   VALD external API client (read-only).

   Credentials live in the API's environment only (Render pdev-api ->
   Environment; locally apps/api/.env): VALD_CLIENT_ID, VALD_CLIENT_SECRET,
   VALD_TENANT_ID ("Team ID"); optional VALD_REGION (use | aue | euw,
   default use = US East). Sign-in is OAuth client-credentials against VALD's
   March-2026 provider (audience "vald-api-external"); the token is cached
   until a minute before it expires. Requests back off and retry when VALD
   rate-limits (429) or hiccups (5xx).
   ───────────────────────────────────────────────────────────────────────── */

const TOKEN_URL = 'https://auth.prd.vald.com/oauth/token';

export type ValdService = 'externalprofile' | 'externaltenants' | 'extforcedecks' | 'extdynamo';

@Injectable()
export class ValdClient {
  private readonly logger = new Logger(ValdClient.name);
  private token: { value: string; until: number } | null = null;

  get tenantId(): string { return (process.env.VALD_TENANT_ID || '').trim(); }
  private get region(): string { return /^(use|aue|euw)$/.test(process.env.VALD_REGION || '') ? process.env.VALD_REGION! : 'use'; }

  isConfigured(): boolean {
    return !!(process.env.VALD_CLIENT_ID && process.env.VALD_CLIENT_SECRET && this.tenantId);
  }

  base(service: ValdService): string {
    return `https://prd-${this.region}-api-${service}.valdperformance.com`;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.until) return this.token.value;
    if (!this.isConfigured()) throw new ServiceUnavailableException('VALD is not connected (set VALD_CLIENT_ID, VALD_CLIENT_SECRET and VALD_TENANT_ID).');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.VALD_CLIENT_ID!.trim(),
      client_secret: process.env.VALD_CLIENT_SECRET!.trim(),
      audience: 'vald-api-external',
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      this.logger.warn(`VALD sign-in failed (${res.status})`);
      throw new ServiceUnavailableException(`VALD sign-in failed (${res.status}) -- check the VALD credentials.`);
    }
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new ServiceUnavailableException('VALD sign-in returned no token');
    this.token = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 60) * 1000 };
    return j.access_token;
  }

  /** GET a VALD JSON route. 204 / empty -> null. Retries 429 and 5xx. */
  async get<T = any>(service: ValdService, pathAndQuery: string): Promise<T | null> {
    const url = this.base(service) + pathAndQuery;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 401 && attempt === 0) { this.token = null; continue; }
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1) ** 2;
        await new Promise((r) => setTimeout(r, Math.min(wait, 30_000)));
        continue;
      }
      if (res.status === 204) return null;
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`VALD ${service} ${res.status}: ${detail}`);
      }
      const text = await res.text();
      return text ? (JSON.parse(text) as T) : null;
    }
    throw new Error(`VALD ${service} kept rate-limiting -- try again in a few minutes`);
  }
}
