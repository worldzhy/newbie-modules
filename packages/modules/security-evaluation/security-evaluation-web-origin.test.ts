import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import {
  SecurityEvaluationWebOriginService,
  normalizeWebOrigin,
} from "./assets/security-evaluation-web-origin.service";
import type { WebOriginVerificationCheckResponseDto } from "./security-evaluation-web-origin.dto";
import {
  SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
  SECURITY_EVALUATION_SUBJECT_TYPE,
  SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX,
  SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX,
} from "./security-evaluation.constants";
import type { VerificationFetchAccess } from "./ports/web-origin-verification-access.port";

/**
 * Behavior-level test for web-origin registration and ownership verification
 * (ADR-066 §1, ADR-044 §2, ADR-068 D7): the registration transaction, origin
 * normalization, the two verification channels and the lazy re-verification
 * gate. Identity is the subject; there is no asset or provenance row.
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
  subjectId: string;
  targetPaths: Record<string, string>;
  verificationStatus: string;
  verificationToken: string;
  verificationMethod: string | null;
  verificationFailureCount: number;
  verifiedAt: Date | null;
  lastVerifiedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function fakeWebOriginRow(overrides: Partial<FakeWebOriginRow> = {}): FakeWebOriginRow {
  return {
    id: "web-origin-1",
    subjectId: "subject-1",
    targetPaths: { "auth.login": "/login" },
    verificationStatus: "PENDING",
    verificationToken: "token-1",
    verificationMethod: "DNS_TXT",
    verificationFailureCount: 0,
    verifiedAt: null,
    lastVerifiedAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeSubject(overrides: { subjectKey?: string; displayName?: string } = {}) {
  return {
    subjectKey: "https://app.example.com",
    displayName: "App",
    ...overrides,
  };
}

function buildService(overrides: { prisma: unknown; subjects: unknown; fetch?: VerificationFetchAccess }) {
  return new SecurityEvaluationWebOriginService(
    overrides.prisma as PrismaService,
    overrides.subjects as never,
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

test("create writes the subject and web-origin in one transaction", async () => {
  const calls: string[] = [];
  const transactionClient = {
    securityEvaluationWebOrigin: {
      upsert: async (args: { where: { subjectId: string }; create: { verificationToken: string } }) => {
        calls.push("origin:upsert");
        assert.equal(args.where.subjectId, "subject-1");
        return {
          id: "web-origin-1",
          subjectId: "subject-1",
          verificationStatus: "PENDING",
          verificationToken: args.create.verificationToken,
        };
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (transaction: typeof transactionClient) => unknown) => callback(transactionClient),
  };
  const subjects = {
    getOrCreateSubject: async (descriptor: { subjectType: string; kind: string; subjectKey: string }) => {
      calls.push("subject:upsert");
      assert.equal(descriptor.subjectType, SECURITY_EVALUATION_SUBJECT_TYPE);
      assert.equal(descriptor.kind, SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN);
      assert.equal(descriptor.subjectKey, "https://app.example.com");
      return {
        id: "subject-1",
        subjectType: SECURITY_EVALUATION_SUBJECT_TYPE,
        kind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
        subjectKey: "https://app.example.com",
        displayName: "App",
      };
    },
  };
  const service = buildService({ prisma, subjects });

  const registration = await service.create({
    origin: "HTTPS://App.Example.com:443/",
    label: "App",
    targetPaths: { "auth.login": "/login" },
  });

  assert.deepEqual(calls, ["subject:upsert", "origin:upsert"]);
  assert.equal(registration.subjectId, "subject-1");
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
      targetPaths: { "auth.signup": "/signup" },
    }),
    /Unknown target path role/,
  );
  assert.equal(transactions, 0);
});

test("rotateVerificationToken issues a fresh token and resets the failure count", async () => {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const prisma = {
    securityEvaluationWebOrigin: {
      findUnique: async () => fakeWebOriginRow(),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        return fakeWebOriginRow({ verificationToken: String(args.data.verificationToken) });
      },
    },
    evaluationSubject: {
      findUnique: async () => fakeSubject(),
    },
  };
  const service = buildService({ prisma, subjects: {} });

  const verification = await service.rotateVerificationToken("subject-1");

  assert.equal(verification.dnsTxt.name, `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX}.app.example.com`);
  assert.equal(
    verification.dnsTxt.value,
    `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX}${verification.token}`,
  );
  assert.equal(verification.wellKnown.url, "https://app.example.com/.well-known/nightwatch-verification.txt");
  assert.equal(verification.token.length, 43);
  assert.notEqual(verification.token, "token-1");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.verificationStatus, "PENDING");
  assert.equal(updates[0].data.verificationFailureCount, 0);
  assert.equal("verificationMethod" in updates[0].data, false);
});

test("rotateVerificationToken refuses VERIFIED and REVOKED origins", async () => {
  for (const status of ["VERIFIED", "REVOKED"]) {
    const prisma = {
      securityEvaluationWebOrigin: {
        findUnique: async () => fakeWebOriginRow({ verificationStatus: status }),
        update: async () => {
          throw new Error("update must not run");
        },
      },
      evaluationSubject: {
        findUnique: async () => fakeSubject(),
      },
    };
    const service = buildService({ prisma, subjects: {} });
    await assert.rejects(service.rotateVerificationToken("subject-1"), /cannot be verified|already verified/);
  }
});

test("detail returns the verification bundle until the origin is verified", async () => {
  const pendingPrisma = {
    securityEvaluationWebOrigin: { findUnique: async () => fakeWebOriginRow() },
    evaluationSubject: { findUnique: async () => fakeSubject() },
  };
  const pending = await buildService({ prisma: pendingPrisma, subjects: {} }).detail("subject-1");
  assert.equal(pending.verification?.token, "token-1");

  const verifiedPrisma = {
    securityEvaluationWebOrigin: {
      findUnique: async () => fakeWebOriginRow({ verificationStatus: "VERIFIED", lastVerifiedAt: new Date() }),
    },
    evaluationSubject: { findUnique: async () => fakeSubject() },
  };
  const verified = await buildService({ prisma: verifiedPrisma, subjects: {} }).detail("subject-1");
  assert.equal(verified.verification, null);
});

test("checkVerification marks a matching DNS record VERIFIED and stamps the timestamps", async () => {
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
          verificationFailureCount: 0,
        });
      },
    },
    evaluationSubject: {
      findUnique: async () => fakeSubject(),
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

  const result = await service.checkVerification("subject-1");

  assert.deepEqual(lookups, [`${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX}.app.example.com`]);
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.consecutiveFailures, 0);
  assert.ok(result.verifiedAt instanceof Date);
  assert.ok(result.lastVerifiedAt instanceof Date);
});

test("checkVerification falls back to the well-known file and records that method", async () => {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const prisma = {
    securityEvaluationWebOrigin: {
      findUnique: async () => fakeWebOriginRow({ verificationMethod: null }),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        return fakeWebOriginRow({
          verificationStatus: "VERIFIED",
          verificationMethod: String(args.data.verificationMethod),
          verifiedAt: args.data.verifiedAt as Date,
          lastVerifiedAt: args.data.lastVerifiedAt as Date,
        });
      },
    },
    evaluationSubject: {
      findUnique: async () => fakeSubject(),
    },
  };
  const urls: string[] = [];
  const fetch: VerificationFetchAccess = {
    lookupTxt: async () => [],
    fetchText: async (url: string) => {
      urls.push(url);
      return "token-1\n";
    },
  };
  const service = buildService({ prisma, subjects: {}, fetch });

  const result = await service.checkVerification("subject-1");

  assert.deepEqual(urls, ["https://app.example.com/.well-known/nightwatch-verification.txt"]);
  assert.equal(result.status, "VERIFIED");
  assert.equal(updates[0].data.verificationMethod, "WELL_KNOWN");
});

test("checkVerification counts a mismatching well-known body as a failure but keeps VERIFIED below the threshold", async () => {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const prisma = {
    securityEvaluationWebOrigin: {
      findUnique: async () => fakeWebOriginRow({ verificationMethod: "WELL_KNOWN", verificationStatus: "VERIFIED" }),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        return fakeWebOriginRow({
          verificationStatus: "VERIFIED",
          verificationFailureCount: args.data.verificationFailureCount as number,
        });
      },
    },
    evaluationSubject: {
      findUnique: async () => fakeSubject(),
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

  const result = await service.checkVerification("subject-1");

  assert.deepEqual(urls, ["https://app.example.com/.well-known/nightwatch-verification.txt"]);
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.consecutiveFailures, 1);
});

test("checkVerification drops to FAILED once consecutive failures reach the threshold", async () => {
  const prisma = {
    securityEvaluationWebOrigin: {
      findUnique: async () => fakeWebOriginRow({ verificationStatus: "VERIFIED", verificationFailureCount: 2 }),
      update: async (args: { data: Record<string, unknown> }) =>
        fakeWebOriginRow({
          verificationStatus: "FAILED",
          verificationFailureCount: args.data.verificationFailureCount as number,
        }),
    },
    evaluationSubject: {
      findUnique: async () => fakeSubject(),
    },
  };
  const fetch: VerificationFetchAccess = {
    lookupTxt: async () => [],
    fetchText: async () => "",
  };
  const service = buildService({ prisma, subjects: {}, fetch });

  const result = await service.checkVerification("subject-1");

  assert.equal(result.status, "FAILED");
  assert.equal(result.consecutiveFailures, 3);
});

test("checkVerification fails the call with a wiring error when the port is not bound", async () => {
  const service = buildService({ prisma: {}, subjects: {} });

  await assert.rejects(service.checkVerification("subject-1"), /not bound/);
});

test("listActiveVerified returns only active verified origins and lazily re-verifies due rows", async () => {
  const due = new Date(Date.now() - 40 * 86_400_000);
  const fresh = new Date();
  const prisma = {
    securityEvaluationWebOrigin: {
      findMany: async () => [
        fakeWebOriginRow({
          subjectId: "subject-due",
          lastVerifiedAt: due,
          verificationStatus: "VERIFIED",
        }),
        fakeWebOriginRow({
          subjectId: "subject-fresh",
          targetPaths: {},
          lastVerifiedAt: fresh,
          verificationStatus: "VERIFIED",
        }),
      ],
    },
    evaluationSubject: {
      findMany: async () => [
        { id: "subject-due", subjectKey: "https://due.example.com", displayName: "Due" },
        { id: "subject-fresh", subjectKey: "https://fresh.example.com", displayName: "Fresh" },
      ],
    },
  };
  const service = buildService({ prisma, subjects: {} });
  const verified: string[] = [];
  service.checkVerification = async (subjectId: string): Promise<WebOriginVerificationCheckResponseDto> => {
    verified.push(subjectId);
    return {
      subjectId,
      origin: "https://due.example.com",
      status: "VERIFIED",
      verifiedAt: fresh,
      lastVerifiedAt: fresh,
      consecutiveFailures: 0,
    };
  };

  const targets = await service.listActiveVerified();

  assert.deepEqual(verified, ["subject-due"]);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets[0], {
    subjectId: "subject-due",
    origin: "https://due.example.com",
    label: "Due",
    targetPaths: { "auth.login": "/login" },
  });
  assert.equal(targets[1].subjectId, "subject-fresh");
});

test("listActiveVerified drops an origin whose lazy re-verification falls to FAILED", async () => {
  const prisma = {
    securityEvaluationWebOrigin: {
      findMany: async () => [
        fakeWebOriginRow({
          subjectId: "subject-due",
          lastVerifiedAt: null,
          verificationStatus: "VERIFIED",
        }),
      ],
    },
    evaluationSubject: {
      findMany: async () => [{ id: "subject-due", subjectKey: "https://app.example.com", displayName: "App" }],
    },
  };
  const service = buildService({ prisma, subjects: {} });
  service.checkVerification = async (subjectId: string): Promise<WebOriginVerificationCheckResponseDto> => ({
    subjectId,
    origin: "https://app.example.com",
    status: "FAILED",
    verifiedAt: null,
    lastVerifiedAt: null,
    consecutiveFailures: 3,
  });

  assert.deepEqual(await service.listActiveVerified(), []);
});
