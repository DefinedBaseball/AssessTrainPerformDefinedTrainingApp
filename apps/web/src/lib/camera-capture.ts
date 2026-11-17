/* ─────────────────────────────────────────────────────────────────────────
   Opening a camera for the in-app recorders (Live Training, Live At-Bat).

   Desktops / capture cards: ask for 1080p and REQUIRE >=120 fps (ideal 240)
   so high-speed cameras lock to true slow-mo; a camera that can't do 120
   falls back to its best rate.

   iPhone / iPad (and other touch devices): ask for 1080p at up to 60 fps.
   Safari only offers a phone camera's 120/240 fps modes at small sizes, so
   the old "at least 120 fps, ideally 240" request made it pick a tiny
   camera mode -- pitching clips recorded in the app arrived around 480x360
   (Bunny's best copy: 360p). 1080p @ 60 is the best a browser can get from
   those cameras.

   Either way, if the camera still opens below 720p, it is reopened asking
   for resolution first (1080p, <=60 fps) and the sharper stream is kept.
   ───────────────────────────────────────────────────────────────────────── */

/** Phones and tablets (coarse pointer, or iPadOS reporting as a Mac). */
export function isTouchCaptureDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return coarse || ios;
}

/** The short side of the picture (portrait phones report 1080x1920). */
function shortSide(stream: MediaStream): number {
  const s = stream.getVideoTracks()[0]?.getSettings();
  if (!s?.width || !s?.height) return 0;
  return Math.min(s.width, s.height);
}

function stop(stream: MediaStream | null | undefined) {
  try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
}

async function open(video: MediaTrackConstraints, audio: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video, audio });
}

/** Open one camera for recording (see the file note for what it asks for). */
export async function openCameraStream(deviceId: string, audio: boolean): Promise<MediaStream> {
  const base: MediaTrackConstraints = {
    deviceId: { exact: deviceId },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  };
  /* Resolution first: 1080p, up to 60 fps. */
  const sharp: MediaTrackConstraints = { ...base, frameRate: { ideal: 60, max: 60 } };

  let stream: MediaStream;
  if (isTouchCaptureDevice()) {
    try {
      stream = await open(sharp, audio);
    } catch (err: any) {
      if (err?.name !== 'OverconstrainedError') throw err;
      stream = await open(base, audio);
    }
  } else {
    try {
      stream = await open({ ...base, frameRate: { min: 120, ideal: 240 } }, audio);
    } catch (err: any) {
      if (err?.name !== 'OverconstrainedError') throw err;
      stream = await open({ ...base, frameRate: { ideal: 240 } }, audio);
    }
  }

  /* Safety net: a camera that opened small gets one more try asking for
     resolution first; keep whichever picture is bigger. */
  const firstSize = shortSide(stream);
  if (firstSize > 0 && firstSize < 720) {
    stop(stream); // a camera usually can't be open twice
    try {
      const retry = await open(sharp, audio);
      if (shortSide(retry) >= firstSize) return retry;
      stop(retry);
    } catch { /* fall through and reopen the first request */ }
    return open(isTouchCaptureDevice() ? base : { ...base, frameRate: { ideal: 240 } }, audio);
  }
  return stream;
}

/** "1080p · 60 fps" for the camera tile, from what the camera delivered. */
export function describeStream(stream: MediaStream | null | undefined): string | null {
  const s = stream?.getVideoTracks()[0]?.getSettings();
  if (!s) return null;
  const parts: string[] = [];
  if (s.width && s.height) parts.push(`${Math.min(s.width, s.height)}p`);
  if (s.frameRate) parts.push(`${Math.round(s.frameRate)} fps`);
  return parts.length ? parts.join(' · ') : null;
}
