import { Injectable, Logger } from '@nestjs/common';
import { AcademyService, DEFAULT_ACADEMY_NAME } from '../academy/academy.service';
import { EmailContent, EmailKey, EmailVars, emailDef, renderEmail } from './mail.templates';

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
 *
 * Sender name, reply-to, logo, footer and wording come from Settings →
 * Academy at send time.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string | null;
  /** The verified sending address, e.g. "noreply@definedbaseball.com". The
   *  display name in front of it is the academy name, added per send. */
  private readonly fromAddress: string;
  /** Public origin of the web app — used to build links inside emails
   *  (reset-password page, login). Override via WEB_APP_URL when the custom
   *  domain goes live; defaults to the Render web service. */
  readonly webAppUrl: string;

  constructor(private academy: AcademyService) {
    this.apiKey = process.env.RESEND_API_KEY || null;
    /* EMAIL_FROM may be a bare address (production's is) or "Name <addr>". */
    const configuredFrom = process.env.EMAIL_FROM?.trim() || '';
    const bracketed = /<([^>]+)>/.exec(configuredFrom);
    this.fromAddress = (bracketed ? bracketed[1] : configuredFrom).trim() || 'noreply@definedbaseball.com';
    this.webAppUrl = (process.env.WEB_APP_URL || 'https://pdev-web.onrender.com')
      .replace(/\/$/, '');

    if (this.isConfigured()) {
      this.logger.log(`Resend email enabled — from "${this.fromAddress}"`);
    } else {
      this.logger.warn(
        'Resend email disabled — set RESEND_API_KEY to enable (send() will no-op until then)',
      );
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** Name/logo/contact every email is wrapped in. Logos must be absolute
   *  public URLs; the web app proxies /api to this server. Without an
   *  uploaded email logo, the bundled black logo in the web app's /public. */
  private async brand(relativeLogo = false) {
    const s = await this.academy.get();
    const origin = relativeLogo ? '' : this.webAppUrl;
    return {
      name: s.name,
      contact: s.contact,
      logoUrl: s.logos.email
        ? `${origin}/api/academy/logo/email?v=${s.logos.email}`
        : `${origin}/email-logo.png`,
    };
  }

  /** Render an email with its saved wording, or `draft` (editor preview /
   *  test send). `relativeLogo` is for the in-app preview, which loads the
   *  logo from whichever server is showing it. */
  async render(key: EmailKey, vars: EmailVars, draft?: EmailContent, relativeLogo = false) {
    const def = emailDef(key);
    if (!def) throw new Error(`Unknown email ${key}`);
    const content = draft ?? (await this.academy.emailContent(key));
    return renderEmail(def, content, vars, await this.brand(relativeLogo));
  }

  /** Render + send one of the app's emails. Same never-throws contract as send(). */
  async sendTemplate(key: EmailKey, to: string, vars: EmailVars, draft?: EmailContent): Promise<boolean> {
    try {
      const { subject, html, text } = await this.render(key, vars, draft);
      return await this.send({ to, subject, html, text });
    } catch (err) {
      this.logger.error(`Email ${key} could not be built`, err as Error);
      return false;
    }
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

    let senderName = DEFAULT_ACADEMY_NAME;
    let replyTo = '';
    try {
      const s = await this.academy.get();
      senderName = s.name;
      replyTo = s.replyTo;
    } catch { /* settings unreadable -- send with the defaults */ }
    const cleanName = senderName.replace(/["<>\r\n\\]/g, '').trim() || DEFAULT_ACADEMY_NAME;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `"${cleanName}" <${this.fromAddress}>`,
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
          ...(opts.text ? { text: opts.text } : {}),
          ...(replyTo ? { reply_to: replyTo } : {}),
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
