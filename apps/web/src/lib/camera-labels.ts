/**
 * Per-camera friendly-label storage for Live Training's multi-angle
 * recording.
 *
 * OBS-style: every video input device (webcam, USB capture card,
 * built-in front/back camera) gets a user-defined name like "Side
 * Angle", "Behind Net", "Bullpen Mound". The label is saved in
 * localStorage keyed by the device's `deviceId` so it sticks across
 * sessions on the same browser. When a clip is recorded from that
 * device, the saved video's title appends the friendly label so the
 * gallery reads at a glance.
 *
 * Cross-device sync is intentionally out of scope here — the coach's
 * facility laptop is the source of truth. Moving to a different
 * machine resets to whatever defaults the browser reports
 * (`MediaDeviceInfo.label` — usually the manufacturer name).
 */

const LOCAL_STORAGE_KEY = 'camera.labels';

/** All saved labels, keyed by `MediaDeviceInfo.deviceId`. Read on
 *  every getter call so concurrent edits in another tab take effect
 *  the next time the Live Training UI re-reads. */
type LabelMap = Record<string, string>;

function readAll(): LabelMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Filter to string→string entries so a corrupted blob can't
    // poison the rest of the app.
    const clean: LabelMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string') clean[k] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

function writeAll(map: LabelMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(map));
    /* Fire a cross-component event so the Live Training capture
       page can re-read the labels live when the coach renames a
       camera in Settings without closing the session. */
    window.dispatchEvent(new CustomEvent('camera-labels:changed'));
  } catch { /* quota / disabled storage — silently no-op */ }
}

/** Read the friendly label for one camera. Returns the saved label
 *  when set, otherwise the fallback the caller supplies (typically
 *  `MediaDeviceInfo.label` from `enumerateDevices()`). Empty saved
 *  labels are treated as unset so a coach can "clear" a label by
 *  saving an empty string. */
export function getCameraLabel(deviceId: string, fallback: string): string {
  const labels = readAll();
  const saved = labels[deviceId];
  return saved && saved.trim().length > 0 ? saved : fallback;
}

/** Whether the device has an explicitly-saved label (vs. a fallback). */
export function hasCustomCameraLabel(deviceId: string): boolean {
  const labels = readAll();
  return !!(labels[deviceId] && labels[deviceId].trim().length > 0);
}

/** Save a friendly label for one camera. Pass an empty string to
 *  clear (the next read will fall back to the supplied default). */
export function setCameraLabel(deviceId: string, label: string): void {
  const labels = readAll();
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    delete labels[deviceId];
  } else {
    labels[deviceId] = trimmed;
  }
  writeAll(labels);
}

/** Read the entire label map at once — used by the Settings page so
 *  it can render the current saved value in each input. */
export function getAllCameraLabels(): LabelMap {
  return readAll();
}
