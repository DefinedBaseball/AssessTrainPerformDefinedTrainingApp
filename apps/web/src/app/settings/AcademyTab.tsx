'use client';

/* Settings → Academy (admins only).

   One form for the academy's name, contact info, email reply-to, the
   new-athlete switch and the time zone (saved together), plus two things
   that save on their own: the logos (on upload) and the email wording
   (the Edit Emails window). After any save the app-wide academy data is
   refreshed so the sidebar, tab title and time zone update at once. */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { useAcademy } from '@/lib/academy';
import styles from './page.module.css';

const US_ZONES: Array<{ value: string; label: string }> = [
  { value: 'America/New_York', label: 'Eastern Time' },
  { value: 'America/Chicago', label: 'Central Time' },
  { value: 'America/Denver', label: 'Mountain Time' },
  { value: 'America/Phoenix', label: 'Arizona (no daylight saving)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time' },
  { value: 'America/Anchorage', label: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
];

const MAX_LOGO_BYTES = 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that file'));
    r.readAsDataURL(file);
  });
}

function toInput(s: api.AcademySettings): api.AcademySettingsInput {
  const { logos: _l, ...rest } = s;
  return { ...rest, contact: { ...s.contact } };
}

export function AcademyTab() {
  const { refresh: refreshAcademy } = useAcademy();
  const [settings, setSettings] = useState<api.AcademySettings | null>(null);
  const [draft, setDraft] = useState<api.AcademySettingsInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  const [emailsOpen, setEmailsOpen] = useState(false);

  useEffect(() => {
    api.getAcademySettings()
      .then((s) => { setSettings(s); setDraft(toInput(s)); })
      .catch((e) => setError(e?.message || 'Could not load academy settings'));
  }, []);

  const dirty = useMemo(
    () => !!settings && !!draft && JSON.stringify(toInput(settings)) !== JSON.stringify(draft),
    [settings, draft],
  );

  const set = <K extends keyof api.AcademySettingsInput>(key: K, value: api.AcademySettingsInput[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  const setContact = (key: keyof api.AcademyContact, value: string) =>
    setDraft((d) => (d ? { ...d, contact: { ...d.contact, [key]: value } } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const next = await api.saveAcademySettings(draft);
      setSettings(next);
      setDraft(toInput(next));
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(0), 2500);
      void refreshAcademy();
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  /* Logos save on upload and only touch the logo versions, so keep the
     rest of the draft as the admin has it. */
  const onLogoChange = (next: api.AcademySettings) => {
    setSettings((s) => (s ? { ...s, logos: next.logos } : next));
    void refreshAcademy();
  };

  if (!draft || !settings) {
    return (
      <div className={styles.section}>
        <div className={styles.card}>
          {error ? <div className={`${styles.feedback} ${styles.feedbackErr}`}>{error}</div> : <div className={styles.empty}>Loading…</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      {/* ── Name + logos ── */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Academy</h3>
        <p className={styles.cardDesc}>Your name and logo show across the app, on the sign-in and sign-up pages, and on every email.</p>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Academy name</span>
            <span className={styles.rowSub}>Also the sender name on emails and the browser tab title</span>
          </div>
          <input className={styles.input} value={draft.name} maxLength={80}
            onChange={(e) => set('name', e.target.value)} placeholder="Defined Baseball Academy" />
        </div>
        <div className={styles.logoGrid}>
          <LogoSlot
            kind="app"
            title="App logo"
            hint="A white or light logo — it sits on dark backgrounds (sidebar, sign-in). PNG, JPG or WebP, under 1 MB."
            version={settings.logos.app}
            fallback="/logo.png"
            dark
            onChange={onLogoChange}
          />
          <LogoSlot
            kind="email"
            title="Email logo"
            hint="A dark logo — it sits on white at the top of every email. PNG or JPG, under 1 MB."
            version={settings.logos.email}
            fallback="/email-logo.png"
            onChange={onLogoChange}
          />
        </div>
      </div>

      {/* ── Contact info ── */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Contact Info</h3>
        <p className={styles.cardDesc}>Shows at the bottom of every email and on the sign-up and inquiry pages. Leave anything blank to hide it.</p>
        <div className={styles.contactGrid}>
          <label className={styles.field}><span>Phone</span>
            <input className={styles.input} type="tel" value={draft.contact.phone} maxLength={40}
              onChange={(e) => setContact('phone', e.target.value)} placeholder="(555) 123-4567" /></label>
          <label className={styles.field}><span>Email</span>
            <input className={styles.input} type="email" value={draft.contact.email} maxLength={200}
              onChange={(e) => setContact('email', e.target.value)} placeholder="info@youracademy.com" /></label>
          <label className={`${styles.field} ${styles.fieldWide}`}><span>Address</span>
            <input className={styles.input} value={draft.contact.address} maxLength={200}
              onChange={(e) => setContact('address', e.target.value)} placeholder="123 Main St, City, ST 12345" /></label>
          <label className={styles.field}><span>Website</span>
            <input className={styles.input} value={draft.contact.website} maxLength={200}
              onChange={(e) => setContact('website', e.target.value)} placeholder="yourwebsite.com" /></label>
          <label className={styles.field}><span>Instagram</span>
            <input className={styles.input} value={draft.contact.instagram} maxLength={200}
              onChange={(e) => setContact('instagram', e.target.value)} placeholder="@handle or link" /></label>
          <label className={styles.field}><span>X</span>
            <input className={styles.input} value={draft.contact.x} maxLength={200}
              onChange={(e) => setContact('x', e.target.value)} placeholder="@handle or link" /></label>
        </div>
      </div>

      {/* ── Emails ── */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Emails</h3>
        <p className={styles.cardDesc}>Change what each email the app sends says, and where replies go.</p>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Email wording</span>
            <span className={styles.rowSub}>Subject, heading and message of all 7 emails</span>
          </div>
          <button className={styles.btnSecondary} onClick={() => setEmailsOpen(true)}>Edit Emails</button>
        </div>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Reply-to email</span>
            <span className={styles.rowSub}>When an athlete or parent hits Reply, it goes here. Blank = replies go nowhere.</span>
          </div>
          <input className={styles.input} type="email" value={draft.replyTo} maxLength={200}
            onChange={(e) => set('replyTo', e.target.value)} placeholder="info@yourwebsite.com" />
        </div>
      </div>

      {/* ── New athletes ── */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>New Athletes</h3>
        <p className={styles.cardDesc}>
          When off, the public sign-up and inquiry forms show your message instead. Sign-up links a coach emails
          from the app still work.
        </p>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <span className={styles.rowTitle}>Accepting new athletes</span>
            <span className={styles.rowSub}>{draft.acceptingAthletes ? 'Sign-up and inquiry forms are open' : 'Sign-up and inquiry forms are closed'}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.acceptingAthletes}
            aria-label="Accepting new athletes"
            className={`${styles.toggle} ${draft.acceptingAthletes ? styles.toggleOn : ''}`}
            onClick={() => set('acceptingAthletes', !draft.acceptingAthletes)}
          />
        </div>
        {!draft.acceptingAthletes && (
          <label className={styles.field} style={{ marginTop: 10 }}>
            <span>Message people see</span>
            <textarea className={`${styles.input} ${styles.textarea}`} rows={3} maxLength={400}
              value={draft.closedMessage} onChange={(e) => set('closedMessage', e.target.value)}
              placeholder="We're full for the fall — check back in December." />
          </label>
        )}
      </div>

      {/* ── Time zone ── */}
      <TimeZoneCard value={draft.timeZone} onChange={(tz) => set('timeZone', tz)} />

      {/* ── Save bar ── */}
      <div className={styles.saveBar}>
        {error && <span className={styles.feedbackErr} style={{ fontSize: 13 }}>{error}</span>}
        {!error && savedAt > 0 && <span className={styles.feedbackOk} style={{ fontSize: 13, fontWeight: 600 }}>Saved</span>}
        {!error && !savedAt && dirty && <span className={styles.rowSub}>Unsaved changes</span>}
        {dirty && (
          <button className={styles.btnSecondary} onClick={() => { setDraft(toInput(settings)); setError(''); }} disabled={saving}>
            Discard
          </button>
        )}
        <button className={styles.btn} onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save Academy Settings'}
        </button>
      </div>

      {emailsOpen && <EmailEditor onClose={() => setEmailsOpen(false)} />}
    </div>
  );
}

/* ── Logo upload slot ─────────────────────────────────────────────────── */

function LogoSlot({
  kind, title, hint, version, fallback, dark, onChange,
}: {
  kind: 'app' | 'email';
  title: string;
  hint: string;
  version: number | null;
  fallback: string;
  dark?: boolean;
  onChange: (s: api.AcademySettings) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const src = version ? `/api/academy/logo/${kind}?v=${version}` : fallback;

  const upload = async (file: File) => {
    setError('');
    const okTypes = kind === 'email' ? ['image/png', 'image/jpeg'] : ['image/png', 'image/jpeg', 'image/webp'];
    if (!okTypes.includes(file.type)) {
      setError(kind === 'email' ? 'Use a PNG or JPG' : 'Use a PNG, JPG or WebP');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) { setError('Logo must be under 1 MB'); return; }
    setBusy(true);
    try {
      onChange(await api.uploadAcademyLogo(kind, await readAsDataUrl(file)));
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      onChange(await api.removeAcademyLogo(kind));
    } catch (e: any) {
      setError(e?.message || 'Could not reset the logo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.logoSlot}>
      <div className={styles.rowTitle}>{title}</div>
      <div className={`${styles.logoPreview} ${dark ? styles.logoPreviewDark : styles.logoPreviewLight}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${title} preview`} />
      </div>
      <p className={styles.rowSub} style={{ margin: 0 }}>{hint}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={styles.btnSecondary} onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Working…' : version ? 'Replace' : 'Upload'}
        </button>
        {version && (
          <button className={styles.btnSecondary} onClick={() => void reset()} disabled={busy}>Use default</button>
        )}
      </div>
      {error && <span className={styles.feedbackErr} style={{ fontSize: 12 }}>{error}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={kind === 'email' ? 'image/png,image/jpeg' : 'image/png,image/jpeg,image/webp'}
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }}
      />
    </div>
  );
}

/* ── Time zone ────────────────────────────────────────────────────────── */

function TimeZoneCard({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const allZones = useMemo<string[]>(() => {
    try {
      const list = (Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined;
      return (list ?? []).filter((z) => !US_ZONES.some((u) => u.value === z));
    } catch {
      return [];
    }
  }, []);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const preview = (() => {
    try {
      return now.toLocaleString('en-US', {
        ...(value ? { timeZone: value } : {}),
        weekday: 'short', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return '';
    }
  })();
  const known = !value || US_ZONES.some((u) => u.value === value) || allZones.includes(value);

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>Time Zone</h3>
      <p className={styles.cardDesc}>
        Times on messages, alerts, reports, videos, posts and live sessions show in this zone for everyone, so a
        remote athlete sees the same time you do. Calendar days and birthdays aren&apos;t affected.
      </p>
      <div className={styles.row}>
        <div className={styles.rowLabel}>
          <span className={styles.rowTitle}>Academy time zone</span>
          <span className={styles.rowSub}>{preview ? `It's ${preview} there now` : ''}</span>
        </div>
        <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Each device&apos;s own time</option>
          <optgroup label="United States">
            {US_ZONES.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
          </optgroup>
          {allZones.length > 0 && (
            <optgroup label="All time zones">
              {allZones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </optgroup>
          )}
          {!known && <option value={value}>{value}</option>}
        </select>
      </div>
    </div>
  );
}

/* ── Edit Emails window ───────────────────────────────────────────────── */

const PLACEHOLDER_HELP: Record<'name' | 'academy', string> = {
  name: "the person's first name",
  academy: 'your academy name',
};

function EmailEditor({ onClose }: { onClose: () => void }) {
  const [emails, setEmails] = useState<api.AcademyEmail[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [draft, setDraft] = useState<api.EmailContent | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'reset' | 'test'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<'subject' | 'heading' | 'body'>('body');
  const subjectRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getAcademyEmails()
      .then((list) => {
        setEmails(list);
        if (list[0]) { setSelected(list[0].key); setDraft({ ...list[0].current }); }
      })
      .catch((e) => setMsg({ ok: false, text: e?.message || 'Could not load emails' }));
  }, []);

  /* Escape closes (after the unsaved-changes check). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const current = emails?.find((e) => e.key === selected) ?? null;
  const dirty = !!current && !!draft && JSON.stringify(current.current) !== JSON.stringify(draft);
  const isDefault = !!current && !!draft && JSON.stringify(current.defaults) === JSON.stringify(draft);

  /* Live preview, debounced while typing. */
  useEffect(() => {
    if (!current || !draft) return;
    if (!draft.subject.trim() || !draft.body.trim()) {
      setPreviewError('Subject and message are both required.');
      return;
    }
    const t = window.setTimeout(() => {
      api.previewAcademyEmail(current.key, draft)
        .then((p) => { setPreview(p); setPreviewError(''); })
        .catch((e) => setPreviewError(e?.message || 'Preview failed'));
    }, 350);
    return () => window.clearTimeout(t);
  }, [current, draft]);

  const pick = (key: string) => {
    if (key === selected) return;
    if (dirty && !window.confirm('Discard your unsaved changes to this email?')) return;
    const next = emails?.find((e) => e.key === key);
    if (!next) return;
    setSelected(key);
    setDraft({ ...next.current });
    setPreview(null);
    setMsg(null);
    setConfirmReset(false);
  };

  function requestClose() {
    if (dirty && !window.confirm('Discard your unsaved changes to this email?')) return;
    onClose();
  }

  const insert = (token: string) => {
    if (!draft) return;
    const field = lastFocused.current;
    const el = field === 'body' ? bodyRef.current : field === 'subject' ? subjectRef.current : headingRef.current;
    const text = draft[field];
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    setDraft({ ...draft, [field]: next });
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const updateList = (key: string, content: api.EmailContent) => {
    setEmails((list) => list?.map((e) => (e.key === key
      ? { ...e, current: content, customized: JSON.stringify(content) !== JSON.stringify(e.defaults) }
      : e)) ?? null);
  };

  const save = async () => {
    if (!current || !draft) return;
    setBusy('save');
    setMsg(null);
    try {
      const saved = await api.saveAcademyEmail(current.key, draft);
      updateList(current.key, saved);
      setDraft({ ...saved });
      setMsg({ ok: true, text: 'Saved — the app sends this wording from now on.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not save' });
    } finally {
      setBusy('');
    }
  };

  const reset = async () => {
    if (!current) return;
    setBusy('reset');
    setMsg(null);
    try {
      const d = await api.resetAcademyEmail(current.key);
      updateList(current.key, d);
      setDraft({ ...d });
      setConfirmReset(false);
      setMsg({ ok: true, text: 'Back to the default wording.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not reset' });
    } finally {
      setBusy('');
    }
  };

  const sendTest = async () => {
    if (!current || !draft) return;
    setBusy('test');
    setMsg(null);
    try {
      const r = await api.testAcademyEmail(current.key, draft);
      setMsg(r.emailed
        ? { ok: true, text: `Test sent to ${r.to}.` }
        : { ok: false, text: 'Email sending is not set up on this server, so the test was not sent.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not send the test' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={styles.emailOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div className={styles.emailModal} role="dialog" aria-modal="true" aria-label="Edit emails">
        <div className={styles.emailModalHead}>
          <h3 className={styles.cardTitle} style={{ margin: 0 }}>Edit Emails</h3>
          <button className={styles.iconBtn} onClick={requestClose} aria-label="Close">×</button>
        </div>

        {!emails || !current || !draft ? (
          <div className={styles.empty}>{msg?.text || 'Loading…'}</div>
        ) : (
          <div className={styles.emailBody}>
            {/* List (a dropdown on phones) */}
            <div className={styles.emailList}>
              {emails.map((e) => (
                <button
                  key={e.key}
                  className={`${styles.emailItem} ${e.key === selected ? styles.emailItemActive : ''}`}
                  onClick={() => pick(e.key)}
                >
                  <span className={styles.rowTitle}>
                    {e.label}
                    {e.customized && <span className={styles.editedBadge}>Edited</span>}
                  </span>
                  <span className={styles.rowSub}>{e.when}</span>
                </button>
              ))}
            </div>
            <select className={`${styles.select} ${styles.emailSelect}`} value={selected} onChange={(e) => pick(e.target.value)}>
              {emails.map((e) => <option key={e.key} value={e.key}>{e.label}{e.customized ? ' (edited)' : ''}</option>)}
            </select>

            {/* Editor */}
            <div className={styles.emailEditor}>
              <p className={styles.rowSub} style={{ margin: 0 }}>Sent when: {current.when}</p>
              <label className={styles.field}><span>Subject</span>
                <input ref={subjectRef} className={styles.input} value={draft.subject} maxLength={200}
                  onFocus={() => { lastFocused.current = 'subject'; }}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
              <label className={styles.field}><span>Heading</span>
                <input ref={headingRef} className={styles.input} value={draft.heading} maxLength={200}
                  onFocus={() => { lastFocused.current = 'heading'; }}
                  onChange={(e) => setDraft({ ...draft, heading: e.target.value })} /></label>
              <label className={styles.field}><span>Message</span>
                <textarea ref={bodyRef} className={`${styles.input} ${styles.textarea}`} rows={8} maxLength={5000}
                  value={draft.body}
                  onFocus={() => { lastFocused.current = 'body'; }}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
              <div className={styles.placeholderRow}>
                <span className={styles.rowSub}>Insert:</span>
                {(['name', 'academy'] as const)
                  .filter((p) => p === 'academy' || current.placeholders.includes(p))
                  .map((p) => (
                    <button key={p} type="button" className={styles.chip} onClick={() => insert(`{${p}}`)}
                      title={`Replaced with ${PLACEHOLDER_HELP[p]}`}>
                      {`{${p}}`}
                    </button>
                  ))}
              </div>
              <p className={styles.rowSub} style={{ margin: 0 }}>
                A blank line starts a new paragraph. The &ldquo;{current.button}&rdquo; button, its link and any
                expiry note are added below your message automatically.
                {current.placeholders.includes('name') && ' If we don\'t know the name, {name} is left out.'}
              </p>

              <div className={styles.emailActions}>
                <button className={styles.btn} onClick={() => void save()} disabled={!dirty || !!busy}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
                <button className={styles.btnSecondary} onClick={() => void sendTest()} disabled={!!busy}>
                  {busy === 'test' ? 'Sending…' : 'Send test to me'}
                </button>
                {confirmReset ? (
                  <span className={styles.deleteConfirm} style={{ margin: 0 }}>
                    Reset to the default wording?
                    <button className={styles.btnDanger} onClick={() => void reset()} disabled={!!busy}>Yes, reset</button>
                    <button className={styles.btnSecondary} onClick={() => setConfirmReset(false)} disabled={!!busy}>No</button>
                  </span>
                ) : (
                  <button className={styles.btnSecondary} onClick={() => setConfirmReset(true)} disabled={!!busy || isDefault}>
                    Reset to default
                  </button>
                )}
              </div>
              {msg && <div className={`${styles.feedback} ${msg.ok ? styles.feedbackOk : styles.feedbackErr}`}>{msg.text}</div>}
            </div>

            {/* Preview */}
            <div className={styles.emailPreview}>
              <div className={styles.rowSub}>Preview (with example name &ldquo;Jordan&rdquo;)</div>
              <div className={styles.previewSubject}>
                <span className={styles.rowSub}>Subject:</span> {preview?.subject ?? '…'}
              </div>
              {previewError && <div className={`${styles.feedback} ${styles.feedbackErr}`}>{previewError}</div>}
              <iframe
                title="Email preview"
                className={styles.previewFrame}
                /* No scripts ever run in the preview. allow-same-origin only so
                   the logo loads past the site's same-origin image policy. */
                sandbox="allow-same-origin"
                /* <base> so the logo's /path resolves against this site inside
                   the sandboxed frame. */
                srcDoc={preview ? `<base href="${window.location.origin}/">${preview.html}` : ''}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
