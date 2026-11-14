import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import {
  SecurityEvaluationWebOriginService,
  normalizeWebOrigin,
} from "./assets/security-evaluation-web-origin.service";
import {
  SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
  SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX,
  SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX,
} from "./security-evaluation.constants";
import type { VerificationFetchAccess } from "./ports/web-origin-verification-access.port";

const CONFIG_VALUES: Record<string, string> = {
  "modules.security-evaluation.webOriginVerificationIntervalDays": "30",
  "modules.security-evaluation.webOriginReverifyFailureThreshold": "3",
  "modules.security-evaluation.webOriginTokenBytes": "32",
};

function buildService(overrides: {
  prisma: unknown;
  subjects: unknown;
  assets?: unknown;
  fetch?: VerificationFetchAccess;
}): SecurityEvaluationWebOriginService {
  const config = {
    getOrThrow: (key: string) => {
      const value = CONFIG_VALUES[key];
      if (value === undefined) throw new Error(`Unexpected config key ${key}`);
      return value;
    },
  } as unknown as ConfigService;
  return new SecurityEvaluationWebOriginService(
    overrides.prisma as PrismaService,
    overrides.subjects as never,
    (overrides.assets ?? {}) as SecurityEvaluationAssetService,
    config,
    overrides.fetch,
  );
}

describe("normalizeWebOrigin", () => {
  it("canonicalises scheme, host, default port and trailing slash", () => {
    expect(normalizeWebOrigin("HTTPS://APP.Example.COM:443/")).toBe("https://app.example.com");
    expect(normalizeWebOrigin("http://app.example.com:8080")).toBe("http://app.example.com:8080");
    expect(normalizeWebOrigin("https://例子.测试")).toBe("https://xn--fsqu00a.xn--0zwm56d");
  });

  it("rejects credentials, paths, queries and fragments", () => {
    expect(() => normalizeWebOrigin("https://user:pass@app.example.com")).toThrow(/credentials/);
    expect(() => normalizeWebOrigin("https://app.example.com/login")).toThrow(/path/);
    expect(() => normalizeWebOrigin("https://app.example.com/?a=1")).toThrow(/path/);
    expect(() => normalizeWebOrigin("https://app.example.com/#x")).toThrow(/path/);
    expect(() => normalizeWebOrigin("ftp://app.example.com")).toThrow(/http or https/);
  });
});

