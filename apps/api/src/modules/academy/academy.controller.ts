import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AdminOnly, AuthenticatedRequest, Public, Roles } from '../auth/jwt.guard';
import { MailService } from '../mail/mail.service';
import { EMAIL_DEFS, EmailKey, EmailVars, emailDef } from '../mail/mail.templates';
import { AcademyService, LogoKind } from './academy.service';

const LOGO_KINDS: LogoKind[] = ['app', 'email'];

function logoKind(kind: string): LogoKind {
  if (!LOGO_KINDS.includes(kind as LogoKind)) throw new NotFoundException('Unknown logo');
  return kind as LogoKind;
}

/* Settings → Academy. Everything is admin-only except the public summary
   and the logo images, which the sign-in / sign-up / inquiry pages and
   emails load with no account. */
@ApiTags('academy')
@ApiBearerAuth()
@Controller('academy')
export class AcademyController {
  constructor(
    private academy: AcademyService,
    private mail: MailService,
  ) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Academy name, logo versions, contact info, new-athlete switch, time zone (public)' })
  getPublic() {
    return this.academy.getPublic();
  }

  @Public()
  @Get('logo/:kind')
  @ApiOperation({ summary: 'The uploaded app or email logo (public)' })
  async getLogo(@Param('kind') kind: string, @Res() res: Response) {
    const logo = await this.academy.getLogo(logoKind(kind));
    res.set({
      'Content-Type': logo.mime,
      'Content-Length': String(logo.data.length),
      /* URLs carry ?v=<upload time>, so a new upload is a new URL. */
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(logo.data);
  }

  @Get()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'All academy settings (admin)' })
  get() {
    return this.academy.get();
  }

  @Put()
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Save academy settings (admin)' })
  save(@Body() dto: unknown) {
    return this.academy.save(dto);
  }

  @Put('logo/:kind')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Upload the app or email logo as a data URL (admin, 1 MB max)' })
  setLogo(@Param('kind') kind: string, @Body() dto: { dataUrl?: string }) {
    return this.academy.setLogo(logoKind(kind), dto?.dataUrl);
  }

  @Delete('logo/:kind')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Go back to the default logo (admin)' })
  removeLogo(@Param('kind') kind: string) {
    return this.academy.removeLogo(logoKind(kind));
  }

  /* ── Emails ── */

  @Get('emails')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Every app email with its default and current wording (admin)' })
  async listEmails() {
    const overrides = await this.academy.emailOverrides();
    return EMAIL_DEFS.map((d) => ({
      key: d.key,
      label: d.label,
      when: d.when,
      button: d.button,
      placeholders: d.placeholders,
      defaults: d.defaults,
      current: overrides[d.key] ?? d.defaults,
      customized: !!overrides[d.key],
    }));
  }

  @Put('emails/:key')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Save the wording of one email (admin)' })
  saveEmail(@Param('key') key: string, @Body() dto: unknown) {
    return this.academy.saveEmail(key, dto);
  }

  @Delete('emails/:key')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Reset one email to its default wording (admin)' })
  resetEmail(@Param('key') key: string) {
    return this.academy.resetEmail(key);
  }

  /** Example values for previews and test sends. */
  private sampleVars(key: EmailKey, name: string | null): EmailVars {
    const path = key === 'PASSWORD_RESET' || key.endsWith('_INVITE') ? '/reset-password?token=example' : '/login';
    return { name, url: `${this.mail.webAppUrl}${key === 'REGISTRATION_INVITE' ? '/register' : path}`, expiryDays: 7 };
  }

  @Post('emails/:key/preview')
  @Roles('COACH')
  @AdminOnly()
  @ApiOperation({ summary: 'Render a draft of one email for the editor preview (admin)' })
  async preview(@Param('key') key: string, @Body() dto: unknown) {
    const draft = this.academy.parseEmailContent(key, dto);
    const def = emailDef(key)!;
    const { subject, html } = await this.mail.render(def.key, this.sampleVars(def.key, 'Jordan'), draft, true);
    return { subject, html };
  }

  @Post('emails/:key/test')
  @Roles('COACH')
  @AdminOnly()
  @Throttle({ short: { limit: 10, ttl: 600_000 } })
  @ApiOperation({ summary: 'Email a draft of one email to the signed-in admin (admin)' })
  async test(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Body() dto: unknown) {
    const draft = this.academy.parseEmailContent(key, dto);
    const def = emailDef(key)!;
    const me = await this.academy.userContact(req.user!.sub);
    const to = me.email;
    const firstName = me.name?.trim().split(/s+/)[0] || null;
    const emailed = await this.mail.sendTemplate(def.key, to, this.sampleVars(def.key, firstName), draft);
    return { emailed, to };
  }
}
