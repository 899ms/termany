import assert from "node:assert/strict";
import test from "node:test";
import { authenticationErrorSummary, needsInteractiveAgentLogin } from "./agentAuthentication";

test("Claude OAuth expiry offers interactive login", () => {
  const error = "Internal error: Failed to authenticate: OAuth session expired and could not be refreshed";
  assert.equal(needsInteractiveAgentLogin("claude", error), true);
  assert.equal(authenticationErrorSummary(error), "Failed to authenticate: OAuth session expired and could not be refreshed");
});

test("unrelated errors and agents never show the Claude login action", () => {
  assert.equal(needsInteractiveAgentLogin("claude", "Rate limit exceeded"), false);
  assert.equal(needsInteractiveAgentLogin("codex", "Failed to authenticate"), false);
  assert.equal(needsInteractiveAgentLogin("custom", "OAuth session expired"), false);
});
