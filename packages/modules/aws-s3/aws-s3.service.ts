import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommonListResponseDto } from "@devbie/newbie/common.dto";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  UploadPartCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AwsCredentialsService } from "@modules/aws-identity/aws-credentials.service";

/** Pagination defaults mirroring @devbie/newbie's Prisma list extension. */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 1000;

/**
 * Hard ceiling on how many objects listObjectsByPage will enumerate. Offset
 * pagination over a prefix is only safe while the prefix stays bounded; past
 * this limit callers must narrow the prefix, switch to cursor pagination, or
 * persist an object index instead.
 */
const DEFAULT_MAX_OBJECTS = 500;

export interface S3ObjectSummary {
  s3Key: string;
  size?: number;
}

export interface S3ObjectPage {
  records: S3ObjectSummary[];
  pagination: CommonListResponseDto["pagination"];
}

export interface S3ObjectCursorPage {
  records: S3ObjectSummary[];
  nextToken: string | null;
}

export type S3PageOrder = "asc" | "desc";

@Injectable()
export class AwsS3Service {
  private client: S3Client;
  private bucket: string;
  private region: string;
  private signedUrlExpiresIn: number;

  constructor(
    private readonly config: ConfigService,
    private readonly credentials: AwsCredentialsService,
  ) {
    this.bucket = this.config.getOrThrow<string>("modules.aws-s3.bucket");
    this.region = this.config.getOrThrow<string>("modules.aws-s3.region");
    this.signedUrlExpiresIn = this.config.getOrThrow<number>("modules.aws-s3.signedUrlExpiresIn");

    this.client = new S3Client({
      region: this.region,
      credentials: this.credentials.resolveDefaultCredentials(),
    });
  }

  //*********************/
  //* Bucket operations */
  //*********************/

  async createBucket(bucketName: string) {
    return await this.client.send(new CreateBucketCommand({ Bucket: bucketName }));
  }

  async deleteBucket(bucketName: string) {
    return await this.client.send(new DeleteBucketCommand({ Bucket: bucketName }));
  }

  //*********************/
  //* Object operations */
  //*********************/

  async getObject(params: { bucket?: string; key: string }) {
    return await this.client.send(
      new GetObjectCommand({
        Bucket: params.bucket ?? this.bucket,
        Key: params.key,
      }),
    );
  }

  async putObject(params: { bucket?: string; key: string; body?: Buffer | string }) {
    // Explicitly set ContentLength to avoid the SDK warning about
    // "Stream of unknown length" and ensure S3 accepts the request.
    const contentLength = params.body != null ? Buffer.byteLength(params.body) : 0;
    return await this.client.send(
      new PutObjectCommand({
        Bucket: params.bucket ?? this.bucket,
        Key: params.key,
        Body: params.body,
        ContentLength: contentLength,
      }),
    );
  }

  async copyObject(params: { bucket?: string; sourceKey: string; destinationKey: string }) {
    return await this.client.send(
      new CopyObjectCommand({
        Bucket: params.bucket ?? this.bucket,
        CopySource: params.bucket ? `${params.bucket}/${params.sourceKey}` : `${this.bucket}/${params.sourceKey}`,
        Key: params.destinationKey,
      }),
    );
  }

