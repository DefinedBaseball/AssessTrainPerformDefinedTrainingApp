import { BadRequestException } from '@nestjs/common';

/**
 * Profile pictures (athletes and coaches) arrive as a data URL the browser
 * has already square-cropped and shrunk. Checks it's really a PNG, JPEG or
 * WebP under 1 MB -- by its first bytes, never the type it claims -- and
 * returns what to store.
 */
export function parsePhotoDataUrl(dataUrl: unknown): { mime: string; base64: string } {
  if (typeof dataUrl !== 'string') throw new BadRequestException('Choose an image file');
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw new BadRequestException('Choose an image file');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 1_000_000) throw new BadRequestException('Photo must be under 1 MB');
  const mime = sniffPhoto(buf);
  if (!mime) throw new BadRequestException('Photo must be a PNG, JPG or WebP image');
  return { mime, base64: buf.toString('base64') };
}

/** Photo URL ids are 32 random hex characters. */
export function isPhotoId(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id);
}

/** PNG / JPEG / WebP by their first bytes -- the file's claimed type is not trusted. */
function sniffPhoto(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
