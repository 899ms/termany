import { AGENT_RUNTIME_REVISION, defaultAgentRuntime, inheritsDefaultAgentRuntime } from "@termany/core";
import { getAgentsRaw, setAgentsRaw } from "./db.js";

export type AgentDistribution = "managed" | "system" | "custom";
export type AgentModelSource = "termany" | "agent";

export type AgentRuntimeConfig = {
  protocol: "acp";
  command: string;
  args: string;
  distribution: AgentDistribution;
  modelSource: AgentModelSource;
} | {
  protocol: "acp-http";
  endpoint: string;
  apiKey: string;
};

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string;
  enabled: boolean;
  icon?: string;
  builtIn: boolean;
  runtime?: AgentRuntimeConfig | null;
  /** Which generation of built-in ACP defaults this entry was written against. */
  runtimeRevision?: number;
}

/** Bumped whenever a built-in gains or changes its ACP adapter, so registries
 *  saved before that still pick the new default up. See sanitize(). */
export const RUNTIME_REVISION = AGENT_RUNTIME_REVISION;

const BUILTIN_AGENTS: AgentConfig[] = [
  {
    id: "claude",
    name: "Claude",
    command: "claude",
    args: "--dangerously-skip-permissions",
    enabled: true,
    builtIn: true,
    runtime: defaultAgentRuntime("claude"),
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    args: "--dangerously-bypass-approvals-and-sandbox",
    enabled: true,
    builtIn: true,
    runtime: defaultAgentRuntime("codex"),
  },
  { id: "gemini", name: "Gemini", command: "gemini", args: "--yolo", enabled: false, builtIn: true, runtime: defaultAgentRuntime("gemini") },
  { id: "openclaw", name: "OpenClaw", command: "openclaw", args: "", enabled: true, builtIn: true, runtime: defaultAgentRuntime("openclaw") },
  { id: "fastclaw", name: "FastClaw", command: "fastclaw", args: "", enabled: false, builtIn: true, runtime: defaultAgentRuntime("fastclaw") },
  { id: "hermes", name: "Hermes", command: "hermes", args: "", enabled: false, builtIn: true, runtime: defaultAgentRuntime("hermes") },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: "",
    enabled: false,
    builtIn: true,
    runtime: defaultAgentRuntime("opencode"),
  },
  { id: "kilocode", name: "Kilocode", command: "kilo", args: "", enabled: false, builtIn: true, runtime: defaultAgentRuntime("kilocode") },
  { id: "cursor", name: "Cursor", command: "cursor-agent", args: "", enabled: false, builtIn: true, runtime: defaultAgentRuntime("cursor") },
  { id: "kimi", name: "Kimi", command: "kimi", args: "", enabled: false, builtIn: true, runtime: defaultAgentRuntime("kimi") },
  { id: "droid", name: "Droid", command: "droid", args: "", enabled: false, builtIn: true, runtime: defaultAgentRuntime("droid") },
  { id: "omp", name: "OMP", command: "omp", args: "", enabled: false, builtIn: true, runtime: defaultAgentRuntime("omp") },
];

function runtime(input: any): AgentRuntimeConfig | undefined {
  if (!input) return undefined;
  if (input.protocol === "acp-http") {
    const endpoint = String(input.endpoint ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(endpoint)) return undefined;
    return { protocol: "acp-http", endpoint, apiKey: String(input.apiKey ?? "").trim() };
  }
  if (input.protocol !== "acp") return undefined;
  const command = String(input.command ?? "").trim();
  if (!command) return undefined;
  return {
    protocol: "acp",
    command,
    args: String(input.args ?? "").trim(),
    distribution: input.distribution === "managed" || input.distribution === "custom" ? input.distribution : "system",
    modelSource: input.modelSource === "termany" ? "termany" : "agent",
  };
}

function sanitize(input: any, builtIn = false, fallback?: AgentConfig): AgentConfig | null {
  const id = String(input?.id ?? "").trim();
  if (!id) return null;
  const command = String(input?.command ?? "").trim();
  // A stored `null` means "the user turned conversation support off" — but only
  // once the entry has seen this adapter's defaults. Registries written before a
  // built-in gained its adapter also hold null, and those must be backfilled or
  // the agent would never appear in the chat picker.
  const inherit = inheritsDefaultAgentRuntime(input);
  return {
    id,
    name: String(input?.name ?? "").trim() || id,
    command,
    args: String(input?.args ?? "").trim(),
    enabled: input?.enabled !== false,
    icon: typeof input?.icon === "string" ? input.icon : undefined,
    builtIn,
    runtime: inherit ? fallback?.runtime : input?.runtime === null ? null : runtime(input?.runtime),
    runtimeRevision: RUNTIME_REVISION,
  };
}

export function listAgentConfigs(): { agents: AgentConfig[]; persisted: boolean } {
  const raw = getAgentsRaw();
  if (!raw) return { agents: BUILTIN_AGENTS, persisted: false };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("invalid agents config");
    const builtIns = new Map(BUILTIN_AGENTS.map((agent) => [agent.id, agent]));
    const agents = parsed
      .map((item) => {
        const fallback = builtIns.get(String(item?.id ?? ""));
        return sanitize(item, Boolean(fallback), fallback);
      })
      .filter((item): item is AgentConfig => item !== null);
    return { agents, persisted: true };
  } catch {
    return { agents: BUILTIN_AGENTS, persisted: false };
  }
}

export function saveAgentConfigs(input: unknown): AgentConfig[] {
  if (!Array.isArray(input)) throw new Error("agents must be an array");
  const builtIns = new Map(BUILTIN_AGENTS.map((agent) => [agent.id, agent]));
  const agents = input
    .slice(0, 64)
    .map((item) => {
      const fallback = builtIns.get(String(item?.id ?? ""));
      return sanitize(item, Boolean(fallback), fallback);
    })
    .filter((item): item is AgentConfig => item !== null);
  setAgentsRaw(JSON.stringify(agents));
  return agents;
}

export function findAgentConfig(id: string): AgentConfig | undefined {
  return listAgentConfigs().agents.find((agent) => agent.id === id);
}
