import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDrillRedactor, redactDeep, REDACTED, SUBJECT_MASK } from "./work-evaluation-redaction";

/**
 * Drill-down scrubbing contract (ADR-024): whatever a tool returns must neither
 * leak credentials nor re-identify the blind subject. The secret patterns mirror
 * the collector-side scrubber (devbie/packages/worklog/src/redact.ts) — if one
 * list changes, change both.
 */

const NO_IDENTITY = new Set<string>();

describe("secret patterns", () => {
  const cases: { name: string; input: string; expected: string }[] = [
    {
      name: "aws-access-key",
      input: "aws_access_key_id = AKIAIOSFODNN7EXAMPLE in the log",
      expected: `aws_access_key_id = ${REDACTED} in the log`,
    },
    {
      name: "aws temp key (ASIA)",
      input: "ASIAIOSFODNN7EXAMPLE",
      expected: REDACTED,
    },
    {
      name: "github-token",
      input: "token ghp_abcdefghijklmnopqrstuvwxyz1234 was committed",
      expected: `token ${REDACTED} was committed`,
    },
    {
      name: "github-pat",
      input: "github_pat_abcdefghij_1234567890",
      expected: REDACTED,
    },
    {
      name: "openai-key",
      input: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
      expected: `OPENAI_API_KEY=${REDACTED}`,
    },
    {
      name: "google-api-key",
      input: "key: AIzaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      expected: `key: ${REDACTED}`,
    },
    {
      name: "slack-token",
      input: "xoxb-1234567890-abcdefghijkl",
      expected: REDACTED,
    },
    {
      name: "private-key-block",
      input: "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\nafter",
      expected: `before\n${REDACTED}\nafter`,
    },
    {
      name: "jwt",
      input:
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      expected: `Authorization: Bearer ${REDACTED}`,
    },
  ];

  const redact = createDrillRedactor(NO_IDENTITY);
  for (const { name, input, expected } of cases) {
    it(`redacts ${name}`, () => {
      assert.equal(redact(input), expected);
    });
  }

  it("keeps the key name on assigned secrets so the reader knows what was removed", () => {
    assert.equal(redact("password=hunter2xyz in the config"), `password=${REDACTED} in the config`);
    // The opening quote is part of the matched assignment; the closing quote is
    // outside the value character class and stays.
    assert.equal(redact('Password: "sup3rsecret"'), `Password=${REDACTED}"`);
    assert.equal(redact("api_key: abcdef123456"), `api_key=${REDACTED}`);
    // JSON-shaped assignments must be caught too, not just key=value text.
    assert.equal(redact('{"password": "hunter2xyz"}'), `{"password=${REDACTED}"}`);
  });

  it("leaves ordinary text untouched", () => {
    const text = "refactored the parser, opened a PR, discussed the token budget";
    // "token budget" has no assignment, so the assigned-secret pattern must not fire.
    assert.equal(redact(text), text);
  });
});

describe("identity tokens", () => {
  it("masks email-shaped tokens case-insensitively", () => {
    const redact = createDrillRedactor(new Set(["Jane.Doe@example.com"]));

    assert.equal(redact("committed by jane.doe@example.com"), `committed by ${SUBJECT_MASK}`);
    assert.equal(redact("JANE.DOE@EXAMPLE.COM approved"), `${SUBJECT_MASK} approved`);
  });

  it("masks plain tokens literally, longest first so a short token never eats part of a longer one", () => {
    const redact = createDrillRedactor(new Set(["Al", "Alice Smith"]));

    assert.equal(redact("Alice Smith and Al paired on it"), `${SUBJECT_MASK} and ${SUBJECT_MASK} paired on it`);
  });

  it("applies identity masking before secret patterns in one pass", () => {
    const redact = createDrillRedactor(new Set(["Alice Smith"]));

    assert.equal(redact("Alice Smith used ghp_abcdefghijklmnopqrstuvwxyz1234"), `${SUBJECT_MASK} used ${REDACTED}`);
  });

  it("is a no-op on ordinary text when the token set is empty", () => {
    const redact = createDrillRedactor(new Set());

    const text = "session summary: discussed caching, no incidents";
    assert.equal(redact(text), text);
  });
});

