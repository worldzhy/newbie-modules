import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPublicHttpUrl, assertPubliclyResolvable, isBlockedAddress } from "./public-url";

test("isBlockedAddress blocks loopback, private, link-local and reserved IPv4", () => {
  const blocked = [
    "0.0.0.0",
    "10.0.0.8",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "224.0.0.1",
    "255.255.255.255",
  ];
  for (const address of blocked) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test("isBlockedAddress keeps public IPv4 outside the blocked ranges", () => {
  const allowed = ["8.8.8.8", "1.1.1.1", "100.63.255.255", "172.15.0.1", "172.32.0.1"];
  for (const address of allowed) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test("isBlockedAddress blocks loopback, link-local, ULA and mapped IPv6", () => {
  assert.equal(isBlockedAddress("::1"), true);
  assert.equal(isBlockedAddress("::"), true);
  assert.equal(isBlockedAddress("fe80::1"), true);
  assert.equal(isBlockedAddress("fd00::1234"), true);
  assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true);
  assert.equal(isBlockedAddress("::ffff:8.8.8.8"), false);
  assert.equal(isBlockedAddress("2606:4700::1111"), false);
});

test("assertPublicHttpUrl rejects non-http protocols and malformed URLs", () => {
  assert.throws(() => assertPublicHttpUrl("ftp://example.com"), /http/);
  assert.throws(() => assertPublicHttpUrl("not a url"), /Invalid URL/);
});

test("assertPublicHttpUrl accepts public URLs and rejects literal private IPs", () => {
  assert.equal(assertPublicHttpUrl("https://example.com/"), undefined);
  assert.equal(assertPublicHttpUrl("http://93.184.216.34/"), undefined);
  assert.throws(() => assertPublicHttpUrl("http://169.254.169.254/latest/meta-data"), /public/);
  assert.throws(() => assertPublicHttpUrl("http://[::1]/"), /public/);
});

test("assertPubliclyResolvable rejects hostnames resolving to private addresses", async () => {
  // localhost resolves to loopback on any host, so this needs no DNS stub.
  await assert.rejects(assertPubliclyResolvable("http://localhost/"), /non-public/);
  // A literal public IP passes without any DNS lookup.
  await assertPubliclyResolvable("http://93.184.216.34/");
});
