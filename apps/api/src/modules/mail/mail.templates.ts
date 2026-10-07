/**
 * HTML builders for the app's transactional emails. Kept dependency-free and
 * table-based with inline styles — the only layout that survives across Gmail,
 * Outlook, and Apple Mail. Palette matches the app's institutional navy.
 */

const NAVY = '#1f2a44';
const ACCENT = '#3d8bfd';
const TEXT = '#1a1f2b';
const MUTED = '#6b7280';
const BG = '#f4f6fa';

// The email header logo must be an ABSOLUTE, publicly-reachable URL (email
// clients can't load attached/relative images). Served from the web app's
// /public folder; WEB_APP_URL overrides the origin when the custom domain
// goes live. File: apps/web/public/email-logo.png (the BLACK logo — the
// existing logo.png is the white-on-transparent variant, invisible here).
const WEB_ORIGIN = (process.env.WEB_APP_URL || 'https://pdev-web.onrender.com').replace(/\/$/, '');
const LOGO_URL = `${WEB_ORIGIN}/email-logo.png`;

/** Shared shell: logo-less wordmark header + white card + footer. */
function shell(bodyHtml: string): string {
  return `
  <div style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr><td align="center" style="padding:4px 4px 20px;text-align:center;">
            <img src="${LOGO_URL}" alt="Defined Baseball Academy" width="160"
              style="display:block;width:160px;max-width:62%;height:auto;margin:0 auto;" />
          </td></tr>
          <tr><td style="background:#ffffff;border:1px solid #e4e8f0;border-radius:14px;padding:28px 26px;">
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:16px 6px 4px;">
            <p style="margin:0;font-size:11px;color:${MUTED};line-height:1.6;">
              Assess · Train · Perform — Defined Baseball Academy player development.<br/>
              You received this because your email is on file for a Defined Baseball Academy account.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 26px;border-radius:9px;">${label}</a>`;
}

/** Password-reset email. `resetUrl` already carries the token query param. */
export function passwordResetEmail(resetUrl: string, name?: string | null): { subject: string; html: string; text: string } {
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:19px;color:${TEXT};">Reset your password</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">
      We received your request to reset your Defined Baseball Academy Account password. Click below to reset your password. This link is active for <strong>1 hour</strong>.
    </p>
    <p style="margin:0 0 22px;">${button(resetUrl, 'Reset Password')}</p>
    <p style="margin:0 0 6px;font-size:12px;color:${MUTED};line-height:1.6;">
      If the button doesn't work, paste this link into your browser:<br/>
      <a href="${resetUrl}" style="color:${ACCENT};word-break:break-all;">${resetUrl}</a>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:${MUTED};line-height:1.6;">
      Didn't request this? You can safely ignore this email — your password won't change.
    </p>
  `);
  const text = `We received your request to reset your Defined Baseball Academy Account password. Open this link within 1 hour to reset your password:\n\n${resetUrl}\n\nDidn't request this? Ignore this email — your password won't change.`;
  return { subject: 'Reset your Defined Baseball Academy password', html, text };
}

/** Welcome email sent when a coach approves a pending player. */
export function welcomeEmail(loginUrl: string, name?: string | null): { subject: string; html: string; text: string } {
  const hi = name?.trim() ? `Welcome, ${escapeHtml(name.trim())}!` : 'Welcome!';
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:19px;color:${TEXT};">${hi}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">
      Your Defined Baseball Academy account has been approved by your coach. You can now log in to view your reports, videos, training schedule, and progress.
    </p>
    <p style="margin:0 0 22px;">${button(loginUrl, 'Log In')}</p>
    <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
      Log in with the email and password you registered with. See you on the field.
    </p>
  `);
  const text = `${hi}\n\nYour Defined Baseball Academy account has been approved. Log in to view your reports, videos, training schedule, and progress:\n\n${loginUrl}\n\nUse the email and password you registered with.`;
  return { subject: 'Your Defined Baseball Academy account is approved', html, text };
}

/** Invite email — sent when a COACH creates an account on someone's behalf
 *  (e.g. converting an inquiry into a player profile). Distinct from
 *  `welcomeEmail`, which tells an approved self-registrant to log in with the
 *  password THEY chose. Here the athlete never picked one — the account is
 *  created with a random password — so the only useful call to action is a
 *  link to set it. Uses the same PasswordResetToken machinery as
 *  forgot-password, just with a much longer window: this is an onboarding
 *  email that may sit unread for days, where a 1-hour expiry would strand
 *  people. */
