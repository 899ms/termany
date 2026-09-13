export type AgentRuntimeConfig = {
  protocol: "acp";
  command: string;
  args: string;
  distribution: "managed" | "system" | "custom";
  modelSource: "termany" | "agent";
} | {
  /** BeeAI Agent Communication Protocol 0.2 over HTTP/SSE. */
  protocol: "acp-http";
  endpoint: string;
  apiKey: string;
};

export const AGENT_RUNTIME_REVISION = 4;

// The introduction revision is per agent: adding a new adapter must not
// re-enable an older adapter that the user explicitly turned off.
type RuntimePreset = (AgentRuntimeConfig & { revision: number });
const stdio = (command: string, args: string, revision: number): RuntimePreset => ({
  protocol: "acp", command, args, revision, distribution: "system", modelSource: "agent",
});

const BUILTIN_RUNTIMES: Record<string, RuntimePreset> = {
  claude: stdio("npx", "-y @agentclientprotocol/claude-agent-acp", 1),
  codex: stdio("npx", "-y @agentclientprotocol/codex-acp", 1),
  opencode: stdio("opencode", "acp", 1),
  gemini: stdio("gemini", "--acp", 2),
  kimi: stdio("kimi", "acp", 2),
  kilocode: stdio("kilo", "acp", 2),
  // Use Cursor's unambiguous executable; `agent` can belong to another app.
  cursor: stdio("cursor-agent", "acp", 2),
  openclaw: stdio("openclaw", "acp", 3),
  hermes: stdio("hermes", "acp", 3),
  omp: stdio("omp", "acp", 3),
  // Droid exposes ACP through its headless exec mode, not a bare subcommand.
  droid: stdio("droid", "exec --output-format acp-daemon", 3),
  fastclaw: {
    protocol: "acp-http", endpoint: "http://127.0.0.1:18953/acp", apiKey: "", revision: 4,
  },
};

export function defaultAgentRuntime(id: string): AgentRuntimeConfig | undefined {
  if (!Object.prototype.hasOwnProperty.call(BUILTIN_RUNTIMES, id)) return undefined;
  const preset = BUILTIN_RUNTIMES[id];
  if (!preset) return undefined;
  const { revision: _revision, ...runtime } = preset;
  return runtime;
}

export function inheritsDefaultAgentRuntime(input: {
  id: string;
  runtime?: unknown;
  runtimeRevision?: number;
}): boolean {
  if (!Object.prototype.hasOwnProperty.call(input, "runtime")) return true;
  if (input.runtime != null) return false;
  const introduced = BUILTIN_RUNTIMES[input.id]?.revision;
  if (!introduced) return false;
  const revision = Number(input.runtimeRevision);
  return !Number.isFinite(revision) || revision < introduced;
}
