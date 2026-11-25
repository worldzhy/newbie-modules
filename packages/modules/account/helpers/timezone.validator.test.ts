import assert from "node:assert/strict";
import { test } from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { UpdateMeDto } from "../account.dto";
import { CreateUserDto, UpdateUserDto } from "../modules/user/user.dto";
import { isIanaTimezone } from "./timezone.validator";

/**
 * ADR-077: the account timezone is the display source of truth, so an
 * unformattable value is a broken preference everywhere it is read. Reject it
 * at the write boundary instead of relying on every reader's UTC fallback.
 */

const ACCEPTED = ["Asia/Shanghai", "UTC", "America/New_York", "Etc/UTC"];
const REJECTED = ["", "Mars/Olympus_Mons", "Asia", "Asia/Shanghai ", "+08:00"];

async function invalidProperties(instance: object): Promise<string[]> {
  const errors = await validate(instance);
  return errors.map((error) => error.property).sort();
}

test("the probe accepts zones the runtime can format with", () => {
  for (const timezone of ACCEPTED) {
    assert.equal(isIanaTimezone(timezone), true, timezone);
  }
});

test("the probe rejects unformattable zones and blanks", () => {
  for (const timezone of REJECTED) {
    assert.equal(isIanaTimezone(timezone), false, JSON.stringify(timezone));
  }
});

test("UpdateMeDto validates timezone on the self-service write path", async () => {
  for (const timezone of REJECTED) {
    assert.deepEqual(
      await invalidProperties(plainToInstance(UpdateMeDto, { timezone })),
      ["timezone"],
      JSON.stringify(timezone),
    );
  }
  assert.deepEqual(await invalidProperties(plainToInstance(UpdateMeDto, { timezone: "Asia/Shanghai" })), []);
  assert.deepEqual(await invalidProperties(plainToInstance(UpdateMeDto, {})), []);
});

test("admin create and update validate timezone too", async () => {
  for (const timezone of REJECTED) {
    assert.deepEqual(
      await invalidProperties(plainToInstance(CreateUserDto, { timezone })),
      ["timezone"],
      JSON.stringify(timezone),
    );
    assert.deepEqual(
      await invalidProperties(plainToInstance(UpdateUserDto, { timezone })),
      ["timezone"],
      JSON.stringify(timezone),
    );
  }
  assert.deepEqual(await invalidProperties(plainToInstance(CreateUserDto, { timezone: "UTC" })), []);
  assert.deepEqual(await invalidProperties(plainToInstance(UpdateUserDto, { timezone: "UTC" })), []);
});
