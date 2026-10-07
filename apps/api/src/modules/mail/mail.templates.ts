/**
 * The app's transactional emails.
 *
 * Each email is a registry entry (EMAIL_DEFS) with default wording an admin
 * can override in Settings → Academy → Edit Emails: Subject, Heading and
 * Message. Everything that must stay correct -- the button and its link,
 * expiry notes, the paste-this-link fallback, logo and footer -- is fixed
 * here, so an edit can't break the email.
 *
 * Layout is table-based with inline styles -- the only layout that survives
 * across Gmail, Outlook and Apple Mail. Palette matches the app's navy.
 */

const ACCENT = '#3d8bfd';
const TEXT = '#1a1f2b';
const MUTED = '#6b7280';
const BG = '#f4f6fa';

export type EmailKey =
  | 'WELCOME'
  | 'ATHLETE_INVITE'
  | 'COACH_INVITE'
  | 'REGISTRATION_INVITE'
  | 'PASSWORD_RESET'
  | 'COACH_REVIEW'
  | 'PROFILE_REMINDER';

/** The admin-editable part of an email. */
export interface EmailContent {
  subject: string;
  heading: string;
  body: string;
}

/** Per-send values. `url` is the button's link. */
export interface EmailVars {
  name?: string | null;
  url: string;
  expiryDays?: number;
}

export interface AcademyContact {
  phone: string;
  email: string;
  address: string;
  website: string;
  instagram: string;
  x: string;
}

/** Academy branding every email is wrapped in. */
export interface EmailBrand {
  name: string;
  logoUrl: string;
  contact: AcademyContact;
}

export interface EmailDef {
  key: EmailKey;
  label: string;
  /** When the app sends it -- shown in the editor. */
  when: string;
  button: string;
  /** Fill-ins the message may use. {academy} always works. */
  placeholders: Array<'name' | 'academy'>;
  defaults: EmailContent;
  /** Fixed small print under the button (expiry etc.); '' for none. */
  note: (v: EmailVars) => string;
}

const inviteNote = (v: EmailVars) =>
  `This link is active for ${v.expiryDays ?? 7} days. If it expires, use "Forgot password?" on the sign-in page to get a new one.`;

export const EMAIL_DEFS: EmailDef[] = [
  {
    key: 'WELCOME',
    label: 'Welcome',
    when: 'A self-registered athlete is approved',
    button: 'Log In',
    placeholders: ['name', 'academy'],
    defaults: {
      subject: 'Your {academy} account is approved',
      heading: 'Welcome, {name}!',
      body:
        'Your {academy} account has been approved by your coach. You can now log in to view your reports, videos, training schedule, and progress.\n\n' +
        'Log in with the email and password you registered with. See you on the field.',
    },
    note: () => '',
  },
  {
    key: 'ATHLETE_INVITE',
    label: 'Athlete invite',
    when: 'A coach creates an athlete account and invites them',
    button: 'Set Your Password',
    placeholders: ['name', 'academy'],
    defaults: {
      subject: 'Set up your {academy} account',
      heading: 'Welcome, {name}!',
      body:
        'Your coach has created a {academy} account for you. Set a password to get in and view your reports, videos, training schedule, and progress.',
    },
    note: inviteNote,
  },
  {
    key: 'COACH_INVITE',
    label: 'Coach invite',
    when: 'An admin invites a coach from Settings → Staff',
    button: 'Set Your Password',
    placeholders: ['name', 'academy'],
    defaults: {
      subject: 'You have been added as a coach at {academy}',
      heading: 'Welcome, {name}!',
      body:
        "You've been added as a coach on the {academy} app. Set a password to sign in and start working with your athletes.",
    },
    note: inviteNote,
  },
  {
    key: 'REGISTRATION_INVITE',
    label: 'Registration invite',
    when: 'A coach emails someone the link to the sign-up form',
    button: 'Create Your Account',
    placeholders: ['academy'],
    defaults: {
      subject: 'Please complete your player profile',
      heading: 'Please complete your player profile',
      body:
        'Your coach at {academy} has asked you to set up your player profile. It takes a couple of minutes, and it is what your reports, video and training plan get built on.',
    },
    note: () => '',
  },
  {
    key: 'PASSWORD_RESET',
    label: 'Password reset',
    when: 'Someone clicks "Forgot password?"',
    button: 'Reset Password',
    placeholders: ['name', 'academy'],
    defaults: {
      subject: 'Reset your {academy} password',
      heading: 'Reset your password',
      body: 'We received your request to reset your {academy} account password. Click below to choose a new one.',
    },
    note: () =>
      "This link is active for 1 hour. Didn't request this? You can safely ignore this email — your password won't change.",
  },
  {
    key: 'COACH_REVIEW',
    label: 'Coach Review',
    when: 'A coach completes a video review for an athlete',
    button: 'View Coach Review',
    placeholders: ['name', 'academy'],
    defaults: {
      subject: 'A coach reviewed your video',
      heading: 'New coach review',
      body:
        'Hi {name},\n\nOne of your coaches just completed a video review on your profile. Open the app to watch their breakdown and notes.',
    },
    note: () => '',
  },
  {
    key: 'PROFILE_REMINDER',
    label: 'Profile reminder',
    when: 'A coach nudges an athlete to finish their profile',
    button: 'Launch the App',
    placeholders: ['name', 'academy'],
    defaults: {
      subject: 'Complete your {academy} player profile',
      heading: 'Complete your player profile',
      body:
        'Hello {name},\n\nPlease complete filling out the personal information on your {academy} Player Profile.',
    },
    note: () => '',
  },
];

