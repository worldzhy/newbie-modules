import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface S3ServiceConfig {
  region: string;
}

export class S3Service {
  private client: S3Client;

  constructor(
    config: S3ServiceConfig = {
      region: process.env.AWS_S3_REGION || "us-east-1",
    },
  ) {
    this.client = new S3Client({ region: config.region });
  }

  async getObject(params: { bucket: string; key: string }) {
    const command = new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
    });

    return await this.client.send(command);
  }
}
