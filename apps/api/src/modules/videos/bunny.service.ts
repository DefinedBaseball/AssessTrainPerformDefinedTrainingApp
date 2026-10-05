import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Bunny Stream wrapper — the production video backend.
 *
 * Bunny Stream auto-transcodes every upload to H.264/AAC MP4 + HLS + a
 * thumbnail, which solves the cross-device playback problem (raw MediaRecorder
 * `.webm` won't play on iOS Safari; iPhone HEVC won't play on Android/Chrome).
 * With the library's **"MP4 Fallback"** setting enabled, Bunny also exposes a
 * progressive MP4 per rendition — that's what our custom synced-compare /
 * drawing / frame-by-frame player needs (it drives a native <video>, not
 * Bunny's iframe player).
 *
 * Activates only when BUNNY_STREAM_LIBRARY_ID + BUNNY_STREAM_API_KEY +
 * BUNNY_STREAM_CDN_HOSTNAME are all set. Without them every method throws a
 * 503, so dev keeps using local-disk / S3 storage with no Bunny account.
 */
@Injectable()
export class BunnyService {
  private readonly logger = new Logger(BunnyService.name);
  readonly libraryId: string | null;
  private readonly apiKey: string | null;
  /** Pull-zone host for the stream library, e.g. `vz-xxxx-yyy.b-cdn.net`. */
  readonly cdnHostname: string | null;
  /** Which MP4 rendition to hand the custom player (must be enabled on the
   *  library + covered by MP4 Fallback). 720p is a safe default. */
  private readonly mp4Quality: string;
  /** Pull-zone URL Token Authentication key. When set, every Bunny link the
   *  API hands out is signed and expires (see BunnyUrlInterceptor). */
  private readonly tokenKey: string | null;

  constructor() {
    this.libraryId = process.env.BUNNY_STREAM_LIBRARY_ID || null;
    this.apiKey = process.env.BUNNY_STREAM_API_KEY || null;
    this.cdnHostname =
      (process.env.BUNNY_STREAM_CDN_HOSTNAME || '')
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '') || null;
    this.mp4Quality = process.env.BUNNY_STREAM_MP4_QUALITY || '720p';
    this.tokenKey = process.env.BUNNY_STREAM_TOKEN_KEY?.trim() || null;
    if (this.tokenKey && this.cdnHostname) {
      this.logger.log('Bunny link signing enabled (links expire)');
    }

    if (this.isConfigured()) {
      this.logger.log(`Bunny Stream enabled — library=${this.libraryId} host=${this.cdnHostname}`);
    } else {
      this.logger.warn(
        'Bunny Stream disabled — set BUNNY_STREAM_LIBRARY_ID + BUNNY_STREAM_API_KEY + BUNNY_STREAM_CDN_HOSTNAME to enable',
      );
    }
  }

  isConfigured(): boolean {
    return !!(this.libraryId && this.apiKey && this.cdnHostname);
  }

  /* ── Expiring links (Bunny URL token authentication) ──────────────────

     A signed link carries a token that is only valid until `expires`.
     Directory tokens are used (token_path = the video's folder, put in the
     path rather than the query string) so one signature covers everything
     in the folder: the MP4, the thumbnail and every HLS segment a playlist
     points at -- a query-string token wouldn't follow the player's segment
     requests.

     Expiry is rounded up to the next hour and then SIGN_TTL_SEC added, so a
     link is good for 6-7 hours and stays byte-identical for an hour: the
     browser can keep caching a clip across page loads. */
  private static readonly SIGN_TTL_SEC = 6 * 60 * 60;

  signingEnabled(): boolean {
    return !!(this.cdnHostname && this.tokenKey);
  }

  /** Every link on our CDN host inside `text`, stopping at whitespace,
   *  quotes, backslashes and angle brackets (so links inside JSON stored in
   *  a string are found too). */
  private linkPattern(): RegExp {
    const host = (this.cdnHostname || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`https://${host}(/[^\\s"'<>\\\\]*)?`, 'g');
  }

  /** The link with any Bunny signature removed. */
  canonicalUrl(url: string): string {
    const prefix = `https://${this.cdnHostname}`;
    if (!url.startsWith(prefix)) return url;
    let rest = url.slice(prefix.length).replace(/^\/bcdn_token=[^/]*/, '');
    const q = rest.indexOf('?');
    if (q >= 0) {
      const kept = rest.slice(q + 1).split('&')
        .filter((kv) => kv && !/^(token|expires|token_path)=/.test(kv));
      rest = rest.slice(0, q) + (kept.length ? `?${kept.join('&')}` : '');
    }
    return prefix + rest;
  }

  /** A fresh expiring link for `url` (plain or previously signed). */
  signUrl(url: string, nowMs = Date.now()): string {
    if (!this.signingEnabled()) return url;
    const plain = this.canonicalUrl(url);
    const prefix = `https://${this.cdnHostname}`;
    const linkPath = plain.slice(prefix.length);
    /* Only the plain /<folder>/<file> links this service builds are signed;
       anything else is passed through untouched. */
    const m = linkPath.match(/^(\/[^/?#]+\/)[^?#]+$/);
    if (!m) return plain;
    const tokenPath = m[1];
    const expires = Math.ceil(nowMs / 3_600_000) * 3600 + BunnyService.SIGN_TTL_SEC;
    const token = createHash('sha256')
      .update(`${this.tokenKey}${tokenPath}${expires}token_path=${tokenPath}`)
      .digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${prefix}/bcdn_token=${token}&token_path=${encodeURIComponent(tokenPath)}&expires=${expires}${linkPath}`;
  }

  /** Sign every CDN link inside a string. */
  signUrlsIn(text: string): string {
    if (!this.signingEnabled() || !text.includes(this.cdnHostname as string)) return text;
    return text.replace(this.linkPattern(), (u) => this.signUrl(u));
  }

  /** Strip the signature from every CDN link inside a string. */
  canonicalizeUrlsIn(text: string): string {
    if (!this.cdnHostname || !text.includes(this.cdnHostname)) return text;
    return text.replace(this.linkPattern(), (u) => this.canonicalUrl(u));
  }

  /** Progressive MP4 URL (needs MP4 Fallback on). Drives the native player. */
  mp4Url(guid: string): string {
    return `https://${this.cdnHostname}/${guid}/play_${this.mp4Quality}.mp4`;
  }
  /** Adaptive HLS manifest — stored on `hlsUrl` for players that prefer it. */
  hlsUrl(guid: string): string {
    return `https://${this.cdnHostname}/${guid}/playlist.m3u8`;
  }
  thumbnailUrl(guid: string): string {
    return `https://${this.cdnHostname}/${guid}/thumbnail.jpg`;
  }

  /**
   * Create a Stream video, push the bytes, and return the playable URLs.
   * Transcoding runs async on Bunny's side — the MP4/HLS URLs resolve once
   * Bunny finishes (seconds for short training clips). Callers mark the DB
   * row READY optimistically; a Bunny webhook can flip status more precisely
   * later if needed.
   */
  /**
   * Create an empty Stream video object and return its guid. This is the
   * step that needs the secret AccessKey, so it always runs server-side —
   * both the buffered upload (below) and the browser-direct TUS upload
   * (via makeTusUpload) start here.
   */
  async createVideoObject(title: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Bunny Stream is not configured. Set BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY and BUNNY_STREAM_CDN_HOSTNAME.',
      );
    }
    const base = `https://video.bunnycdn.com/library/${this.libraryId}/videos`;
    const createRes = await fetch(base, {
      method: 'POST',
      headers: { AccessKey: this.apiKey!, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ title: title || 'Untitled' }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => '');
      throw new ServiceUnavailableException(`Bunny create failed (${createRes.status}) ${detail}`.trim());
    }
    const created = (await createRes.json()) as { guid?: string };
    if (!created.guid) throw new ServiceUnavailableException('Bunny create returned no guid');
    return created.guid;
  }

  /**
   * Extract the Bunny video guid from one of OUR playback URLs
   * (`https://{cdnHostname}/{guid}/play_720p.mp4` / `…/playlist.m3u8`).
   * Returns null for non-Bunny URLs (S3/disk/legacy), foreign hostnames, or
   * anything that doesn't look like a guid — callers treat null as "no Bunny
   * asset to manage".
   */
  guidFromUrl(url: string | null | undefined): string | null {
    if (!url || !this.cdnHostname) return null;
    try {
      const u = new URL(url);
      if (u.hostname.toLowerCase() !== this.cdnHostname.toLowerCase()) return null;
      const first = u.pathname.split('/').filter(Boolean)[0] || '';
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first)
        ? first
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Delete a Stream video object (the stored asset + all renditions).
   * Best-effort semantics: true on success, an already-gone asset (404)
   * counts as success, false when Bunny isn't configured or the delete
   * fails — never throws, so callers can fire-and-forget.
   */
  async deleteVideoObject(guid: string): Promise<boolean> {
    if (!this.isConfigured() || !guid) return false;
    try {
      const res = await fetch(
        `https://video.bunnycdn.com/library/${this.libraryId}/videos/${guid}`,
        { method: 'DELETE', headers: { AccessKey: this.apiKey!, accept: 'application/json' } },
      );
      if (res.ok || res.status === 404) return true;
      this.logger.warn(`Bunny delete ${guid} failed (${res.status})`);
      return false;
    } catch (e: any) {
      this.logger.warn(`Bunny delete ${guid} errored: ${e?.message || e}`);
      return false;
    }
  }

  /**
   * Authorize a browser-direct (TUS resumable) upload for an already-created
   * video object. The signature lets the client push bytes straight to Bunny
   * WITHOUT ever seeing the library AccessKey:
   *   signature = sha256(libraryId + apiKey + expiration + guid)
   * Expires in 2 hours — generous headroom for a slow mobile upload of a
   * large clip. The client passes {endpoint, signature, expiration, libraryId,
   * guid} to a TUS client (tus-js-client) which handles chunking + resume.
   */
  makeTusUpload(guid: string): {
    endpoint: string;
    signature: string;
    expiration: number;
    libraryId: string;
  } {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Bunny Stream is not configured.');
    }
    const expiration = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
    const signature = createHash('sha256')
      .update(`${this.libraryId}${this.apiKey}${expiration}${guid}`)
      .digest('hex');
    return {
      endpoint: 'https://video.bunnycdn.com/tusupload',
      signature,
      expiration,
      libraryId: this.libraryId!,
    };
  }

  async uploadBuffer(buffer: Buffer, title: string): Promise<{
    guid: string;
    mp4Url: string;
    hlsUrl: string;
    thumbnailUrl: string;
  }> {
    // 1. Create the video object (returns a guid we key everything off).
    const guid = await this.createVideoObject(title);
    const base = `https://video.bunnycdn.com/library/${this.libraryId}/videos`;

    // 2. Upload the raw bytes for that video.
    const putRes = await fetch(`${base}/${guid}`, {
      method: 'PUT',
      headers: { AccessKey: this.apiKey!, 'Content-Type': 'application/octet-stream' },
      // Uint8Array is a valid BodyInit; Buffer isn't typed as one.
      body: new Uint8Array(buffer),
    });
    if (!putRes.ok) {
      const detail = await putRes.text().catch(() => '');
      throw new ServiceUnavailableException(`Bunny upload failed (${putRes.status}) ${detail}`.trim());
    }

    return {
      guid,
      mp4Url: this.mp4Url(guid),
      hlsUrl: this.hlsUrl(guid),
      thumbnailUrl: this.thumbnailUrl(guid),
    };
  }
}
