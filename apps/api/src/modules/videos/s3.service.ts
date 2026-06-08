import { Injectable, ServiceUnavailableException, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Thin wrapper around AWS S3 for video uploads.
 *
 * Activates only when AWS_REGION + S3_VIDEO_BUCKET are set in the environment.
 * Without those, every method throws a 503 with a clear message — this lets
 * the rest of the API run in dev (where videos go to local disk via the
 * `/videos/upload` multipart route) without any AWS credentials configured.
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client | null;
  readonly bucket: string | null;
  readonly region: string | null;

  constructor() {
    this.region = process.env.AWS_REGION || null;
    this.bucket = process.env.S3_VIDEO_BUCKET || null;

    if (this.region && this.bucket) {
      this.client = new S3Client({ region: this.region });
      this.logger.log(`S3 enabled — bucket=${this.bucket} region=${this.region}`);
    } else {
      this.client = null;
      this.logger.warn('S3 disabled — set AWS_REGION + S3_VIDEO_BUCKET to enable presigned uploads');
    }
  }

  isConfigured(): boolean {
    return this.client !== null && !!this.bucket;
  }

  private requireClient(): S3Client {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException(
        'S3 is not configured on the server. Set AWS_REGION and S3_VIDEO_BUCKET environment variables.',
      );
    }
    return this.client;
  }

  /**
   * Presign a PUT URL for direct browser/mobile upload.
   * @param key Object key in the bucket (e.g. `uploads/2026-04/video-uuid.mp4`)
   * @param contentType MIME type the client will send (e.g. `video/mp4`)
   * @param expiresInSec How long the URL is valid (default 15 min)
   */
  async presignPutUrl(key: string, contentType: string, expiresInSec = 900): Promise<string> {
    const client = this.requireClient();
    const cmd = new PutObjectCommand({
      Bucket: this.bucket!,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(client, cmd, { expiresIn: expiresInSec });
  }

  /**
   * Presign a GET URL — fallback for video playback if CloudFront is not in use.
   */
  async presignGetUrl(key: string, expiresInSec = 3600): Promise<string> {
    const client = this.requireClient();
    const cmd = new GetObjectCommand({ Bucket: this.bucket!, Key: key });
    return getSignedUrl(client, cmd, { expiresIn: expiresInSec });
  }

  /**
   * Upload bytes directly from a Buffer (server-side).
   * Used by routes that receive a multipart upload server-side then forward
   * to S3 — e.g. drill demo videos. The presigned-PUT path is preferred for
   * large user-facing video uploads (zero API memory pressure), but for
   * small files where the API server already has the bytes in memory,
   * proxying through is simpler and one fewer round-trip for the client.
   */
  async putObjectFromBuffer(key: string, body: Buffer, contentType: string): Promise<string> {
    const client = this.requireClient();
    const cmd = new PutObjectCommand({
      Bucket: this.bucket!,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    await client.send(cmd);
    return key;
  }

  /**
   * Translate an S3 object key to a publicly-fetchable URL. Prefers the
   * configured CDN_BASE_URL (CloudFront distribution domain) and falls
   * back to the canonical s3.amazonaws.com URL — only useful when the
   * bucket is public, otherwise consumers must call presignGetUrl.
   */
  publicUrlFor(key: string): string {
    const cdn = process.env.CDN_BASE_URL?.replace(/\/$/, '');
    if (cdn) return `${cdn}/${key}`;
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
