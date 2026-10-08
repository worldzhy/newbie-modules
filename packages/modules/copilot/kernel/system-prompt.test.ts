import assert from "node:assert/strict";
import { test } from "node:test";
import { COPILOT_SYSTEM_PROMPT, buildSystemPrompt } from "./system-prompt";

const PROJECT_ID = "b4971252-0098-4750-9b30-2050523b3a47";

test("buildSystemPrompt returns the base prompt without page context", () => {
  assert.equal(buildSystemPrompt(undefined), COPILOT_SYSTEM_PROMPT);
  assert.equal(buildSystemPrompt({}), COPILOT_SYSTEM_PROMPT);
});

test("buildSystemPrompt includes only the route when no params are present", () => {
  const prompt = buildSystemPrompt({ route: "/projects/[projectId]/settings" });
  assert.match(prompt, /Current route: \/projects\/\[projectId\]\/settings/);
  assert.ok(!prompt.includes("Current project id"));
});

test("buildSystemPrompt exposes the server-injected project id and placeholder rule", () => {
  const prompt = buildSystemPrompt({
    route: "/projects/[projectId]",
    params: { projectId: PROJECT_ID },
  });
  assert.match(prompt, new RegExp(PROJECT_ID));
  assert.match(prompt, /never ask the user which project/);
  assert.match(prompt, /\{projectId\}/);
});
