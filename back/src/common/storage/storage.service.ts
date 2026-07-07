import { Injectable, InternalServerErrorException } from '@nestjs/common';

/**
 * Thin S3/MinIO wrapper. Attachment BYTES never pass through the API or the DB — the
 * browser PUTs directly to the bucket using a short-lived presigned URL, and reads via a
 * presigned GET URL. Only the object key + metadata are stored (see DocumentAttachment).
 *
 * The AWS SDK is loaded lazily through a non-literal specifier so the project still builds
 * when the optional dependency isn't installed locally; calling a method without the SDK (or
 * without bucket config) throws a clear error. Configure via env: AWS_S3_BUCKET_NAME,
 * AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, plus S3_ENDPOINT (MinIO, e.g.
 * http://localhost:9000), S3_FORCE_PATH_STYLE (default true), S3_URL_TTL_SECONDS (default 300).
 */
@Injectable()
export class StorageService {
  private readonly bucket = process.env.AWS_S3_BUCKET_NAME ?? 'erp-attachments';
  private readonly ttl = Number(process.env.S3_URL_TTL_SECONDS ?? '300');
  private clientPromise?: Promise<unknown>;

  /** Object key layout: per document, with a timestamp prefix to avoid name collisions. */
  buildKey(documentId: string, fileName: string): string {
    const safe = fileName.replace(/[^\w.\-]+/g, '_');
    return `documents/${documentId}/${Date.now()}-${safe}`;
  }

  /** Presigned PUT URL — the browser uploads bytes straight to the bucket (step 1). */
  async presignUpload(key: string, contentType?: string): Promise<string> {
    const s3 = await this.load();
    const command = new s3.PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return s3.getSignedUrl(await this.client(), command, { expiresIn: this.ttl });
  }

  /** Presigned GET URL — short-lived read link for an existing object key. */
  async presignDownload(key: string): Promise<string> {
    const s3 = await this.load();
    const command = new s3.GetObjectCommand({ Bucket: this.bucket, Key: key });
    return s3.getSignedUrl(await this.client(), command, { expiresIn: this.ttl });
  }

  private async client(): Promise<unknown> {
    if (!this.clientPromise) {
      const s3 = await this.load();
      this.clientPromise = Promise.resolve(
        new s3.S3Client({
          endpoint: process.env.S3_ENDPOINT || undefined,
          region: process.env.AWS_REGION ?? 'us-east-1',
          forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
          credentials: process.env.AWS_ACCESS_KEY_ID
            ? {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
              }
            : undefined,
        }),
      );
    }
    return this.clientPromise;
  }

  /** Lazily resolve the optional AWS SDK; surface a clear error if it's absent. */
  private async load(): Promise<{
    S3Client: new (cfg: unknown) => unknown;
    PutObjectCommand: new (input: unknown) => unknown;
    GetObjectCommand: new (input: unknown) => unknown;
    getSignedUrl: (client: unknown, command: unknown, opts: unknown) => Promise<string>;
  }> {
    try {
      const clientPkg = '@aws-sdk/client-s3';
      const presignPkg = '@aws-sdk/s3-request-presigner';
      const client = (await import(clientPkg)) as any;
      const presigner = (await import(presignPkg)) as any;
      return {
        S3Client: client.S3Client,
        PutObjectCommand: client.PutObjectCommand,
        GetObjectCommand: client.GetObjectCommand,
        getSignedUrl: presigner.getSignedUrl,
      };
    } catch {
      throw new InternalServerErrorException(
        'Object storage is not configured (install @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner)',
      );
    }
  }
}
