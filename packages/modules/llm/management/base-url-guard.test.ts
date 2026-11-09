import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { promises as dns } from "node:dns";
import { join } from "node:path";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { assertSafeBaseUrl } from "./base-url-guard";

/**
 * SSRF guard contract (R20-37): every administrator-supplied LLM endpoint is
 * fetched server-side, so loopback, private, link-local and metadata targets
 * must be rejected before the value is persisted or probed.
 *
 * The wiring block at the bottom exists because the guard file itself is
 * useless if create/update/test stop calling it — that is exactly how R20-37
 * went missing once.
 */

async function reject(url: string, expectedFragment?: string): Promise<void> {
  await assert.rejects(assertSafeBaseUrl(url), (error: unknown) => {
    assert.ok(error instanceof BadRequestException, `expected BadRequestException for ${url}`);
    if (expectedFragment) {
      assert.ok(
        error.message.includes(expectedFragment),
        `expected message to mention "${expectedFragment}", got "${error.message}"`,
      );
    }
    return true;
  });
}

describe("base url guard", () => {
  it("rejects malformed and non-http(s) urls", async () => {
    await reject("not a url");
    await reject("ftp://example.com/v1", "http(s)");
    await reject("file:///etc/passwd", "http(s)");
  });

  it("rejects internal hostnames without a DNS round trip", async () => {
    await reject("http://localhost:11434/v1", "internal");
    await reject("http://api.localhost/v1", "internal");
    await reject("http://printer.local/v1", "internal");
    await reject("http://metadata.google.internal/v1", "internal");
  });

  it("rejects loopback, private, link-local and metadata literals", async () => {
    for (const url of [
      "http://0.0.0.0/v1",
      "http://127.0.0.1/v1",
      "http://10.1.2.3/v1",
      "http://100.64.0.1/v1",
      "http://169.254.169.254/latest/meta-data",
      "http://172.16.5.4/v1",
      "http://192.168.1.10/v1",
      "http://[::1]/v1",
      "http://[fe80::1]/v1",
      "http://[fc00::1]/v1",
    ]) {
      await reject(url, "not public");
    }
  });

  it("accepts public literals", async () => {
    await assertSafeBaseUrl("https://8.8.8.8/v1");
    await assertSafeBaseUrl("https://[2606:4700:4700::1111]/v1");
  });

  it("rejects a hostname that resolves to a blocked address", async (t) => {
    t.mock.method(dns, "lookup", async () => [{ address: "10.1.2.3", family: 4 }]);
    await reject("https://llm.example.com/v1", "non-public");
  });

  it("rejects a hostname when any resolved address is blocked", async (t) => {
    t.mock.method(dns, "lookup", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await reject("https://llm.example.com/v1", "169.254.169.254");
  });

  it("accepts a hostname that only resolves to public addresses", async (t) => {
    t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
    await assertSafeBaseUrl("https://llm.example.com/v1");
  });

  it("fails closed when the hostname cannot be resolved", async (t) => {
    t.mock.method(dns, "lookup", async () => {
      throw new Error("ENOTFOUND");
    });
    await reject("https://llm.invalid/v1", "cannot be resolved");
  });

  it("is called by create, update and the draft test probe", () => {
    const serviceSource = readFileSync(join(__dirname, "llm-connection.service.ts"), "utf8");
    const controllerSource = readFileSync(join(__dirname, "llm-connection.controller.ts"), "utf8");
    const calls = (source: string) => source.split("await assertSafeBaseUrl(").length - 1;
    assert.equal(calls(serviceSource), 2, "create and update must both guard the base url");
    assert.equal(calls(controllerSource), 1, "the draft test probe must guard the base url");
  });
});