describe("SecurityEvaluationWebOriginService.create", () => {
  it("writes subject, asset, web-origin and provenance in one transaction", async () => {
    const calls: string[] = [];
    const transactionClient = {
      securityEvaluationWebOrigin: {
        upsert: jest.fn(async (args: unknown) => {
          calls.push("origin:upsert");
          expect(args).toMatchObject({ where: { assetId: "asset-1" } });
          return {
            id: "web-origin-1",
            assetId: "asset-1",
            verificationStatus: "PENDING",
            verificationToken: "token-1",
          };
        }),
      },
      securityEvaluationAssetProvenance: {
        upsert: jest.fn(async () => {
          calls.push("provenance:upsert");
          return {};
        }),
      },
    };
    const prisma = {
      $transaction: async (callback: (transaction: typeof transactionClient) => unknown) => callback(transactionClient),
    };
    const subjects = {
      getOrCreateSubject: jest.fn(async (descriptor: { kind: string; subjectKey: string }) => {
        calls.push("subject:upsert");
        expect(descriptor.kind).toBe(SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN);
        expect(descriptor.subjectKey).toBe("https://app.example.com");
        return {
          id: "subject-1",
          kind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
          scopeType: "platform",
          scopeId: "deployment",
          subjectKey: "https://app.example.com",
          displayName: "App",
        };
      }),
    };
    const assets = {
      getOrCreateAsset: jest.fn(async () => {
        calls.push("asset:upsert");
        return { id: "asset-1", subjectId: "subject-1", naturalKey: "https://app.example.com" };
      }),
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

    expect(calls).toEqual(["subject:upsert", "asset:upsert", "origin:upsert", "provenance:upsert"]);
    expect(registration).toMatchObject({
      subjectId: "subject-1",
      assetId: "asset-1",
      webOriginId: "web-origin-1",
      origin: "https://app.example.com",
      verificationStatus: "PENDING",
    });
    expect(registration.verificationToken).toHaveLength(43);
    expect(transactionClient.securityEvaluationAssetProvenance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          subjectId_sourceType_sourceId: {
            subjectId: "subject-1",
            sourceType: "project",
            sourceId: "project-1",
          },
        },
      }),
    );
  });

  it("rejects an unknown target path role before writing anything", async () => {
    const prisma = { $transaction: jest.fn() };
    const service = buildService({ prisma, subjects: {} });

    await expect(
      service.create({
        origin: "https://app.example.com",
        environment: "production",
        targetPaths: { "auth.signup": "/signup" },
        sourceType: "project",
        sourceId: "project-1",
      }),
    ).rejects.toThrow(/Unknown target path role/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("SecurityEvaluationWebOriginService verification", () => {
  function row(overrides: Record<string, unknown> = {}) {
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
      asset: {
        id: "asset-1",
        subjectId: "subject-1",
        naturalKey: "https://app.example.com",
        displayName: "App",
      },
      ...overrides,
    };
  }

  it("issues a DNS challenge and stores the requested method", async () => {
    const update = jest.fn(async () => row({ verificationMethod: "DNS_TXT" }));
    const prisma = {
      securityEvaluationWebOrigin: { findUnique: jest.fn(async () => row()), update },
    };
    const service = buildService({ prisma, subjects: {} });

    const challenge = await service.requestVerification("asset-1", "DNS_TXT");

    expect(challenge).toMatchObject({
      assetId: "asset-1",
      origin: "https://app.example.com",
      method: "DNS_TXT",
      dnsRecordName: `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX}.app.example.com`,
      dnsRecordValue: `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX}token-1`,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: "asset-1" },
        data: expect.objectContaining({ verificationMethod: "DNS_TXT" }),
      }),
    );
  });

  it("marks a matching DNS record VERIFIED and stamps the timestamps", async () => {
    const update = jest.fn(async (args: { data: Record<string, unknown> }) =>
      row({ ...args.data, verificationStatus: "VERIFIED" }),
    );
    const prisma = {
      securityEvaluationWebOrigin: { findUnique: jest.fn(async () => row()), update },
    };
    const fetch: VerificationFetchAccess = {
      lookupTxt: jest.fn(async () => [`${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX}token-1`]),
      fetchText: jest.fn(),
    };
    const service = buildService({ prisma, subjects: {}, fetch });

    const result = await service.verify("asset-1");

    expect(fetch.lookupTxt).toHaveBeenCalledWith(
      `${SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX}.app.example.com`,
    );
    expect(result.status).toBe("VERIFIED");
    expect(result.consecutiveFailures).toBe(0);
    expect(result.verifiedAt).toBeInstanceOf(Date);
    expect(result.lastVerifiedAt).toBeInstanceOf(Date);
  });

  it("matches a well-known body and fails a mismatching token", async () => {
    const update = jest.fn(async (args: { data: Record<string, unknown> }) => row({ ...args.data }));
    const prisma = {
      securityEvaluationWebOrigin: {
        findUnique: jest.fn(async () => row({ verificationMethod: "WELL_KNOWN", verificationStatus: "VERIFIED" })),
        update,
      },
    };
    const fetch: VerificationFetchAccess = {
      lookupTxt: jest.fn(),
      fetchText: jest.fn(async () => "another-token\n"),
    };
    const service = buildService({ prisma, subjects: {}, fetch });

    const result = await service.verify("asset-1");

    expect(fetch.fetchText).toHaveBeenCalledWith("https://app.example.com/.well-known/nightwatch-verification.txt");
    expect(result.status).toBe("VERIFIED");
    expect(result.consecutiveFailures).toBe(1);
  });

  it("drops to FAILED once consecutive failures reach the threshold", async () => {
    const update = jest.fn(async (args: { data: Record<string, unknown> }) => row({ ...args.data }));
    const prisma = {
      securityEvaluationWebOrigin: {
        findUnique: jest.fn(async () => row({ verificationStatus: "VERIFIED", verificationFailures: 2 })),
        update,
      },
    };
    const fetch: VerificationFetchAccess = {
      lookupTxt: jest.fn(async () => []),
      fetchText: jest.fn(),
    };
    const service = buildService({ prisma, subjects: {}, fetch });

    const result = await service.verify("asset-1");

    expect(result).toMatchObject({ status: "FAILED", consecutiveFailures: 3 });
  });

  it("fails the call with a wiring error when the port is not bound", async () => {
    const service = buildService({ prisma: {}, subjects: {} });

    await expect(service.verify("asset-1")).rejects.toThrow(/not bound/);
  });
});

