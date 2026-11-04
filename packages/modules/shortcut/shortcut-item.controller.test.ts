import assert from "node:assert/strict";
import { test } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ShortcutItemType } from "@generated/prisma/client";

import { ShortcutItemController, assertLinkContent } from "./shortcut-item.controller";

/**
 * Contract test for R6-10: the update path must validate the *merged* row.
 * `type` may be omitted from a patch, so a TEXT -> LINK switch that does not
 * resend `content` used to smuggle a `javascript:` payload past the
 * create-time `@IsUrl` rule.
 */

function buildController(row: Record<string, unknown> | null) {
  const prisma = {
    shortcutItem: {
      findUnique: async ({ where }: { where: { id: number } }) => (row !== null && where.id === row.id ? row : null),
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => ({
        ...row,
        ...data,
        id: where.id,
      }),
    },
  };
  return new ShortcutItemController(prisma as never);
}

const LINK_ROW = {
  id: 1,
  type: ShortcutItemType.LINK,
  content: "https://example.com",
  label: "Example",
};

const TEXT_ROW = {
  id: 2,
  type: ShortcutItemType.TEXT,
  content: "javascript:alert(1)",
  label: "Snippet",
};

test("assertLinkContent accepts absolute http(s) URLs", () => {
  assert.doesNotThrow(() => assertLinkContent(ShortcutItemType.LINK, "https://example.com"));
  assert.doesNotThrow(() => assertLinkContent(ShortcutItemType.LINK, "http://example.com"));
});

test("assertLinkContent rejects non-http(s) and relative content for LINK items", () => {
  for (const content of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "/relative"]) {
    assert.throws(
      () => assertLinkContent(ShortcutItemType.LINK, content),
      (error: unknown) => error instanceof BadRequestException,
      content,
    );
  }
});

test("assertLinkContent does not police TEXT snippets", () => {
  assert.doesNotThrow(() => assertLinkContent(ShortcutItemType.TEXT, "javascript:alert(1)"));
});

test("update rejects a LINK row whose stored content is not an http(s) URL", async () => {
  const controller = buildController({
    id: 1,
    type: ShortcutItemType.LINK,
    content: "javascript:alert(1)",
    label: "x",
  });

  await assert.rejects(
    controller.update("1", { label: "renamed" }),
    (error: unknown) => error instanceof BadRequestException,
  );
});

test("update rejects TEXT -> LINK when the patch omits content", async () => {
  const controller = buildController(TEXT_ROW);

  await assert.rejects(
    controller.update("2", { type: ShortcutItemType.LINK }),
    (error: unknown) => error instanceof BadRequestException,
  );
});

test("update accepts TEXT -> LINK when the patch sends an http(s) URL", async () => {
  const controller = buildController(TEXT_ROW);

  const updated = await controller.update("2", { type: ShortcutItemType.LINK, content: "https://example.com" });
  assert.equal(updated.type, ShortcutItemType.LINK);
  assert.equal(updated.content, "https://example.com");
});

test("update accepts a LINK label-only patch", async () => {
  const controller = buildController(LINK_ROW);

  const updated = await controller.update("1", { label: "renamed" });
  assert.equal(updated.label, "renamed");
  assert.equal(updated.content, LINK_ROW.content);
});

test("update returns 404 for a missing row", async () => {
  const controller = buildController(null);

  await assert.rejects(
    controller.update("99", { label: "renamed" }),
    (error: unknown) => error instanceof NotFoundException,
  );
});
