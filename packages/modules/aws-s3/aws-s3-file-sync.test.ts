import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AwsS3FileService } from "./aws-s3-file.service";

/**
 * Unit tests for syncFilesFromS3ToDatabase's page-by-page mirroring.
 *
 * Run: `node --import tsx --test src/modules/aws-s3/aws-s3-file-sync.test.ts`
 */

const BUCKET = "test-bucket";

function buildService(pages: string[][], existingCount = 0) {
  const listCalls: any[] = [];
  const createdBatches: any[][] = [];
  const updates: any[] = [];
  let nextId = 1;

  const config = {
    getOrThrow: (key: string) => ({ "modules.aws-s3.bucket": BUCKET, "modules.aws-s3.region": "us-east-1" })[key],
    get: () => undefined,
  } as any;

  const prisma = {
    s3File: {
      count: async () => existingCount,
      createManyAndReturn: async ({ data }: any) => {
        createdBatches.push(data);
        return data.map((row: any) => ({ id: `id-${nextId++}`, s3Key: row.s3Key }));
      },
      updateMany: async (args: any) => {
        updates.push(args);
        return { count: args.where.id.in.length };
      },
    },
  } as any;

  const s3 = {
    listObjectsByCursor: async (params: any) => {
      listCalls.push(params);
      const pageIndex = listCalls.length - 1;
      const keys = pages[pageIndex] ?? [];
      return {
        records: keys.map((s3Key) => ({ s3Key, size: 7 })),
        nextToken: pageIndex < pages.length - 1 ? `t${pageIndex + 1}` : null,
      };
    },
  } as any;

  return { service: new AwsS3FileService(config, prisma, s3), listCalls, createdBatches, updates };
}

describe("AwsS3FileService.syncFilesFromS3ToDatabase", () => {
  it("mirrors the bucket page by page with the S3 cursor", async () => {
    const { service, listCalls, createdBatches } = buildService([
      ["uploads/", "uploads/a.png", "uploads/b/"],
      ["uploads/b/c.txt"],
    ]);

    await service.syncFilesFromS3ToDatabase();

    assert.equal(listCalls.length, 2);
    assert.equal(listCalls[0].pageSize, 500);
    assert.equal(listCalls[0].nextToken, undefined);
    assert.equal(listCalls[1].nextToken, "t1");
    assert.equal(createdBatches.length, 2);
    assert.deepEqual(
      createdBatches[0].map((row: any) => [row.name, row.type, row.size, row.s3Bucket]),
      [
        ["uploads", "folder", 7, BUCKET],
        ["a.png", "png", 7, BUCKET],
        ["b", "folder", 7, BUCKET],
      ],
    );
    assert.deepEqual(
      createdBatches[1].map((row: any) => [row.name, row.type]),
      [["c.txt", "txt"]],
    );
  });

  it("links children to parent folders, including parents from earlier pages", async () => {
    const { service, updates } = buildService([["uploads/", "uploads/a.png", "uploads/b/"], ["uploads/b/c.txt"]]);

    await service.syncFilesFromS3ToDatabase();

    assert.deepEqual(updates, [
      { where: { id: { in: ["id-2", "id-3"] } }, data: { parentId: "id-1" } },
      { where: { id: { in: ["id-4"] } }, data: { parentId: "id-3" } },
    ]);
  });

  it("skips page-level writes for an empty page", async () => {
    const { service, createdBatches } = buildService([[], ["uploads/a.png"]], 0);

    await service.syncFilesFromS3ToDatabase();

    assert.equal(createdBatches.length, 1);
  });

  it("refuses to sync when the s3File table already has rows", async () => {
    const { service, listCalls } = buildService([["uploads/"]], 3);

    await assert.rejects(service.syncFilesFromS3ToDatabase(), /not empty/);
    assert.equal(listCalls.length, 0);
  });
});
