import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { AwsS3Service } from "./aws-s3.service";

/**
 * Unit tests for the S3 pagination primitives (listObjectsByPage /
 * listObjectsByCursor) and the bounded listing they are built on.
 *
 * Run: `node --import tsx --test src/modules/aws-s3/aws-s3-pagination.test.ts`
 */

const BUCKET = "test-bucket";

function makeService(s3Client: { send: (command: any) => Promise<any> }) {
  const configValues: Record<string, unknown> = {
    "modules.aws-s3.bucket": BUCKET,
    "modules.aws-s3.region": "us-east-1",
    "modules.aws-s3.signedUrlExpiresIn": 900,
  };
  const config = { getOrThrow: (key: string) => configValues[key] } as any;
  const credentials = { resolveDefaultCredentials: () => ({}) } as any;
  const service = new AwsS3Service(config, credentials);
  (service as any).client = s3Client;
  return service;
}

/**
 * Fake ListObjectsV2 endpoint: each entry is one AWS page. Object Size is
 * constant because pagination never reads it.
 */
function pagedClient(pages: { keys: string[]; nextToken?: string }[]) {
  const calls: any[] = [];
  return {
    calls,
    send: async (command: any) => {
      calls.push(command.input);
      const page = pages[calls.length - 1] ?? { keys: [] };
      return {
        Contents: page.keys.map((Key) => ({ Key, Size: 42 })),
        IsTruncated: page.nextToken !== undefined,
        NextContinuationToken: page.nextToken,
      };
    },
  };
}

describe("AwsS3Service.getObjectsRecursively", () => {
  it("stops after limit objects instead of draining the whole prefix", async () => {
    const client = pagedClient([{ keys: ["a", "b", "c"], nextToken: "t1" }, { keys: ["d"] }]);
    const service = makeService(client);

    const objects = await service.getObjectsRecursively({ prefix: "manifests/", limit: 2 });

    assert.deepEqual(
      objects.map((object) => object.s3Key),
      ["a", "b"],
    );
    assert.equal(client.calls.length, 1);
  });

  it("walks continuation tokens and applies filter before counting towards limit", async () => {
    const client = pagedClient([{ keys: ["a.json", "b.txt"], nextToken: "t1" }, { keys: ["c.json"] }]);
    const service = makeService(client);

    const objects = await service.getObjectsRecursively({
      prefix: "manifests/",
      limit: 2,
      filter: (s3Key) => s3Key.endsWith(".json"),
    });

    assert.deepEqual(
      objects.map((object) => object.s3Key),
      ["a.json", "c.json"],
    );
    assert.equal(client.calls[1].ContinuationToken, "t1");
  });
});

describe("AwsS3Service.listObjectsByPage", () => {
  it("slices the lexicographic listing and reports pagination counts", async () => {
    const client = pagedClient([{ keys: ["k1", "k2", "k3", "k4", "k5"] }]);
    const service = makeService(client);

    const result = await service.listObjectsByPage({ prefix: "manifests/", page: 1, pageSize: 2 });

    assert.deepEqual(
      result.records.map((record) => record.s3Key),
      ["k3", "k4"],
    );
    assert.deepEqual(result.pagination, { page: 1, pageSize: 2, countOfCurrentPage: 2, countOfTotal: 5 });
  });

  it("reverses the listing for order desc before slicing", async () => {
    const client = pagedClient([{ keys: ["k1", "k2", "k3", "k4", "k5"] }]);
    const service = makeService(client);

    const result = await service.listObjectsByPage({ prefix: "manifests/", page: 1, pageSize: 2, order: "desc" });

    assert.deepEqual(
      result.records.map((record) => record.s3Key),
      ["k3", "k2"],
    );
    assert.equal(result.pagination.countOfTotal, 5);
  });

  it("throws BadRequestException when the prefix holds more objects than maxObjects", async () => {
    const client = pagedClient([{ keys: ["k1", "k2", "k3"] }]);
    const service = makeService(client);

    await assert.rejects(
      service.listObjectsByPage({ prefix: "manifests/", maxObjects: 2 }),
      (error: any) => error instanceof BadRequestException && /more than 2 objects/.test(error.message),
    );
  });

  it("allows a prefix that holds exactly maxObjects", async () => {
    const client = pagedClient([{ keys: ["k1", "k2"] }]);
    const service = makeService(client);

    const result = await service.listObjectsByPage({ prefix: "manifests/", maxObjects: 2 });

    assert.equal(result.pagination.countOfTotal, 2);
  });

  it("applies filter so unrelated keys never count towards the page or the guard", async () => {
    const client = pagedClient([{ keys: ["a.json", "b.txt", "c.json"] }]);
    const service = makeService(client);

    const result = await service.listObjectsByPage({
      prefix: "manifests/",
      maxObjects: 2,
      filter: (s3Key) => s3Key.endsWith(".json"),
    });

    assert.deepEqual(
      result.records.map((record) => record.s3Key),
      ["a.json", "c.json"],
    );
    assert.equal(result.pagination.countOfTotal, 2);
  });

  it("caps an oversized pageSize at the framework ceiling", async () => {
    const client = pagedClient([{ keys: ["k1"] }]);
    const service = makeService(client);

    const result = await service.listObjectsByPage({ prefix: "manifests/", pageSize: 5000 });

    assert.equal(result.pagination.pageSize, 1000);
  });

  it("honours defaultPageSize when the caller omits pageSize", async () => {
    const client = pagedClient([{ keys: ["k1", "k2", "k3"] }]);
    const service = makeService(client);

    const result = await service.listObjectsByPage({ prefix: "manifests/", defaultPageSize: 2 });

    assert.equal(result.pagination.pageSize, 2);
    assert.equal(result.records.length, 2);
  });

  it("rejects a negative page", async () => {
    const client = pagedClient([{ keys: ["k1"] }]);
    const service = makeService(client);

    await assert.rejects(service.listObjectsByPage({ page: -1 }), (error: any) => error instanceof BadRequestException);
  });

  it("rejects a non-positive pageSize", async () => {
    const client = pagedClient([{ keys: ["k1"] }]);
    const service = makeService(client);

    await assert.rejects(
      service.listObjectsByPage({ pageSize: 0 }),
      (error: any) => error instanceof BadRequestException,
    );
  });
});

describe("AwsS3Service.listObjectsByCursor", () => {
  it("returns one native S3 page plus the next token", async () => {
    const client = pagedClient([{ keys: ["k1", "k2"], nextToken: "t1" }]);
    const service = makeService(client);

    const result = await service.listObjectsByCursor({ prefix: "manifests/", pageSize: 2 });

    assert.deepEqual(
      result.records.map((record) => record.s3Key),
      ["k1", "k2"],
    );
    assert.equal(result.nextToken, "t1");
    assert.equal(client.calls[0].MaxKeys, 2);
  });

  it("forwards the token to S3 and reports null on the last page", async () => {
    const client = pagedClient([{ keys: ["k1"], nextToken: "t1" }, { keys: ["k2"] }]);
    const service = makeService(client);

    const first = await service.listObjectsByCursor({ prefix: "manifests/", pageSize: 1 });
    const second = await service.listObjectsByCursor({
      prefix: "manifests/",
      pageSize: 1,
      nextToken: first.nextToken!,
    });

    assert.equal(client.calls[1].ContinuationToken, "t1");
    assert.equal(second.nextToken, null);
    assert.deepEqual(
      second.records.map((record) => record.s3Key),
      ["k2"],
    );
  });
});
