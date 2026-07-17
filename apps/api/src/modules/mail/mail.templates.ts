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

/** Shared shell: logo-less wordmark header + white card + footer. */
function shell(bodyHtml: string): string {
  return `
  <div style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr><td style="padding:4px 4px 18px;">
            <span style="font-size:15px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${NAVY};">Defined Baseball</span>
          </td></tr>
          <tr><td style="background:#ffffff;border:1px solid #e4e8f0;border-radius:14px;padding:28px 26px;">
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:16px 6px 4px;">
            <p style="margin:0;font-size:11px;color:${MUTED};line-height:1.6;">
              Assess · Train · Perform — Defined Baseball player development.<br/>
              You received this because your email is on file for a Defined Baseball account.
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
  const hi = name?.trim() ? `Hi ${escapeHtml(name.trim())},` : 'Hi,';
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:19px;color:${TEXT};">Reset your password</h1>
    <p style="margin:0 0 8px;font-size:14px;color:${TEXT};line-height:1.6;">${hi}</p>
    <p style="margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">
      We got a request to reset the password on your Defined Baseball account. Click below to choose a new one — the link is good for <strong>1 hour</strong>.
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
  const text = `${hi}\n\nWe got a request to reset your Defined Baseball password. Open this link within 1 hour to choose a new one:\n\n${resetUrl}\n\nDidn't request this? Ignore this email — your password won't change.`;
  return { subject: 'Reset your Defined Baseball password', html, text };
}

/** Welcome email sent when a coach approves a pending player. */
export function welcomeEmail(loginUrl: string, name?: string | null): { subject: string; html: string; text: string } {
  const hi = name?.trim() ? `Welcome, ${escapeHtml(name.trim())}!` : 'Welcome!';
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:19px;color:${TEXT};">${hi}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">
      Your Defined Baseball account has been approved by your coach. You can now log in to view your reports, videos, training schedule, and progress.
    </p>
    <p style="margin:0 0 22px;">${button(loginUrl, 'Log In')}</p>
    <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
      Log in with the email and password you registered with. See you on the field.
    </p>
  `);
  const text = `${hi}\n\nYour Defined Baseball account has been approved. Log in to view your reports, videos, training schedule, and progress:\n\n${loginUrl}\n\nUse the email and password you registered with.`;
  return { subject: 'Your Defined Baseball account is approved', html, text };
}

/** Minimal HTML-escape for interpolated user-provided names. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