describe("home-directory paths", () => {
  const redact = createDrillRedactor(NO_IDENTITY);

  it("masks the macOS login segment of an absolute path", () => {
    assert.equal(
      redact("/Users/henry/src/devbie/packages/app.ts"),
      `/Users/${SUBJECT_MASK}/src/devbie/packages/app.ts`,
    );
  });

  it("masks the Linux login segment of an absolute path", () => {
    assert.equal(redact("/home/henry/project/src/main.ts"), `/home/${SUBJECT_MASK}/project/src/main.ts`);
  });

  it("masks the Windows login segment of an absolute path", () => {
    assert.equal(redact("C:\\Users\\henry\\src\\app.ts"), `C:\\Users\\${SUBJECT_MASK}\\src\\app.ts`);
    // Windows paths are case-insensitive, and profile folders can contain spaces.
    assert.equal(redact("c:\\users\\John Doe\\Documents\\notes.md"), `c:\\users\\${SUBJECT_MASK}\\Documents\\notes.md`);
  });

  it("masks login names containing dots, dashes and underscores", () => {
    assert.equal(redact("/Users/john.doe_2-app/src/x.ts"), `/Users/${SUBJECT_MASK}/src/x.ts`);
  });

  it("masks a path embedded in prose, in a quoted value, or ending the string", () => {
    assert.equal(
      redact("opened /Users/henry/.claude/settings.json and continued"),
      `opened /Users/${SUBJECT_MASK}/.claude/settings.json and continued`,
    );
    assert.equal(redact('{"path":"/Users/henry/x.ts"}'), `{"path":"/Users/${SUBJECT_MASK}/x.ts"}`);
    assert.equal(redact("cwd /Users/henry"), `cwd /Users/${SUBJECT_MASK}`);
  });

  it("leaves URL path segments, relative paths and name-less prefixes alone", () => {
    const cases = [
      "https://example.com/home/henry/index.html",
      "https://api.example.com/Users/123/profile",
      "src/home/page.ts",
      "/Users/",
      "the home directory and the user profile",
    ];
    for (const text of cases) {
      assert.equal(redact(text), text);
    }
  });

  it("runs before identity tokens so a name token never partly eats a path segment", () => {
    const tokenRedact = createDrillRedactor(new Set(["alice"]));

    assert.equal(tokenRedact("/Users/alice-2/project and alice"), `/Users/${SUBJECT_MASK}/project and ${SUBJECT_MASK}`);
  });
});

describe("redactDeep", () => {
  const redact = createDrillRedactor(new Set(["Alice Smith"]));

  it("redacts every string inside nested objects and arrays", () => {
    const input = {
      title: "notes by Alice Smith",
      nested: {
        messages: ["Alice Smith wrote the doc", "plain text"],
        count: 3,
      },
      list: [{ author: "Alice Smith" }, { author: "someone else" }],
    };

    const output = redactDeep(input, redact);

    assert.deepEqual(output, {
      title: `notes by ${SUBJECT_MASK}`,
      nested: {
        messages: [`${SUBJECT_MASK} wrote the doc`, "plain text"],
        count: 3,
      },
      list: [{ author: SUBJECT_MASK }, { author: "someone else" }],
    });
  });

  it("leaves non-string leaves untouched, including Date instances", () => {
    const date = new Date("2026-10-01T00:00:00Z");
    const input = {
      n: 42,
      flag: true,
      nothing: null,
      when: date,
      text: "met Alice Smith",
    };

    const output = redactDeep(input, redact);

    assert.equal(output.n, 42);
    assert.equal(output.flag, true);
    assert.equal(output.nothing, null);
    assert.equal(output.when, date);
    assert.equal(output.text, `met ${SUBJECT_MASK}`);
  });
});
