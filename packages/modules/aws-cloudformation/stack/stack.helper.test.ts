import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCreateFailed,
  isCreateSucceeded,
  isDeleteFailed,
  isDeleteSucceeded,
  pollUntil,
  PollRejectedError,
  PollTimeoutError,
  selectOutput,
  toStackSnapshot,
} from "./stack.helper";
import { AppHostStack } from "./app-host.stack";
import { APP_HOST_TEMPLATE } from "./app-host.template";

/**
 * Unit tests for the stack primitives' pure parts: AWS status mapping,
 * bounded polling and the APP_HOST template contract.
 *
 * Run: `node --import tsx --test src/modules/aws-cloudformation/stack/stack.helper.test.ts`
 */

function makeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

describe("stack status mapping", () => {
  it("maps a stack description into name, status, outputs and reason", () => {
    const snapshot = toStackSnapshot({
      StackName: "project-prod",
      StackStatus: "CREATE_COMPLETE",
      StackStatusReason: undefined,
      Outputs: [
        { OutputKey: "InstanceId", OutputValue: "i-123" },
        { OutputKey: "PublicIp", OutputValue: "10.0.0.1" },
      ],
    });

    assert.equal(snapshot.name, "project-prod");
    assert.equal(snapshot.status, "CREATE_COMPLETE");
    assert.deepEqual(snapshot.outputs, { InstanceId: "i-123", PublicIp: "10.0.0.1" });
    assert.equal(snapshot.reason, null);
  });

  it("treats rollback complete as a create failure, not a success", () => {
    assert.equal(isCreateSucceeded("CREATE_COMPLETE"), true);
    assert.equal(isCreateSucceeded("ROLLBACK_COMPLETE"), false);
    assert.equal(isCreateFailed("ROLLBACK_COMPLETE"), true);
    assert.equal(isCreateFailed("CREATE_FAILED"), true);
    assert.equal(isCreateFailed("CREATE_COMPLETE"), false);
  });

  it("only accepts DELETE_COMPLETE as delete success", () => {
    assert.equal(isDeleteSucceeded("DELETE_COMPLETE"), true);
    assert.equal(isDeleteSucceeded("DELETE_IN_PROGRESS"), false);
    assert.equal(isDeleteFailed("DELETE_FAILED"), true);
  });

  it("returns null for a missing or empty output", () => {
    assert.equal(selectOutput({}, "InstanceId"), null);
    assert.equal(selectOutput({ InstanceId: "" }, "InstanceId"), null);
    assert.equal(selectOutput({ InstanceId: "i-123" }, "InstanceId"), "i-123");
  });
});

describe("bounded polling", () => {
  it("returns immediately when the first read is accepted", async () => {
    let reads = 0;
    const value = await pollUntil(
      async () => {
        reads += 1;
        return "CREATE_COMPLETE";
      },
      {
        intervalMs: 1000,
        timeoutMs: 3000,
        accept: (status) => status === "CREATE_COMPLETE",
        describe: (status) => status,
      },
    );

    assert.equal(value, "CREATE_COMPLETE");
    assert.equal(reads, 1);
  });

  it("retries until the external state settles", async () => {
    const clock = makeClock();
    const statuses = ["CREATE_IN_PROGRESS", "CREATE_IN_PROGRESS", "CREATE_COMPLETE"];
    let reads = 0;
    const value = await pollUntil(async () => statuses[reads++] ?? "CREATE_COMPLETE", {
      intervalMs: 1000,
      timeoutMs: 10_000,
      accept: (status) => status === "CREATE_COMPLETE",
      describe: (status) => status,
      now: clock.now,
      sleep: clock.sleep,
    });

    assert.equal(value, "CREATE_COMPLETE");
    assert.equal(reads, 3);
  });

  it("rejects a terminal failure instead of waiting for the deadline", async () => {
    const clock = makeClock();
    await assert.rejects(
      pollUntil(async () => "ROLLBACK_COMPLETE", {
        intervalMs: 1000,
        timeoutMs: 60_000,
        accept: () => false,
        fail: (status) => (status === "ROLLBACK_COMPLETE" ? "stack rolled back" : null),
        describe: (status) => status,
        now: clock.now,
        sleep: clock.sleep,
      }),
      (error: unknown) => error instanceof PollRejectedError && /rolled back/.test(error.message),
    );
    assert.equal(clock.now(), 0);
  });

  it("fails with a timeout once the deadline is reached", async () => {
    const clock = makeClock();
    await assert.rejects(
      pollUntil(async () => "CREATE_IN_PROGRESS", {
        intervalMs: 1000,
        timeoutMs: 3000,
        accept: () => false,
        describe: (status) => status,
        now: clock.now,
        sleep: clock.sleep,
      }),
      (error: unknown) => error instanceof PollTimeoutError,
    );
    assert.equal(clock.now(), 3000);
  });
});

describe("APP_HOST template contract", () => {
  it("declares every parameter the module documents", () => {
    assert.deepEqual(
      Object.keys(AppHostStack.getStackParams()).sort(),
      Object.keys(APP_HOST_TEMPLATE.Parameters).sort(),
    );
  });

  it("exposes the documented outputs", () => {
    assert.deepEqual(AppHostStack.getStackOutputKeys(), [
      "InstanceId",
      "PublicIp",
      "EcrRepositoryUri",
      "CiRoleArn",
      "AppUrl",
      "HealthCheckId",
    ]);
  });

  it("submits an inline JSON template body, not an S3 URL", () => {
    const body = AppHostStack.getStackTemplateBody();
    assert.ok(body.startsWith("{"));
    assert.equal(body.includes("TemplateURL"), false);
    const parsed = JSON.parse(body);
    assert.deepEqual(Object.keys(parsed.Resources).sort(), [
      "BackupBucket",
      "CiRole",
      "EcrRepository",
      "EipAssociation",
      "ElasticIp",
      "WebDnsRecord",
      "WebHealthCheck",
      "WebInstance",
      "WebInstanceProfile",
      "WebInstanceRole",
      "WebSecurityGroup",
    ]);
  });

  it("requires IMDSv2 and keeps the host reachable only over 80/443", () => {
    const instance = APP_HOST_TEMPLATE.Resources.WebInstance.Properties;
    assert.equal(instance.MetadataOptions.HttpTokens, "required");
    assert.equal(instance.DisableApiTermination, true);
    const ingress = APP_HOST_TEMPLATE.Resources.WebSecurityGroup.Properties.SecurityGroupIngress;
    assert.deepEqual(
      ingress.map((rule) => rule.FromPort),
      [80, 443],
    );
  });
});
