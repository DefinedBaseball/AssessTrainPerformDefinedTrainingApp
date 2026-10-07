import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { hmacHex } from '../auth/jwt.util';
import { AcademyContact, EmailContent, EmailKey, emailDef } from '../mail/mail.templates';

/* Academy-wide settings (Settings → Academy, admins only), kept as JSON
   values in the AppSetting key/value table:
     academy           name, contact info, reply-to, new-athlete switch,
                       time zone, logo versions
     academyLogo:app   the in-app logo (white mark, sits on dark plates)
     academyLogo:email the email logo (dark mark, sits on white)
     emailTemplates    admin overrides of the email wording, by email key
   Read on every email send and public page load, so cached in memory and
   dropped on every save (the API runs as a single instance). */

export const DEFAULT_ACADEMY_NAME = 'Defined Baseball Academy';
export const DEFAULT_CLOSED_MESSAGE =
  "We aren't taking new athletes right now. Please check back soon.";

export type LogoKind = 'app' | 'email';

export interface AcademySettings {
  name: string;
  contact: AcademyContact;
  /** Where replies to app emails go; '' = no reply-to. */
  replyTo: string;
  acceptingAthletes: boolean;
  closedMessage: string;
  /** IANA zone, e.g. "America/Chicago"; '' = each device's own time. */
  timeZone: string;
  /** Upload timestamps -- cache-busters for the logo URLs; null = default logo. */
  logos: { app: number | null; email: number | null };
}

/** What the sign-in, sign-up and inquiry pages (no account) may see. */
export type PublicAcademy = Omit<AcademySettings, 'replyTo'>;

