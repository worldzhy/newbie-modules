import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import {
  SecurityEvaluationWebOriginService,
  normalizeWebOrigin,
  type SecurityEvaluationWebOriginVerificationResult,
} from "./assets/security-evaluation-web-origin.service";
import {
  SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
  SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX,
  SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX,
} from "./security-evaluation.constants";
import type { VerificationFetchAccess } from "./ports/web-origin-verification-access.port";

/**
 * Behavior-level test for web-origin registration and ownership verification
 * (ADR-066 §1, ADR-044 §2): the registration transaction, origin normalization,
 * the two verification channels and the lazy re-verification gate.
 */

const CONFIG_VALUES: Record<string, string> = {
  "modules.security-evaluation.webOriginVerificationIntervalDays": "30",
  "modules.security-evaluation.webOriginReverifyFailureThreshold": "3",
  "modules.security-evaluation.webOriginTokenBytes": "32",
};

function fakeConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      const value = CONFIG_VALUES[key];
      if (value === undefined) throw new Error(`Unexpected config key ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

interface FakeWebOriginRow {
  id: string;
  assetId: string;
  environment: string;
  targetPaths: Record<string, string>;
  verificationStatus: string;
  verificationToken: string;
  verificationMethod: string | null;
  verificationFailures: number;
  verifiedAt: Date | null;
  lastVerifiedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  asset: { id: string; subjectId: string; naturalKey: string; displayName: string };
}

function fakeWebOriginRow(overrides: Partial<FakeWebOriginRow> = {}): FakeWebOriginRow {
  return {
    id: "web-origin-1",
    assetId: "asset-1",
    environment: "production",
    targetPaths: { "auth.login": "/login" },
    verificationStatus: "PENDING",
    verificationToken: "token-1",
    verificationMethod: "DNS_TXT",
    verificationFailures: 0,
    verifiedAt: null,
    lastVerifiedAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    asset: { id: "asset-1", subjectId: "subject-1", naturalKey: "https://app.example.com", displayName: "App" },
    ...overrides,
  };
}

function buildService(overrides: {
  prisma: unknown;
  subjects: unknown;
  assets?: unknown;
  fetch?: VerificationFetchAccess;
}): SecurityEvaluationWebOriginService {
  return new SecurityEvaluationWebOriginService(
    overrides.prisma as PrismaService,
    overrides.subjects as never,
    (overrides.assets ?? {}) as SecurityEvaluationAssetService,
    fakeConfig(),
    overrides.fetch,
  );
}

test("normalizeWebOrigin canonicalises scheme, host, default port and trailing slash", () => {
  assert.equal(normalizeWebOrigin("HTTPS://APP.Example.COM:443/"), "https://app.example.com");
  assert.equal(normalizeWebOrigin("http://app.example.com:8080"), "http://app.example.com:8080");
  assert.equal(normalizeWebOrigin("https://例子.测试"), "https://xn--fsqu00a.xn--0zwm56d");
});

test("normalizeWebOrigin rejects credentials, paths, queries and fragments", () => {
  assert.throws(() => normalizeWebOrigin("https://user:pass@app.example.com"), /credentials/);
  assert.throws(() => normalizeWebOrigin("https://app.example.com/login"), /path/);
  assert.throws(() => normalizeWebOrigin("https://app.example.com/?a=1"), /path/);
  assert.throws(() => normalizeWebOrigin("https://app.example.com/#x"), /path/);
  assert.throws(() => normalizeWebOrigin("ftp://app.example.com"), /http or https/);
});

test("create writes subject, asset, web-origin and provenance in one transaction", async () => {
  const calls: string[] = [];
  const transactionClient = {
    securityEvaluationWebOrigin: {
      upsert: async (args: { where: { assetId: string }; create: { verificationToken: string } }) => {
        calls.push("origin:upsert");
        assert.equal(args.where.assetId, "asset-1");
        return {
          id: "web-origin-1",
          assetId: "asset-1",
          verificationStatus: "PENDING",
          verificationToken: args.create.verificationToken,
        };
      },
    },
    securityEvaluationAssetProvenance: {
      upsert: async (args: {
        where: { subjectId_sourceType_sourceId: { subjectId: string; sourceType: string; sourceId: string } };
      }) => {
        calls.push("provenance:upsert");
        assert.deepEqual(args.where.subjectId_sourceType_sourceId, {
          subjectId: "subject-1",
          sourceType: "project",
          sourceId: "project-1",
        });
        return {};
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (transaction: typeof transactionClient) => unknown) => callback(transactionClient),
  };
  const subjects = {
    getOrCreateSubject: async (descriptor: { kind: string; subjectKey: string }) => {
      calls.push("subject:upsert");
      assert.equal(descriptor.kind, SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN);
      assert.equal(descriptor.subjectKey, "https://app.example.com");
      return {
        id: "subject-1",
        kind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
        scopeType: "platform",
        scopeId: "deployment",
        subjectKey: "https://app.example.com",
        displayName: "App",
      };
    },
  };
  const assets = {
    getOrCreateAsset: async () => {
      calls.push("asset:upsert");
      return { id: "asset-1", subjectId: "subject-1", naturalKey: "https://app.example.com" };
    },
  };
  const service = buildService({ prisma, subjects, assets });

  const registration = await service.create({
    origin: "HTTPS://App.Example.com:443/",
    label: "App",
    environment: "production",
    targetPaths: { "auth.login": "/login" },
    sourceType: "project",
    sourceId: "project-1",
  });

  assert.deepEqual(calls, ["subject:upsert", "asset:upsert", "origin:upsert", "provenance:upsert"]);
  assert.equal(registration.subjectId, "subject-1");
  assert.equal(registration.assetId, "asset-1");
  assert.equal(registration.webOriginId, "web-origin-1");
  assert.equal(registration.origin, "https://app.example.com");
  assert.equal(registration.verificationStatus, "PENDING");
  assert.equal(registration.verificationToken.length, 43);
});

test("create rejects an unknown target path role before writing anything", async () => {
  let transactions = 0;
  const prisma = {
    $transaction: async () => {
      transactions += 1;
    },
  };
  const service = buildService({ prisma, subjects: {} });

  await assert.rejects(
    service.create({
      origin: "https://app.example.com",
      environment: "production",
      targetPaths: { "auth.signup": "/signup" },
      sourceType: "project",
      sourceId: "project-1",
    }),
    /Unknown target path role/,
  );
  assert.equal(transactions, 0);
});

test("requestVerification issues a DNS challenge and stores the requested method", async () => {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const prisma = {
    securityEvaluationWebOrigin: {
      findUnique: async () => fakeWebOriginRow(),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        return fakeWebOriginRow({ verificationMethod: String(args.data.verificationMethod) });
      },
    },
  };
  const service = buildService({ prisma, subjects: {} });

  const challenge = await service.requestVerification("asset-1", "DNS_TXT");

  assert.equal(challenge.assetId, "asset-1");
  assert.equal(challenge.origin, "https://app.example.com");
  assert.equal(challenge.method, "DNS_TXT");
  assert.equal(challenge.dnsRecordName, `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX}.app.example.com`);
  assert.equal(challenge.dnsRecordValue, `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX}token-1`);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.verificationMethod, "DNS_TXT");
});

test("verify marks a matching DNS record VERIFIED and stamps the timestamps", async () => {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const prisma = {
    securityEvaluationWebOrigin: {
      findUnique: async () => fakeWebOriginRow(),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        return fakeWebOriginRow({
          verificationStatus: "VERIFIED",
          verifiedAt: args.data.verifiedAt as Date,
          lastVerifiedAt: args.data.lastVerifiedAt as Date,
          verificationFailures: 0,
        });
      },
    },
  };
  const lookups: string[] = [];
  const fetch: VerificationFetchAccess = {
    lookupTxt: async (name: string) => {
      lookups.push(name);
      return [`${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX}token-1`];
    },
    fetchText: async () => "",
  };
  const service = buildService({ prisma, subjects: {}, fetch });

  const result = await service.verify("asset-1");

  assert.deepEqual(lookups, [`${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX}.app.example.com`]);
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.consecutiveFailures, 0);
  assert.ok(result.verifiedAt instanceof Date);
  assert.ok(result.lastVerifiedAt instanceof Date);
});

test("verify counts a mismatching well-known body as a failure but keeps VERIFIED below the threshold", async () => {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const prisma = {
    securityEvaluationWebOrigin: {
      findUnique: async () => fakeWebOriginRow({ verificationMethod: "WELL_KNOWN", verificationStatus: "VERIFIED" }),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        return fakeWebOriginRow({
          verificationStatus: "VERIFIED",
          verificationFailures: args.data.verificationFailures as number,
        });
      },
    },
  };
  const urls: string[] = [];
  const fetch: VerificationFetchAccess = {
    lookupTxt: async () => [],
    fetchText: async (url: string) => {
      urls.push(url);
      return "another-token\n";
    },
  };
  const service = buildService({ prisma, subjects: {}, fetch });

  const result = await service.verify("asset-1");

  assert.deepEqual(urls, ["https://app.example.com/.well-known/nightwatch-verification.txt"]);
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.consecutiveFailures, 1);
});

test("verify drops to FAILED once consecutive failures reach the threshold", async () => {
  const prisma = {
    securityEvaluationWebOrigin: {
      findUnique: async () => fakeWebOriginRow({ verificationStatus: "VERIFIED", verificationFailures: 2 }),
      update: async (args: { data: Record<string, unknown> }) =>
        fakeWebOriginRow({
          verificationStatus: "FAILED",
          verificationFailures: args.data.verificationFailures as number,
        }),
    },
  };
  const fetch: VerificationFetchAccess = {
    lookupTxt: async () => [],
    fetchText: async () => "",
  };
  const service = buildService({ prisma, subjects: {}, fetch });

  const result = await service.verify("asset-1");

  assert.equal(result.status, "FAILED");
  assert.equal(result.consecutiveFailures, 3);
});

test("verify fails the call with a wiring error when the port is not bound", async () => {
  const service = buildService({ prisma: {}, subjects: {} });

  await assert.rejects(service.verify("asset-1"), /not bound/);
});

test("listActiveVerified returns only active verified origins and lazily re-verifies due rows", async () => {
  const due = new Date(Date.now() - 40 * 86_400_000);
  const fresh = new Date();
  const prisma = {
    securityEvaluationWebOrigin: {
      findMany: async () => [
        fakeWebOriginRow({
          assetId: "asset-due",
          lastVerifiedAt: due,
          verificationStatus: "VERIFIED",
          asset: {
            id: "asset-due",
            subjectId: "subject-due",
            naturalKey: "https://due.example.com",
            displayName: "Due",
          },
        }),
        fakeWebOriginRow({
          assetId: "asset-fresh",
          environment: "staging",
          targetPaths: {},
          lastVerifiedAt: fresh,
          verificationStatus: "VERIFIED",
          asset: {
            id: "asset-fresh",
            subjectId: "subject-fresh",
            naturalKey: "https://fresh.example.com",
            displayName: "Fresh",
          },
        }),
      ],
    },
  };
  const service = buildService({ prisma, subjects: {} });
  const verified: string[] = [];
  service.verify = async (assetId: string): Promise<SecurityEvaluationWebOriginVerificationResult> => {
    verified.push(assetId);
    return {
      assetId,
      origin: "https://due.example.com",
      status: "VERIFIED",
      verifiedAt: fresh,
      lastVerifiedAt: fresh,
      consecutiveFailures: 0,
    };
  };

  const targets = await service.listActiveVerified();

  assert.deepEqual(verified, ["asset-due"]);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets[0], {
    subjectId: "subject-due",
    assetId: "asset-due",
    origin: "https://due.example.com",
    label: "Due",
    environment: "production",
    targetPaths: { "auth.login": "/login" },
  });
  assert.equal(targets[1].assetId, "asset-fresh");
});

test("listActiveVerified drops an origin whose lazy re-verification falls to FAILED", async () => {
  const prisma = {
    securityEvaluationWebOrigin: {
      findMany: async () => [
        fakeWebOriginRow({
          assetId: "asset-due",
          lastVerifiedAt: null,
          verificationStatus: "VERIFIED",
        }),
      ],
    },
  };
  const service = buildService({ prisma, subjects: {} });
  service.verify = async (assetId: string): Promise<SecurityEvaluationWebOriginVerificationResult> => ({
    assetId,
    origin: "https://app.example.com",
    status: "FAILED",
    verifiedAt: null,
    lastVerifiedAt: null,
    consecutiveFailures: 3,
  });

  assert.deepEqual(await service.listActiveVerified(), []);
});