  async moveObject(params: { bucket?: string; sourceKey: string; destinationKey: string }) {
    // [step 1] Copy the object to the new location
    await this.client.send(
      new CopyObjectCommand({
        Bucket: params.bucket ?? this.bucket,
        CopySource: params.bucket ? `${params.bucket}/${params.sourceKey}` : `${this.bucket}/${params.sourceKey}`,
        Key: params.destinationKey,
      }),
    );

    // [step 2] Delete the original object
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: params.bucket ?? this.bucket,
        Delete: { Objects: [{ Key: params.sourceKey }] },
      }),
    );
  }

  async deleteObject(params: { bucket?: string; key: string }) {
    return await this.client.send(
      new DeleteObjectsCommand({
        Bucket: params.bucket ?? this.bucket,
        Delete: { Objects: [{ Key: params.key }] },
      }),
    );
  }

  async deleteObjectRecursively(params: { bucket: string; key: string }) {
    // [step 1] List objects
    const listResponse = await this.client.send(
      new ListObjectsV2Command({
        Bucket: params.bucket ?? this.bucket,
        Prefix: params.key,
      }),
    );
    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      return;
    }

    // [step 2] Delete objects
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: params.bucket,
        Delete: {
          Objects: listResponse.Contents.map((content) => {
            return { Key: content.Key };
          }),
        },
      }),
    );

    // https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
    // IsTruncated: Set to false if all of the results were returned. Set to true if more keys are available to return. If the number of results exceeds that specified by MaxKeys, all of the results might not be returned.
    if (listResponse.IsTruncated) {
      await this.deleteObjectRecursively(params);
    }
  }

  /**
   * List every object beneath a prefix.
   *
   * `limit` stops the continuation loop as soon as that many objects are
   * collected, letting callers bound a full scan; `filter` drops keys the
   * caller is not interested in before they count towards the limit.
   */
  async getObjectsRecursively(params: {
    bucket?: string;
    prefix?: string;
    limit?: number;
    filter?: (s3Key: string) => boolean;
  }) {
    const allKeys: S3ObjectSummary[] = [];
    let continuationToken: string | undefined;

    // https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
    // IsTruncated: Set to false if all of the results were returned. Set to
    // true if more keys are available; page through with ContinuationToken.
    do {
      const listResponse = await this.client.send(
        new ListObjectsV2Command({
          Bucket: params.bucket ?? this.bucket,
          Prefix: params.prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const content of listResponse.Contents ?? []) {
        const s3Key = content.Key!;
        if (params.filter && !params.filter(s3Key)) {
          continue;
        }
        allKeys.push({ s3Key, size: content.Size });
        if (params.limit !== undefined && allKeys.length >= params.limit) {
          break;
        }
      }

      if (params.limit !== undefined && allKeys.length >= params.limit) {
        break;
      }

      continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : undefined;
    } while (continuationToken);

    return allKeys;
  }

  /**
   * Offset pagination over the objects beneath a bounded prefix.
   *
   * S3 lists keys lexicographically, so `order: "desc"` reverses that order —
   * which still requires enumerating the whole prefix before slicing. The
   * `maxObjects` guard therefore applies to both orders: a prefix holding more
   * objects than the guard throws BadRequestException instead of silently
   * downloading the entire bucket.
   */
  async listObjectsByPage(params: {
    bucket?: string;
    prefix?: string;
    page?: number;
    pageSize?: number;
    defaultPageSize?: number;
    maxObjects?: number;
    order?: S3PageOrder;
    filter?: (s3Key: string) => boolean;
  }): Promise<S3ObjectPage> {
    const page = this.normalizePage(params.page);
    const pageSize = this.normalizePageSize(params.pageSize, params.defaultPageSize ?? DEFAULT_PAGE_SIZE);
    const maxObjects = this.normalizeMaxObjects(params.maxObjects);
    const order = params.order ?? "asc";

    const objects = await this.getObjectsRecursively({
      bucket: params.bucket,
      prefix: params.prefix,
      limit: maxObjects + 1,
      filter: params.filter,
    });

    if (objects.length > maxObjects) {
      throw new BadRequestException(
        `Refusing to page over more than ${maxObjects} objects beneath this prefix. ` +
          `Narrow the prefix, use cursor pagination, or persist an object index instead.`,
      );
    }

    const ordered = order === "desc" ? objects.slice().reverse() : objects;
    const records = ordered.slice(page * pageSize, (page + 1) * pageSize);

    return {
      records,
      pagination: {
        page,
        pageSize,
        countOfCurrentPage: records.length,
        countOfTotal: ordered.length,
      },
    };
  }

  /**
   * Native S3 cursor pagination: one ListObjectsV2 page per call, so there is no
   * full enumeration and no maxObjects guard. Return `nextToken` unchanged to
   * the caller; it is null on the last page.
   */
  async listObjectsByCursor(params: {
    bucket?: string;
    prefix?: string;
    pageSize?: number;
    defaultPageSize?: number;
    nextToken?: string;
    filter?: (s3Key: string) => boolean;
  }): Promise<S3ObjectCursorPage> {
    const pageSize = this.normalizePageSize(params.pageSize, params.defaultPageSize ?? DEFAULT_PAGE_SIZE);

    const listResponse = await this.client.send(
      new ListObjectsV2Command({
        Bucket: params.bucket ?? this.bucket,
        Prefix: params.prefix,
        MaxKeys: pageSize,
        ContinuationToken: params.nextToken,
      }),
    );

    const records: S3ObjectSummary[] = [];
    for (const content of listResponse.Contents ?? []) {
      const s3Key = content.Key!;
      if (params.filter && !params.filter(s3Key)) {
        continue;
      }
      records.push({ s3Key, size: content.Size });
    }

    return {
      records,
      nextToken: listResponse.IsTruncated ? (listResponse.NextContinuationToken ?? null) : null,
    };
  }

  //*******************************/
  //* Multipart upload operations */
  //*******************************/

  async createMultipartUpload(params: { bucket?: string; key: string }) {
    return await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: params.bucket ?? this.bucket,
        Key: params.key,
      }),
    );
  }

  async uploadPart(params: {
    bucket?: string;
    key: string;
    body: Buffer | Uint8Array | Blob | string;
    partNumber: number;
    uploadId: string;
  }) {
    // Explicitly set ContentLength to avoid the SDK warning about
    // "Stream of unknown length" and ensure S3 accepts the request.
    const contentLength = this.calculateBodyLength(params.body);
    const response = await this.client.send(
      new UploadPartCommand({
        Bucket: params.bucket ?? this.bucket,
        Key: params.key,
        Body: params.body,
        PartNumber: params.partNumber,
        UploadId: params.uploadId,
        ContentLength: contentLength,
      }),
    );

    return {
      ETag: response.ETag,
      PartNumber: params.partNumber,
    };
  }

  async completeMultipartUpload(params: {
    bucket?: string;
    key: string;
    parts: { ETag: string; PartNumber: number }[];
    uploadId: string;
  }) {
    return await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: params.bucket ?? this.bucket,
        Key: params.key,
        MultipartUpload: { Parts: params.parts },
        UploadId: params.uploadId,
      }),
    );
  }

  async abortMultipartUpload(params: { bucket?: string; key: string; uploadId: string }) {
    return await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: params.bucket ?? this.bucket,
        Key: params.key,
        UploadId: params.uploadId,
      }),
    );
  }

  //*****************************/
  //* Get signed URL operations */
  //*****************************/

  /** Get a signed URL to access an S3 object for signedUrlExpiresIn seconds */
  async getSignedDownloadUrl(params: { bucket?: string; key: string }) {
    const command = new GetObjectCommand({
      Bucket: params.bucket ?? this.bucket,
      Key: params.key,
    });

    return await getSignedUrl(this.client, command, {
      expiresIn: this.signedUrlExpiresIn,
    });
  }

  /** Get a signed URL to upload an S3 object for signedUrlExpiresIn seconds */
  async getSignedUploadUrl(params: { bucket?: string; key: string; contentType?: string; contentEncoding?: string }) {
    const command = new PutObjectCommand({
      Bucket: params.bucket ?? this.bucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentEncoding: params.contentEncoding,
    });

    return await getSignedUrl(this.client, command, {
      expiresIn: this.signedUrlExpiresIn,
    });
  }

  /** Get a signed URL to upload a part in a multipart upload */
  async getSignedMultipartUploadUrl(params: { bucket?: string; key: string; partNumber: number; uploadId: string }) {
    const command = new UploadPartCommand({
      Bucket: params.bucket ?? this.bucket,
      Key: params.key,
      PartNumber: params.partNumber,
      UploadId: params.uploadId,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: this.signedUrlExpiresIn,
    });
  }

  //*********************/
  //* Private functions */
  //*********************/

  private normalizePage(page?: number): number {
    const normalized = Math.trunc(page ?? 0);
    if (!Number.isInteger(normalized) || normalized < 0) {
      throw new BadRequestException("The minimum page is 0.");
    }
    return normalized;
  }

  private normalizePageSize(pageSize?: number, defaultPageSize = DEFAULT_PAGE_SIZE): number {
    const normalized = Math.trunc(pageSize ?? defaultPageSize);
    if (!Number.isInteger(normalized) || normalized <= 0) {
      throw new BadRequestException("pageSize must be a positive integer.");
    }
    return Math.min(normalized, MAX_PAGE_SIZE);
  }

  private normalizeMaxObjects(maxObjects?: number): number {
    const normalized = Math.trunc(maxObjects ?? DEFAULT_MAX_OBJECTS);
    if (!Number.isInteger(normalized) || normalized <= 0) {
      throw new BadRequestException("maxObjects must be a positive integer.");
    }
    return normalized;
  }

  /**
   * Calculate the byte length of a request body.
   * Mirrors the logic of @smithy/core's calculateBodyLength so we can set
   * ContentLength explicitly and avoid the "Stream of unknown length" warning.
   */
  private calculateBodyLength(body: Buffer | Uint8Array | Blob | string): number {
    if (typeof body === "string") {
      return Buffer.byteLength(body);
    }
    if (body instanceof Blob) {
      return body.size;
    }
    // Buffer and Uint8Array both expose byteLength
    return body.byteLength;
  }
}