const SETTINGS_KEY = 'academy';
const EMAILS_KEY = 'emailTemplates';
const logoKey = (k: LogoKind) => `academyLogo:${k}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LOGO_BYTES = 1024 * 1024;

const EMPTY_CONTACT: AcademyContact = { phone: '', email: '', address: '', website: '', instagram: '', x: '' };

function defaults(): AcademySettings {
  return {
    name: DEFAULT_ACADEMY_NAME,
    contact: { ...EMPTY_CONTACT },
    replyTo: '',
    acceptingAthletes: true,
    closedMessage: DEFAULT_CLOSED_MESSAGE,
    timeZone: '',
    logos: { app: null, email: null },
  };
}

function parseJson(value: string | undefined | null): Record<string, any> {
  if (!value) return {};
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Sniff the real image type from its first bytes -- the claimed type is
 *  never trusted (an SVG or HTML file must not be served as the logo). */
function sniffImage(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

@Injectable()
export class AcademyService {
  private cache: AcademySettings | null = null;
  private emailCache: Partial<Record<EmailKey, EmailContent>> | null = null;

  constructor(private prisma: PrismaService) {}

  /* ── Settings ─────────────────────────────────────────────────────── */

  async get(): Promise<AcademySettings> {
    if (this.cache) return this.cache;
    const row = await this.prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const saved = parseJson(row?.value);
    const d = defaults();
    const c: Record<string, unknown> =
      saved.contact && typeof saved.contact === 'object' ? saved.contact : {};
    const settings: AcademySettings = {
      name: str(saved.name).trim() || d.name,
      contact: {
        phone: str(c.phone),
        email: str(c.email),
        address: str(c.address),
        website: str(c.website),
        instagram: str(c.instagram),
        x: str(c.x),
      },
      replyTo: str(saved.replyTo),
      acceptingAthletes: typeof saved.acceptingAthletes === 'boolean' ? saved.acceptingAthletes : true,
      closedMessage: str(saved.closedMessage).trim() || d.closedMessage,
      timeZone: str(saved.timeZone) && isValidTimeZone(saved.timeZone) ? saved.timeZone : '',
      logos: {
        app: typeof saved.logos?.app === 'number' ? saved.logos.app : null,
        email: typeof saved.logos?.email === 'number' ? saved.logos.email : null,
      },
    };
    this.cache = settings;
    return settings;
  }

  async getPublic(): Promise<PublicAcademy> {
    const { replyTo: _r, ...rest } = await this.get();
    return rest;
  }

  private async write(next: AcademySettings): Promise<AcademySettings> {
    const value = JSON.stringify(next);
    await this.prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value },
      update: { value },
    });
    this.cache = null;
    return this.get();
  }

  /** Save the editable fields. Named fields only -- logo versions are set by
   *  the logo routes, never from this body. */
  async save(input: unknown): Promise<AcademySettings> {
    if (!input || typeof input !== 'object') throw new BadRequestException('Settings must be an object');
    const b = input as Record<string, unknown>;
    const current = await this.get();

    const text = (v: unknown, max: number, field: string): string => {
      if (v === undefined || v === null) return '';
      if (typeof v !== 'string') throw new BadRequestException(`${field} must be text`);
      const t = v.trim();
      if (t.length > max) throw new BadRequestException(`${field} is too long`);
      return t;
    };

    const name = text(b.name, 80, 'Academy name').replace(/[\r\n<>"]+/g, ' ').trim();
    if (!name) throw new BadRequestException('Academy name is required');

    const rawContact = (b.contact && typeof b.contact === 'object' ? b.contact : {}) as Record<string, unknown>;
    const contact: AcademyContact = {
      phone: text(rawContact.phone, 40, 'Phone'),
      email: text(rawContact.email, 200, 'Contact email'),
      address: text(rawContact.address, 200, 'Address'),
      website: text(rawContact.website, 200, 'Website'),
      instagram: text(rawContact.instagram, 200, 'Instagram'),
      x: text(rawContact.x, 200, 'X'),
    };
    if (contact.email && !EMAIL_RE.test(contact.email))
      throw new BadRequestException("Contact email doesn't look like an email address");
    if (/^[a-z][a-z0-9+.-]*:/i.test(contact.website) && !/^https?:\/\//i.test(contact.website))
      throw new BadRequestException('Website must be a normal web address');

    const replyTo = text(b.replyTo, 200, 'Reply-to email');
    if (replyTo && !EMAIL_RE.test(replyTo))
      throw new BadRequestException("Reply-to email doesn't look like an email address");

    const timeZone = text(b.timeZone, 64, 'Time zone');
    if (timeZone && !isValidTimeZone(timeZone)) throw new BadRequestException('Unknown time zone');

    return this.write({
      name,
      contact,
      replyTo,
      acceptingAthletes: typeof b.acceptingAthletes === 'boolean' ? b.acceptingAthletes : current.acceptingAthletes,
      closedMessage: text(b.closedMessage, 400, 'Closed message') || DEFAULT_CLOSED_MESSAGE,
      timeZone,
      logos: current.logos,
    });
  }

  /* ── New athletes switch ──────────────────────────────────────────── */

  /** Code in a coach-sent registration link that opens the sign-up form even
   *  while new athletes are switched off. Stable, so links already sent keep
   *  working; it only skips the switch -- accounts still need approval. */
  registrationInviteCode(): string {
    return hmacHex('registration-invite').slice(0, 20);
  }

  isInviteCode(code: unknown): boolean {
    if (typeof code !== 'string' || !code) return false;
    const a = Buffer.from(code);
    const b = Buffer.from(this.registrationInviteCode());
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Throws the academy's closed message while new athletes are off. */
  async assertAccepting(inviteCode?: unknown): Promise<void> {
    const s = await this.get();
    if (s.acceptingAthletes || this.isInviteCode(inviteCode)) return;
    throw new ForbiddenException(s.closedMessage);
  }

  /* ── Logos ────────────────────────────────────────────────────────── */

  async setLogo(kind: LogoKind, dataUrl: unknown): Promise<AcademySettings> {
    if (typeof dataUrl !== 'string') throw new BadRequestException('Choose an image file');
    const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!m) throw new BadRequestException('Choose an image file');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_LOGO_BYTES) throw new BadRequestException('Logo must be under 1 MB');
    const mime = sniffImage(buf);
    if (!mime) throw new BadRequestException('Logo must be a PNG, JPG or WebP image');
    /* Outlook can't show WebP -- keep the email logo to PNG/JPG. */
    if (kind === 'email' && mime === 'image/webp')
      throw new BadRequestException('The email logo must be a PNG or JPG (some email apps can\'t show WebP)');

    const v = Date.now();
    const value = JSON.stringify({ mime, data: buf.toString('base64'), v });
    await this.prisma.appSetting.upsert({
      where: { key: logoKey(kind) },
      create: { key: logoKey(kind), value },
      update: { value },
    });
    const current = await this.get();
    return this.write({ ...current, logos: { ...current.logos, [kind]: v } });
  }

  async removeLogo(kind: LogoKind): Promise<AcademySettings> {
    await this.prisma.appSetting.deleteMany({ where: { key: logoKey(kind) } });
    const current = await this.get();
    return this.write({ ...current, logos: { ...current.logos, [kind]: null } });
  }

  async getLogo(kind: LogoKind): Promise<{ mime: string; data: Buffer }> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: logoKey(kind) } });
    const saved = parseJson(row?.value);
    if (!saved.data || !saved.mime) throw new NotFoundException('No logo uploaded');
    return { mime: saved.mime, data: Buffer.from(saved.data, 'base64') };
  }

  /** Current email + name of a user (test emails go to the admin's address
   *  as it is now, not as it was when their token was issued). */
  async userContact(userId: string): Promise<{ email: string; name: string | null }> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  /* ── Email wording ────────────────────────────────────────────────── */

  async emailOverrides(): Promise<Partial<Record<EmailKey, EmailContent>>> {
    if (this.emailCache) return this.emailCache;
    const row = await this.prisma.appSetting.findUnique({ where: { key: EMAILS_KEY } });
    const saved = parseJson(row?.value);
    const out: Partial<Record<EmailKey, EmailContent>> = {};
    for (const [k, v] of Object.entries(saved)) {
      if (!emailDef(k) || !v || typeof v !== 'object') continue;
      out[k as EmailKey] = { subject: str((v as any).subject), heading: str((v as any).heading), body: str((v as any).body) };
    }
    this.emailCache = out;
    return out;
  }

  /** The wording an email sends with right now (saved edit, else default). */
  async emailContent(key: EmailKey): Promise<EmailContent> {
    const def = emailDef(key);
    if (!def) throw new NotFoundException('Unknown email');
    return (await this.emailOverrides())[key] ?? def.defaults;
  }

  /** Validate a draft from the editor. */
  parseEmailContent(key: string, input: unknown): EmailContent {
    const def = emailDef(key);
    if (!def) throw new NotFoundException('Unknown email');
    const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const subject = str(b.subject).replace(/[\r\n]+/g, ' ').trim();
    const heading = str(b.heading).replace(/[\r\n]+/g, ' ').trim();
    const body = str(b.body).replace(/\r\n/g, '\n').trim();
    if (!subject) throw new BadRequestException('Subject is required');
    if (!body) throw new BadRequestException('Message is required');
    if (subject.length > 200) throw new BadRequestException('Subject is too long');
    if (heading.length > 200) throw new BadRequestException('Heading is too long');
    if (body.length > 5000) throw new BadRequestException('Message is too long');
    return { subject, heading, body };
  }

  private async writeOverrides(next: Partial<Record<EmailKey, EmailContent>>) {
    const value = JSON.stringify(next);
    await this.prisma.appSetting.upsert({
      where: { key: EMAILS_KEY },
      create: { key: EMAILS_KEY, value },
      update: { value },
    });
    this.emailCache = null;
  }

  async saveEmail(key: string, input: unknown): Promise<EmailContent> {
    const content = this.parseEmailContent(key, input);
    const def = emailDef(key)!;
    const next = { ...(await this.emailOverrides()) };
    const same =
      content.subject === def.defaults.subject &&
      content.heading === def.defaults.heading &&
      content.body === def.defaults.body;
    if (same) delete next[def.key];
    else next[def.key] = content;
    await this.writeOverrides(next);
    return this.emailContent(def.key);
  }

  async resetEmail(key: string): Promise<EmailContent> {
    const def = emailDef(key);
    if (!def) throw new NotFoundException('Unknown email');
    const next = { ...(await this.emailOverrides()) };
    delete next[def.key];
    await this.writeOverrides(next);
    return def.defaults;
  }
}
