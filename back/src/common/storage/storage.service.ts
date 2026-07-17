import { Injectable, InternalServerErrorException } from '@nestjs/common';

/**
 * Thin S3/MinIO wrapper. Uploads are proxied through the API: the browser POSTs the file to
 * the backend, which writes the bytes to the bucket via `putObject` and stores only the object
 * key + metadata (see DocumentAttachment). Reads still go direct — a short-lived presigned GET
 * URL — so large objects never stream back through the API. (Uploads used to be presigned
 * browser→bucket PUTs; that required a bucket CORS policy and broke on presigned-PUT
 * checksums, so it was moved server-side.)
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

  /** Object key layout for a user's signature — never overwritten (timestamp prefix). */
  buildUserSignatureKey(userId: string, fileName: string): string {
    const safe = fileName.replace(/[^\w.\-]+/g, '_');
    return `signatures/${userId}/${Date.now()}-${safe}`;
  }

  /** Object key layout for a 1:1 profile image, scoped by owner kind (user/company). */
  buildProfileImageKey(kind: 'user' | 'company', ownerId: string, fileName: string): string {
    const safe = fileName.replace(/[^\w.\-]+/g, '_');
    return `profile-images/${kind}/${ownerId}/${Date.now()}-${safe}`;
  }

  /**
   * Object key layout for a payment run's bank file.
   *
   * No timestamp prefix, unlike the layouts above: a batch has exactly one file, and re-exporting
   * must return the same bytes that went to the bank rather than mint a second object. The key is
   * derived, so it stays resolvable from the batch id alone.
   */
  buildPaymentBatchKey(batchId: string, fileName: string): string {
    const safe = fileName.replace(/[^\w.\-]+/g, '_');
    return `payment-batches/${batchId}/${safe}`;
  }

  /** Fetch an object's raw bytes server-side (used to embed a signature image into a PDF). */
  async getObject(key: string): Promise<Buffer> {
    const s3 = await this.load();
    const command = new s3.GetObjectCommand({ Bucket: this.bucket, Key: key });
    const res = (await (await this.client() as any).send(command)) as {
      Body?: { transformToByteArray?: () => Promise<Uint8Array> };
    };
    const body = res.Body;
    if (!body?.transformToByteArray) {
      throw new InternalServerErrorException(`Object ${key} could not be read from storage`);
    }
    return Buffer.from(await body.transformToByteArray());
  }

  /** Write bytes to the bucket server-side (the browser POSTs the file to the API first). */
  async putObject(key: string, body: Buffer, contentType?: string): Promise<void> {
    const s3 = await this.load();
    const command = new s3.PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    await (await this.client() as any).send(command);
  }

  /**
   * Remove an object. Used when deleting evidence (a payment slip): leaving the bytes behind
   * would keep the file's contents reachable to anyone with the key, which is the whole reason
   * the delete was asked for. Deleting a key that is already gone is not an error in S3.
   */
  async deleteObject(key: string): Promise<void> {
    const s3 = await this.load();
    const command = new s3.DeleteObjectCommand({ Bucket: this.bucket, Key: key });
    await (await this.client() as any).send(command);
  }

  /**
   * Presigned GET URL — short-lived read link for an existing object key. `ttlSeconds`
   * overrides the default TTL (e.g. a longer window for a persistent sidebar avatar).
   */
  async presignDownload(key: string, ttlSeconds?: number): Promise<string> {
    const s3 = await this.load();
    const command = new s3.GetObjectCommand({ Bucket: this.bucket, Key: key });
    return s3.getSignedUrl(await this.client(), command, { expiresIn: ttlSeconds ?? this.ttl });
  }

  private async client(): Promise<unknown> {
    if (!this.clientPromise) {
      const s3 = await this.load();
      this.clientPromise = Promise.resolve(
        new s3.S3Client({
          endpoint: process.env.S3_ENDPOINT || undefined,
          region: process.env.AWS_REGION ?? 'us-east-1',
          forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
          // AWS SDK v3 ≥ 3.729 defaults to WHEN_SUPPORTED, which bakes an empty-body
          // CRC32 (AAAAAA==) into presigned PUT URLs and makes S3 reject the real upload
          // with a checksum mismatch. Revert to only checksumming when explicitly required.
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
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
    DeleteObjectCommand: new (input: unknown) => unknown;
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
        DeleteObjectCommand: client.DeleteObjectCommand,
        getSignedUrl: presigner.getSignedUrl,
      };
    } catch {
      throw new InternalServerErrorException(
        'Object storage is not configured (install @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner)',
      );
    }
  }
}
