import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesIpRestriction, matchesReferrerRestriction, normalizeRestrictions } from "./api-key-restrictions";

/**
 * R20-10: network restrictions were stored but never enforced. These tests pin
 * the matching semantics the verifier now applies.
 */

test("normalizeRestrictions keeps only non-empty strings", () => {
  assert.deepEqual(normalizeRestrictions(["1.2.3.4", "", 42, null, "  "]), ["1.2.3.4"]);
  assert.deepEqual(normalizeRestrictions(null), []);
  assert.deepEqual(normalizeRestrictions("1.2.3.4"), []);
});

test("exact IP and CIDR entries match, non-matching addresses do not", () => {
  assert.equal(matchesIpRestriction("203.0.113.5", ["203.0.113.5"]), true);
  assert.equal(matchesIpRestriction("203.0.113.6", ["203.0.113.5"]), false);
  assert.equal(matchesIpRestriction("10.20.30.40", ["10.0.0.0/8"]), true);
  assert.equal(matchesIpRestriction("192.168.1.1", ["10.0.0.0/8"]), false);
});

test("IPv4-mapped IPv6 peer addresses are normalized", () => {
  assert.equal(matchesIpRestriction("::ffff:203.0.113.5", ["203.0.113.5"]), true);
  assert.equal(matchesIpRestriction("::ffff:10.1.2.3", ["10.0.0.0/8"]), true);
});

test("IPv6 entries and subnets match", () => {
  assert.equal(matchesIpRestriction("2001:db8::1", ["2001:db8::/32"]), true);
  assert.equal(matchesIpRestriction("2001:db9::1", ["2001:db8::/32"]), false);
});

test("a missing or malformed client address never matches", () => {
  assert.equal(matchesIpRestriction(undefined, ["10.0.0.0/8"]), false);
  assert.equal(matchesIpRestriction("not-an-ip", ["10.0.0.0/8"]), false);
});

test("malformed entries are ignored rather than denying everyone", () => {
  assert.equal(matchesIpRestriction("203.0.113.5", ["nonsense"]), false);
});

test("referrer restrictions match hosts, origins and wildcard subdomains", () => {
  const entries = ["app.example.com"];
  assert.equal(matchesReferrerRestriction("https://app.example.com", undefined, entries), true);
  assert.equal(matchesReferrerRestriction(undefined, "https://app.example.com/page", entries), true);
  assert.equal(matchesReferrerRestriction("https://evil.example.com", undefined, entries), false);

  assert.equal(matchesReferrerRestriction("https://app.example.com", undefined, ["https://app.example.com"]), true);
  assert.equal(matchesReferrerRestriction("http://app.example.com", undefined, ["https://app.example.com"]), false);

  assert.equal(matchesReferrerRestriction("https://api.example.com", undefined, ["*.example.com"]), true);
  assert.equal(matchesReferrerRestriction("https://example.com", undefined, ["*.example.com"]), false);
});

test("a missing origin and referrer never matches", () => {
  assert.equal(matchesReferrerRestriction(undefined, undefined, ["app.example.com"]), false);
  assert.equal(matchesReferrerRestriction("not a url", undefined, ["app.example.com"]), false);
});
