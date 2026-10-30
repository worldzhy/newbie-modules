import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isMembershipManager, isRoleAbove, membershipRank } from "./membership-role";

test("membershipRank orders OWNER > ADMIN > MEMBER and defaults to 0", () => {
  assert.equal(membershipRank("OWNER"), 3);
  assert.equal(membershipRank("ADMIN"), 2);
  assert.equal(membershipRank("MEMBER"), 1);
  assert.equal(membershipRank("NOPE"), 0);
});

test("only ADMIN and OWNER are membership managers", () => {
  assert.equal(isMembershipManager("OWNER"), true);
  assert.equal(isMembershipManager("ADMIN"), true);
  assert.equal(isMembershipManager("MEMBER"), false);
  assert.equal(isMembershipManager("NOPE"), false);
});

test("a role is above another only when strictly higher", () => {
  assert.equal(isRoleAbove("OWNER", "ADMIN"), true);
  assert.equal(isRoleAbove("ADMIN", "MEMBER"), true);
  assert.equal(isRoleAbove("ADMIN", "ADMIN"), false);
  assert.equal(isRoleAbove("MEMBER", "ADMIN"), false);
  // Unknown roles rank 0, so a real role always outranks them.
  assert.equal(isRoleAbove("MEMBER", "NOPE"), true);
});
