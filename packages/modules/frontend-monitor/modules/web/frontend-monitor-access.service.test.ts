import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { FrontendMonitorAccessService } from "./frontend-monitor-access.service";

const service = new FrontendMonitorAccessService();

test("returns the requested appKey when it is inside the resolved scope", () => {
  assert.equal(service.assertVisibleAppKey(["abc1234", "def5678"], "def5678"), "def5678");
});

test("rejects every appKey when the resolved scope is empty", () => {
  assert.throws(() => service.assertVisibleAppKey([], "abc1234"), ForbiddenException);
});

test("rejects an appKey outside the resolved scope", () => {
  assert.throws(() => service.assertVisibleAppKey(["abc1234"], "def5678"), ForbiddenException);
});

test("rejects a missing or non-string appKey as a shape error", () => {
  assert.throws(() => service.assertVisibleAppKey(["abc1234"], undefined), BadRequestException);
  assert.throws(() => service.assertVisibleAppKey(["abc1234"], ""), BadRequestException);
  assert.throws(() => service.assertVisibleAppKey(["abc1234"], 42), BadRequestException);
});

test("rejects a malformed appKey before any scope comparison", () => {
  assert.throws(() => service.assertVisibleAppKey(["abc1234"], "../../etc/passwd"), BadRequestException);
  assert.throws(() => service.assertVisibleAppKey(["abc1234"], "$ne"), BadRequestException);
});

test("an unknown-but-well-formed appKey is indistinguishable from an out-of-scope one", () => {
  const message = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return (error as Error).message;
    }
    return "";
  };
  // Same exception and message as the out-of-scope case: no existence oracle.
  assert.equal(
    message(() => service.assertVisibleAppKey(["abc1234"], "zzz9999")),
    message(() => service.assertVisibleAppKey([], "zzz9999")),
  );
});