export function inviteEmail(
  setPasswordUrl: string,
  name?: string | null,
  expiryDays = 7,
): { subject: string; html: string; text: string } {
  const hi = name?.trim() ? `Welcome, ${escapeHtml(name.trim())}!` : 'Welcome!';
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:19px;color:${TEXT};">${hi}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">
      Your coach has created a Defined Baseball Academy account for you. Set a password
      to get in and view your reports, videos, training schedule, and progress.
    </p>
    <p style="margin:0 0 22px;">${button(setPasswordUrl, 'Set Your Password')}</p>
    <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
      This link is active for ${expiryDays} days. If it expires, use
      &ldquo;Forgot password?&rdquo; on the sign-in page to get a new one.
    </p>
  `);
  const text = `${hi}\n\nYour coach has created a Defined Baseball Academy account for you. Set a password to get in and view your reports, videos, training schedule, and progress:\n\n${setPasswordUrl}\n\nThis link is active for ${expiryDays} days. If it expires, use "Forgot password?" on the sign-in page.`;
  return { subject: 'Set up your Defined Baseball Academy account', html, text };
}

/** Coach invite — an admin added this coach from Settings → Staff. Same
 *  single-use set-password link as the athlete invite. */
export function coachInviteEmail(
  setPasswordUrl: string,
  name?: string | null,
  expiryDays = 7,
): { subject: string; html: string; text: string } {
  const hi = name?.trim() ? `Welcome, ${escapeHtml(name.trim())}!` : 'Welcome!';
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:19px;color:${TEXT};">${hi}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">
      You've been added as a coach on the Defined Baseball Academy app. Set a
      password to sign in and start working with your athletes.
    </p>
    <p style="margin:0 0 22px;">${button(setPasswordUrl, 'Set Your Password')}</p>
    <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
      This link is active for ${expiryDays} days. If it expires, use
      &ldquo;Forgot password?&rdquo; on the sign-in page to get a new one.
    </p>
  `);
  const text = `${hi}\n\nYou've been added as a coach on the Defined Baseball Academy app. Set a password to sign in:\n\n${setPasswordUrl}\n\nThis link is active for ${expiryDays} days. If it expires, use "Forgot password?" on the sign-in page.`;
  return { subject: 'You have been added as a coach at Defined Baseball Academy', html, text };
}

/** Coach-review email — sent to a player when a coach completes a review
 *  video on their profile. `reviewUrl` deep-links to their profile. */
export function coachReviewEmail(reviewUrl: string, name?: string | null): { subject: string; html: string; text: string } {
  const hi = name?.trim() ? `Hi ${escapeHtml(name.trim())},` : 'Hi,';
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:19px;color:${TEXT};">New coach review</h1>
    <p style="margin:0 0 8px;font-size:14px;color:${TEXT};line-height:1.6;">${hi}</p>
    <p style="margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">
      One of your coaches just completed a video review on your profile. Open the app to watch their breakdown and notes.
    </p>
    <p style="margin:0 0 22px;">${button(reviewUrl, 'View Coach Review')}</p>
    <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
      You can turn these emails off anytime under Settings → Notifications.
    </p>
  `);
  const text = `${hi}\n\nOne of your coaches just completed a video review on your profile. Watch it here:\n\n${reviewUrl}\n\nTurn these emails off anytime under Settings → Notifications.`;
  return { subject: 'A coach reviewed your video', html, text };
}

/** Profile-reminder email -- sent by a COACH, on demand, to nudge one
 *  athlete into filling in the personal information on their profile.
 *
 *  Deliberately NOT routed through the notification system: that is for
 *  event-driven mail with a per-subject opt-out, whereas this is a coach
 *  explicitly asking one athlete for missing account details -- the same
 *  shape as the invite email.
 *
 *  `loginUrl` points at the sign-in page rather than deep-linking the
 *  profile: the athlete is almost certainly signed out, so a deep link
 *  would bounce them to /login anyway. */
export function profileReminderEmail(loginUrl: string, name?: string | null): { subject: string; html: string; text: string } {
  const hi = name?.trim() ? `Hello ${escapeHtml(name.trim())},` : 'Hello,';
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:19px;color:${TEXT};">Complete your player profile</h1>
    <p style="margin:0 0 8px;font-size:14px;color:${TEXT};line-height:1.6;">${hi}</p>
    <p style="margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">
      Please complete filling out the personal information on your Defined Baseball Academy Player Profile.
    </p>
    <p style="margin:0 0 22px;">${button(loginUrl, 'Launch the App')}</p>
    <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
      If the button doesn&rsquo;t work, paste this link into your browser:<br/>
      <a href="${loginUrl}" style="color:${ACCENT};word-break:break-all;">${loginUrl}</a>
    </p>
  `);
  const text = `${hi}\n\nPlease complete filling out the personal information on your Defined Baseball Academy Player Profile.\n\nClick here to launch the app:\n\n${loginUrl}`;
  return { subject: 'Complete your Defined Baseball Academy player profile', html, text };
}

/** Registration invite -- a coach asks someone with NO account yet to fill
 *  in their player profile. Links to the public Create an Account form.
 *
 *  Not to be confused with `profileReminderEmail` (existing athlete, links
 *  to /login) or `inviteEmail` (account already created FOR them, links to
 *  a set-password token). Here no account and no token exist yet, so the
 *  link is a plain public URL with nothing to expire. */
export function registrationInviteEmail(registerUrl: string): { subject: string; html: string; text: string } {
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:19px;color:${TEXT};">Please complete your player profile</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">
      Your coach at Defined Baseball Academy has asked you to set up your player
      profile. It takes a couple of minutes, and it is what your reports,
      video and training plan get built on.
    </p>
    <p style="margin:0 0 22px;">${button(registerUrl, 'Create Your Account')}</p>
    <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
      If the button doesn&rsquo;t work, paste this link into your browser:<br/>
      <a href="${registerUrl}" style="color:${ACCENT};word-break:break-all;">${registerUrl}</a>
    </p>
  `);
  const text = `Please complete your player profile.\n\nYour coach at Defined Baseball Academy has asked you to set up your player profile. Create your account here:\n\n${registerUrl}`;
  return { subject: 'Please complete your player profile', html, text };
}

/** Minimal HTML-escape for interpolated user-provided names. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