export function emailDef(key: string): EmailDef | undefined {
  return EMAIL_DEFS.find((d) => d.key === key);
}

/* ── Rendering ──────────────────────────────────────────────────────── */

/** Swap in {academy} and {name}. With no name, the {name} is dropped and the
 *  punctuation around it tidied: "Welcome, {name}!" → "Welcome!",
 *  "Hi {name}," → "Hi,". */
export function fillPlaceholders(text: string, name: string | null | undefined, academy: string): string {
  const who = name?.trim() || '';
  return text
    .split('\n')
    .map((line) => {
      const out = line.split('{academy}').join(academy);
      if (!out.includes('{name}')) return out;
      if (who) return out.split('{name}').join(who);
      return out
        .split('{name}')
        .join('')
        .replace(/,?[ \t]+(?=[!?.,:;])/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    })
    .join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Social handle or URL → profile URL (http/https only). */
export function socialUrl(kind: 'instagram' | 'x', value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
  if (!handle) return null;
  return kind === 'instagram' ? `https://instagram.com/${handle}` : `https://x.com/${handle}`;
}

/** Website as entered → URL (http/https only). */
export function websiteUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null; // some other scheme -- never link it
  return `https://${v}`;
}

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 26px;border-radius:9px;">${escapeHtml(label)}</a>`;
}

function paragraphsHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:14px;color:${TEXT};line-height:1.6;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`,
    )
    .join('');
}

function footerHtml(brand: EmailBrand): string {
  const c = brand.contact;
  const facts = [c.phone, c.email, c.address].map((s) => s.trim()).filter(Boolean).map(escapeHtml);
  const links: string[] = [];
  const site = websiteUrl(c.website);
  if (site) links.push(`<a href="${escapeHtml(site)}" style="color:${MUTED};">Website</a>`);
  const ig = socialUrl('instagram', c.instagram);
  if (ig) links.push(`<a href="${escapeHtml(ig)}" style="color:${MUTED};">Instagram</a>`);
  const x = socialUrl('x', c.x);
  if (x) links.push(`<a href="${escapeHtml(x)}" style="color:${MUTED};">X</a>`);
  const name = escapeHtml(brand.name);
  return `
    <p style="margin:0 0 4px;font-size:11px;color:${MUTED};line-height:1.6;font-weight:700;">${name} &middot; Assess &middot; Train &middot; Perform</p>
    ${facts.length ? `<p style="margin:0 0 4px;font-size:11px;color:${MUTED};line-height:1.6;">${facts.join(' &middot; ')}</p>` : ''}
    ${links.length ? `<p style="margin:0 0 4px;font-size:11px;color:${MUTED};line-height:1.6;">${links.join(' &middot; ')}</p>` : ''}
    <p style="margin:6px 0 0;font-size:11px;color:${MUTED};line-height:1.6;">You received this email from ${name}.</p>`;
}

function footerText(brand: EmailBrand): string {
  const c = brand.contact;
  return [
    `${brand.name} · Assess · Train · Perform`,
    [c.phone, c.email, c.address].map((s) => s.trim()).filter(Boolean).join(' · '),
    [websiteUrl(c.website), socialUrl('instagram', c.instagram), socialUrl('x', c.x)].filter(Boolean).join(' · '),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Build the final email from content (saved or draft), per-send values and
 *  the academy's branding. */
export function renderEmail(
  def: EmailDef,
  content: EmailContent,
  vars: EmailVars,
  brand: EmailBrand,
): { subject: string; html: string; text: string } {
  const fill = (s: string) => fillPlaceholders(s, vars.name, brand.name);
  const subject =
    fill(content.subject).replace(/[\r\n]+/g, ' ').trim() || fill(def.defaults.subject);
  const heading = fill(content.heading).replace(/[\r\n]+/g, ' ').trim();
  const body = fill(content.body).trim();
  const note = def.note(vars);
  const url = vars.url;

  const html = `
  <div style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr><td align="center" style="padding:4px 4px 20px;text-align:center;">
            <img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" width="160"
              style="display:block;width:160px;max-width:62%;height:auto;margin:0 auto;" />
          </td></tr>
          <tr><td style="background:#ffffff;border:1px solid #e4e8f0;border-radius:14px;padding:28px 26px;">
            ${heading ? `<h1 style="margin:0 0 12px;font-size:19px;color:${TEXT};">${escapeHtml(heading)}</h1>` : ''}
            ${paragraphsHtml(body)}
            <p style="margin:8px 0 22px;">${button(url, def.button)}</p>
            ${note ? `<p style="margin:0 0 10px;font-size:12px;color:${MUTED};line-height:1.6;">${escapeHtml(note)}</p>` : ''}
            <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
              If the button doesn&rsquo;t work, paste this link into your browser:<br/>
              <a href="${escapeHtml(url)}" style="color:${ACCENT};word-break:break-all;">${escapeHtml(url)}</a>
            </p>
          </td></tr>
          <tr><td style="padding:16px 6px 4px;">
            ${footerHtml(brand)}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;

  const text = [heading, body, `${def.button}: ${url}`, note, '--', footerText(brand)]
    .filter(Boolean)
    .join('\n\n');

  return { subject, html, text };
}
