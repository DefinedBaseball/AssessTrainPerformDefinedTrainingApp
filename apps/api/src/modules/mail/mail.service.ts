import { Injectable, Logger } from '@nestjs/common';

/**
 * Transactional email via Resend's REST API.
 *
 * Config-gated exactly like BunnyService: activates only when RESEND_API_KEY
 * is set. Without it, send() is a logged no-op — so the app deploys and runs
 * perfectly fine before the key lands in Render, and dev never sends real
 * mail. We call Resend's HTTP endpoint with global fetch (Node 18+) rather
 * than adding the `resend` SDK — one less dependency + no lockfile churn.
 *
 * send() NEVER throws: an email failure must not break the action that
 * triggered it (a password-reset request, a player approval, …). It returns
 * true only on a confirmed 2xx from Resend.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string | null;
  /** The verified From address/identity, e.g. "Defined Baseball <noreply@definedbaseball.com>". */
  private readonly from: string;
  /** Public origin of the web app — used to build links inside emails
   *  (reset-password page, login). Override via WEB_APP_URL when the custom
   *  domain goes live; defaults to the Render web service. */
  readonly webAppUrl: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY || null;
    this.from = process.env.EMAIL_FROM || 'Defined Baseball <noreply@definedbaseball.com>';
    this.webAppUrl = (process.env.WEB_APP_URL || 'https://pdev-web.onrender.com')
      .replace(/\/$/, '');

    if (this.isConfigured()) {
      this.logger.log(`Resend email enabled — from "${this.from}"`);
    } else {
      this.logger.warn(
        'Resend email disabled — set RESEND_API_KEY to enable (send() will no-op until then)',
      );
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Send one email. Best-effort: logs and returns false on any problem
   * (unconfigured, network error, non-2xx) instead of throwing.
   */
  async send(opts: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
  }): Promise<boolean> {
    const toLabel = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to;

    if (!this.isConfigured()) {
      this.logger.warn(`Email skipped (RESEND_API_KEY unset): "${opts.subject}" → ${toLabel}`);
      return false;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
          ...(opts.text ? { text: opts.text } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`Resend send failed (${res.status}) for "${opts.subject}": ${body.slice(0, 300)}`);
        return false;
      }
      this.logger.log(`Email sent: "${opts.subject}" → ${toLabel}`);
      return true;
    } catch (err) {
      this.logger.error(`Resend send threw for "${opts.subject}"`, err as Error);
      return false;
    }
  }
}
