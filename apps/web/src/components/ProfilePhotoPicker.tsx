'use client';

/* Profile picture control for Edit Profile (coaches and the athlete).
   The picked image is centre-cropped to a square and shrunk to 400 × 400
   JPEG in the browser, then saved straight away -- it doesn't wait for the
   form's Save. */

import { useRef, useState } from 'react';
import * as api from '@/lib/api';
import { AthleteAvatar } from './AthleteAvatar';
import styles from './ProfilePhotoPicker.module.css';

const SIZE = 400;

export function ProfilePhotoPicker({ playerId, firstName, lastName, initialPhoto, onSave, onRemove, onChange }: {
  /** An athlete's photo. Omit and pass onSave/onRemove for anything else. */
  playerId?: string;
  firstName: string;
  lastName: string;
  initialPhoto: string | null | undefined;
  /** Store the cropped image; resolves to its new link. */
  onSave?: (dataUrl: string) => Promise<string>;
  onRemove?: () => Promise<void>;
  /** Told the new link (or null) after a save / remove. */
  onChange?: (photo: string | null) => void;
}) {
  const save = onSave ?? (async (dataUrl: string) => (await api.setPlayerPhoto(playerId!, dataUrl)).profilePhoto);
  const clear = onRemove ?? (async () => { await api.removePlayerPhoto(playerId!); });
  const [photo, setPhoto] = useState<string | null>(initialPhoto ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    setBusy(true);
    try {
      const dataUrl = await squareJpeg(file);
      const saved = await save(dataUrl);
      setPhoto(saved);
      onChange?.(saved);
    } catch (e: any) {
      setError(e?.message || 'The photo could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError('');
    setBusy(true);
    try {
      await clear();
      setPhoto(null);
      onChange?.(null);
    } catch (e: any) {
      setError(e?.message || 'The photo could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <AthleteAvatar photo={photo} firstName={firstName} lastName={lastName} className={styles.avatar} />
      <div className={styles.side}>
        <span className={styles.label}>Profile Picture</span>
        <div className={styles.buttons}>
          <button type="button" className={styles.btn} onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Saving…' : photo ? 'Change Photo' : 'Upload Photo'}
          </button>
          {photo && (
            <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} onClick={remove} disabled={busy}>
              Remove
            </button>
          )}
        </div>
        {error && <span className={styles.error} role="alert">{error}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}

/** Centre-crop to a square and shrink to SIZE × SIZE JPEG. */
async function squareJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('That image could not be read.');
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('That image could not be read.');
    ctx.fillStyle = '#ffffff';   // transparent PNGs get a white backing, not black
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
      0, 0, SIZE, SIZE,
    );
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (e: any) {
    throw new Error(e?.message?.includes('read') ? e.message : 'That image could not be read. Try a JPG or PNG.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
