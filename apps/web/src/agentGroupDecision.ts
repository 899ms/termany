import { groupDecisionPrompt, validateGroupDecision, type AgentGroup, type GroupDecision, type GroupDecisionContext } from "./agentGroupChat";
import type { AgentConversation } from "./state/store";

export interface GroupDecisionTarget {
  paneId: string;
  agentId?: string;
  model?: string;
  cwd?: string;
  cwdFrom?: string;
  config?: Record<string, string>;
  images?: { path: string; mimeType: string }[];
}

export interface GroupDecisionCandidate {
  member: AgentConversation;
  endpoint: string;
  target: GroupDecisionTarget;
}

export interface GroupDecisionFailoverResult {
  decision: GroupDecision;
  leader: AgentConversation;
  failedMemberIds: string[];
}

export const GROUP_DECISION_TIMEOUT_MS = 45_000;

/** Reuse the lead member's ACP/BYOK configuration in an isolated coordination
 * session, without exposing its structured dispatch output as chat messages. */
export async function requestGroupDecision({ group, context, coordinator, target, signal, endpoint, onPhase, fetcher = fetch }: {
  group: AgentGroup;
  context: GroupDecisionContext;
  coordinator?: AgentConversation;
  target: GroupDecisionTarget;
  signal: AbortSignal;
  endpoint: string;
  onPhase?: (phase: "preparing" | "processing") => void;
  fetcher?: typeof fetch;
}) {
  const prompt = groupDecisionPrompt(group, context, coordinator);
  const response = await fetcher(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify(target.agentId
      ? { ...target, prompt, applySavedConfig: true }
      : { model: target.model, messages: [{ role: "user", content: prompt, images: target.images }] }),
  });
  if (!response.ok || !response.body) throw new Error((await response.text()) || `HTTP ${response.status}`);
  onPhase?.(target.agentId ? "preparing" : "processing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completed = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "delta" && typeof event.text === "string") text += event.text;
    if (event.type === "replace" && typeof event.text === "string") text = event.text;
    if (event.type === "done") completed = true;
    if ((event.type === "activity" && event.phase === "processing") || event.type === "thought") onPhase?.("processing");
    if (event.type === "error") throw new Error(event.error || "Group dispatch failed");
    if (event.type === "permission" || event.type === "tool") throw new Error("Group dispatch must not execute tools");
    if (text.length > 16_000) throw new Error("Group dispatch output exceeds the response limit");
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(buffer);
    signal.throwIfAborted();
    if (!completed) throw new Error("Group dispatch stream ended before completion");
    // Some runtimes wrap structured output in a Markdown fence. This unwraps
    // formatting only; it never extracts a name or repairs a model decision.
    const json = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/iu, "$1");
    return validateGroupDecision(JSON.parse(json), group, context);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Try each configured member as the coordination runtime. A timed-out or
 * malformed controller is isolated to that candidate; user cancellation still
 * stops the whole operation immediately. */
export async function requestGroupDecisionWithFailover({ group, context, candidates, signal, onPhase,
  fetcher = fetch, timeoutMs = GROUP_DECISION_TIMEOUT_MS }: {
  group: AgentGroup;
  context: GroupDecisionContext;
  candidates: GroupDecisionCandidate[];
  signal: AbortSignal;
  onPhase?: (phase: "preparing" | "processing") => void;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<GroupDecisionFailoverResult> {
  const failedMemberIds: string[] = [];
  const errors: unknown[] = [];
  const unique = candidates.filter((candidate, index) =>
    candidates.findIndex((item) => item.member.id === candidate.member.id) === index);
  for (const candidate of unique) {
    signal.throwIfAborted();
    const attempt = new AbortController();
    const forwardAbort = () => attempt.abort(signal.reason);
    signal.addEventListener("abort", forwardAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new DOMException(`Group coordinator ${candidate.member.title} timed out`, "TimeoutError");
        attempt.abort(error);
        reject(error);
      }, Math.max(1, timeoutMs));
    });
    try {
      const decision = await Promise.race([
        requestGroupDecision({ group, context, coordinator: candidate.member, target: candidate.target,
          signal: attempt.signal, endpoint: candidate.endpoint, onPhase, fetcher }),
        timeout,
      ]);
      return { decision, leader: candidate.member, failedMemberIds };
    } catch (error) {
      signal.throwIfAborted();
      failedMemberIds.push(candidate.member.id);
      errors.push(error);
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", forwardAbort);
    }
  }
  throw new AggregateError(errors, "No group coordinator is available");
}
