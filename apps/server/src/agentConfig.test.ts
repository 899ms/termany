import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AGENT_RUNTIME_REVISION, defaultAgentRuntime } from "@termany/core";

test("registry upgrades add native runtimes without overwriting opt-outs or custom adapters", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "termany-registry-"));
  const home = t.mock.method(os, "homedir", () => directory);
  const db = await import("./db.js");
  home.mock.restore();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { listAgentConfigs, saveAgentConfigs } = await import("./agentConfig.js");
  const defaults = listAgentConfigs().agents;
  const commands = { gemini: ["gemini", "--acp"], kimi: ["kimi", "acp"], kilocode: ["kilo", "acp"], cursor: ["cursor-agent", "acp"] };
  for (const [id, [command, args]] of Object.entries(commands)) {
    const runtime = defaults.find((agent) => agent.id === id)?.runtime;
    assert.equal(runtime?.protocol, "acp");
    if (runtime?.protocol !== "acp") continue;
    assert.equal(runtime.command, command);
    assert.equal(runtime.args, args);
  }
  assert.deepEqual(defaults.find((agent) => agent.id === "fastclaw")?.runtime, defaultAgentRuntime("fastclaw"));
  const custom = { ...defaultAgentRuntime("gemini")!, command: "/custom/adapter", args: "--custom", distribution: "custom" };
  const previous = defaults.map((agent) => ({ ...agent, enabled: true, runtime: null, runtimeRevision: 1 }));
  db.setAgentsRaw(JSON.stringify(previous));
  const migrated = listAgentConfigs().agents;
  for (const id of Object.keys(commands)) {
    assert.deepEqual(migrated.find((agent) => agent.id === id)?.runtime, defaultAgentRuntime(id));
  }
  assert.deepEqual(migrated.find((agent) => agent.id === "fastclaw")?.runtime, defaultAgentRuntime("fastclaw"));
  for (const id of ["claude", "codex", "opencode"]) {
    assert.equal(migrated.find((agent) => agent.id === id)?.runtime, null, "existing explicit opt-outs survive the revision bump");
  }
  assert.deepEqual(migrated.map((agent) => agent.id), previous.map((agent) => agent.id));
  assert.ok(migrated.every((agent) => agent.enabled));

  const saved = saveAgentConfigs(previous.map((agent) => agent.id === "gemini" ? { ...agent, runtime: custom } : agent));
  assert.deepEqual(saved.find((agent) => agent.id === "gemini")?.runtime, custom);
  const disabled = saveAgentConfigs(saved.map((agent) => ({ ...agent, runtime: null, runtimeRevision: AGENT_RUNTIME_REVISION })));
  assert.ok(disabled.every((agent) => agent.runtime === null));
  assert.ok(listAgentConfigs().agents.every((agent) => agent.runtime === null));

  db.setAgentsRaw(JSON.stringify([{ id: "kimi", name: "My Kimi", command: "kimi", enabled: false, runtime: null }]));
  const legacy = listAgentConfigs().agents[0];
  assert.deepEqual(legacy.runtime, defaultAgentRuntime("kimi"));
  assert.equal(legacy.enabled, false);
  assert.equal(legacy.name, "My Kimi");
});
