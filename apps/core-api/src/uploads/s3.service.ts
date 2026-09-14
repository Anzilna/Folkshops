import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

/**
 * Thin wrapper around the S3 SDK — the one place any code asks to store a
 * file. AWS_S3_ENDPOINT/AWS_S3_FORCE_PATH_STYLE are what point this at the
 * MinIO container docker-compose runs instead of real AWS; both are unset
 * in prod, at which point this talks to a real S3 bucket with zero code
 * changes — same swap-seam as OtpProvider/ConsoleOtpProvider. The SDK
 * itself doesn't know or care which one it's talking to.
 *
 * Deliberately does NOT validate config in the constructor. Nest builds
 * every provider at boot regardless of whether a request ever reaches it,
 * so throwing here would take down the *entire app* — every route, not
 * just uploads — anywhere AWS_S3_* isn't set (CI has no MinIO service
 * today, and never should have to just to boot the app). Same posture as
 * CacheService/RedisThrottlerStorage failing open on a Redis outage: a
 * missing/broken dependency degrades the one feature that needs it, not
 * everything else. Here that means upload() throws a clear, request-scoped
 * error instead of a silent open failure, since there's no safe fallback
 * for "the file didn't get stored anywhere."
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly config: ConfigService) {}

  private configured() {
    const bucket = this.config.get<string>("AWS_S3_BUCKET");
    const accessKeyId = this.config.get<string>("AWS_ACCESS_KEY_ID");
    const secretAccessKey = this.config.get<string>("AWS_SECRET_ACCESS_KEY");
    if (!bucket || !accessKeyId || !secretAccessKey) return null;

    const endpoint = this.config.get<string>("AWS_S3_ENDPOINT");
    const client = new S3Client({
      region: this.config.get<string>("AWS_REGION") ?? "us-east-1",
      credentials: { accessKeyId, secretAccessKey },
      // Only set for MinIO — pointing the SDK at a non-AWS endpoint.
      ...(endpoint ? { endpoint } : {}),
      // MinIO (and most S3-compatible services) serve objects at
      // <endpoint>/<bucket>/<key>, not AWS's <bucket>.<endpoint>/<key>
      // virtual-hosted style. Real AWS S3 wants this left false/unset.
      forcePathStyle: this.config.get<string>("AWS_S3_FORCE_PATH_STYLE") === "true",
    });
    const publicUrlBase = this.config.get<string>("AWS_S3_PUBLIC_URL") ?? endpoint ?? `https://${bucket}.s3.amazonaws.com`;

    return { client, bucket, publicUrlBase };
  }

  /**
   * Uploads a buffer under `folder/` with a random filename (never the
   * client-supplied one — avoids path traversal and collisions) and
   * returns the full public URL to store on the row that owns it. The
   * bucket itself is set to anonymous-download by minio-init (mirroring a
   * real public bucket or a CDN in front of a private one); this method
   * doesn't grant per-object access, it relies on that bucket-level policy.
   */
  async upload(buffer: Buffer, folder: string, contentType: string, originalName: string): Promise<string> {
    const s3 = this.configured();
    if (!s3) {
      this.logger.error("Image upload attempted but AWS_S3_BUCKET/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY aren't set");
      throw new InternalServerErrorException("Image uploads aren't configured in this environment");
    }

    const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".")) : "";
    const key = `${folder}/${randomUUID()}${ext}`;

    try {
      await s3.client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: buffer, ContentType: contentType }));
    } catch (err) {
      this.logger.error(`S3 upload failed for key ${key}: ${err instanceof Error ? err.message : err}`);
      throw new InternalServerErrorException("Image upload failed");
    }

    return `${s3.publicUrlBase}/${s3.bucket}/${key}`;
  }
}