describe("SecurityEvaluationWebOriginService.listActiveVerified", () => {
  it("returns only active verified origins and lazily re-verifies due rows", async () => {
    const due = new Date(Date.now() - 40 * 86_400_000);
    const fresh = new Date();
    const rows = [
      {
        assetId: "asset-due",
        environment: "production",
        targetPaths: { "auth.login": "/login" },
        verificationStatus: "VERIFIED",
        lastVerifiedAt: due,
        isActive: true,
        asset: { subjectId: "subject-due", naturalKey: "https://due.example.com", displayName: "Due" },
      },
      {
        assetId: "asset-fresh",
        environment: "staging",
        targetPaths: {},
        verificationStatus: "VERIFIED",
        lastVerifiedAt: fresh,
        isActive: true,
        asset: { subjectId: "subject-fresh", naturalKey: "https://fresh.example.com", displayName: "Fresh" },
      },
    ];
    const prisma = {
      securityEvaluationWebOrigin: { findMany: jest.fn(async () => rows) },
    };
    const service = buildService({ prisma, subjects: {} });
    const verify = jest.spyOn(service, "verify").mockResolvedValue({
      assetId: "asset-due",
      origin: "https://due.example.com",
      status: "VERIFIED",
      verifiedAt: fresh,
      lastVerifiedAt: fresh,
      consecutiveFailures: 0,
    });

    const targets = await service.listActiveVerified();

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith("asset-due");
    expect(targets).toEqual([
      {
        subjectId: "subject-due",
        assetId: "asset-due",
        origin: "https://due.example.com",
        label: "Due",
        environment: "production",
        targetPaths: { "auth.login": "/login" },
      },
      {
        subjectId: "subject-fresh",
        assetId: "asset-fresh",
        origin: "https://fresh.example.com",
        label: "Fresh",
        environment: "staging",
        targetPaths: {},
      },
    ]);
  });

  it("drops an origin whose lazy re-verification falls to FAILED", async () => {
    const prisma = {
      securityEvaluationWebOrigin: {
        findMany: jest.fn(async () => [
          {
            assetId: "asset-due",
            environment: "production",
            targetPaths: {},
            verificationStatus: "VERIFIED",
            lastVerifiedAt: null,
            isActive: true,
            asset: { subjectId: "subject-due", naturalKey: "https://due.example.com", displayName: "Due" },
          },
        ]),
      },
    };
    const service = buildService({ prisma, subjects: {} });
    jest.spyOn(service, "verify").mockResolvedValue({
      assetId: "asset-due",
      origin: "https://due.example.com",
      status: "FAILED",
      verifiedAt: null,
      lastVerifiedAt: null,
      consecutiveFailures: 3,
    });

    await expect(service.listActiveVerified()).resolves.toEqual([]);
  });
});
