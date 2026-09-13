import assert from "node:assert/strict";
import test from "node:test";
import { requestGroupDecision, requestGroupDecisionWithFailover } from "./agentGroupDecision";
import { groupControllerSessionId } from "./agentGroupChat";
import type { AgentConversation } from "./state/store";

const group = { name: "讨论", members: ["a", "b"].map((id): AgentConversation => ({
  id, kind: "leaf", title: id === "a" ? "张三" : "李四", createdAt: 1, updatedAt: 1,
})) };
const context = { messages: [{ id: "u", role: "user" as const, content: "让李四私发我词", createdAt: 1 }],
  privateDeliveries: [], completedTurns: [] };
const base = { group, context, endpoint: "/api/agent/chat", signal: new AbortController().signal,
  target: { paneId: groupControllerSessionId("g"), model: "provider/model" } };
const events = (text: string) => `${JSON.stringify({ type: "delta", text })}\n${JSON.stringify({ type: "done" })}`;
const stream = (raw: string) => new Response(new ReadableStream({ start(controller) {
  const bytes = new TextEncoder().encode(raw);
  for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
  controller.close();
} }));

test("BYOK dispatch reads fragmented NDJSON and uses only the returned model decision", async () => {
  const phases: string[] = [];
  const result = await requestGroupDecision({ ...base, onPhase: (phase) => phases.push(phase),
    fetcher: async (url, init) => {
      assert.equal(url, "/api/agent/chat");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "provider/model");
      assert.equal(body.botIdentity, undefined);
      const input = JSON.parse(body.messages[0].content.split("\n").at(-1));
      assert.equal(input.messages[0].content, "让李四私发我词");
      return stream(events('{"mode":"parallel","memberIds":["a","b"],"triggerMessageIds":["u"]}'));
    },
  });
  assert.deepEqual(result, { mode: "parallel", memberIds: ["a", "b"], triggerMessageIds: ["u"] });
  assert.deepEqual(phases, ["processing"]);
});

test("ACP dispatch uses its own session and configured model, without a member persona", async () => {
  const phases: string[] = [];
  const result = await requestGroupDecision({ ...base, endpoint: "/api/agent/acp/chat",
    target: { paneId: groupControllerSessionId("g"), agentId: "runtime", config: { model: "chosen-model" } },
    onPhase: (phase) => phases.push(phase), fetcher: async (_, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.paneId, groupControllerSessionId("g"));
      assert.equal(body.agentId, "runtime");
      assert.equal(body.config.model, "chosen-model");
      assert.equal(body.applySavedConfig, true);
      assert.equal(body.botIdentity, undefined);
      return stream(JSON.stringify({ type: "activity", phase: "processing" }) + "\n"
        + events('```json\n{"memberId":null,"triggerMessageIds":[]}\n```'));
    },
  });
  assert.equal(result.mode, "none");
  assert.deepEqual(phases, ["preparing", "processing"]);
});

test("a final replacement supersedes corrupted streamed dispatch text", async () => {
  const replacement = '{"memberId":"b","triggerMessageIds":["u"]}';
  const raw = `${JSON.stringify({ type: "delta", text: "���" })}\n${JSON.stringify({ type: "replace", text: replacement })}\n${JSON.stringify({ type: "done" })}`;
  const result = await requestGroupDecision({ ...base, fetcher: async () => stream(raw) });
  assert.deepEqual(result, { mode: "single", memberIds: ["b"], triggerMessageIds: ["u"] });
});

test("invalid output and incomplete streams fail without repairing names or guessing a recipient", async () => {
  for (const raw of [events("李四回复"), events('{"memberId":"missing","triggerMessageIds":["u"]}'),
    JSON.stringify({ type: "delta", text: '{"memberId":"b","triggerMessageIds":["u"]}' }),
    events('{"memberId":"b","triggerMessageIds":["missing"]}'), JSON.stringify({ type: "error", error: "Provider unavailable" })]) {
    await assert.rejects(requestGroupDecision({ ...base, fetcher: async () => stream(raw) }));
  }
});

test("permission requests cancel dispatch instead of hanging in an invisible session", async () => {
  let cancelled = false;
  await assert.rejects(requestGroupDecision({ ...base, fetcher: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"permission","requestId":"p"}\n')); },
    cancel() { cancelled = true; },
  })) }), /must not execute tools/);
  assert.equal(cancelled, true);
});

test("a cancelled dispatch cannot return an actionable model decision", async () => {
  const abort = new AbortController();
  await assert.rejects(requestGroupDecision({ ...base, signal: abort.signal, fetcher: async () => {
    abort.abort();
    return stream(events('{"memberId":"b","triggerMessageIds":["u"]}'));
  } }), { name: "AbortError" });
});

test("dispatch automatically promotes the first healthy backup coordinator", async () => {
  const calls: string[] = [];
  const result = await requestGroupDecisionWithFailover({ group, context, signal: new AbortController().signal,
    candidates: group.members.map((member) => ({ member, endpoint: `/coordinator/${member.id}`,
      target: { paneId: groupControllerSessionId("g"), model: `model-${member.id}` } })),
    fetcher: async (url, init) => {
      calls.push(String(url));
      const prompt = JSON.parse(String(JSON.parse(String(init?.body)).messages[0].content).split("\n").at(-1)!);
      assert.equal(prompt.leadMember.id, calls.length === 1 ? "a" : "b");
      if (String(url).endsWith("/a")) return new Response("provider unavailable", { status: 503 });
      return stream(events('{"mode":"single","memberIds":["b"],"triggerMessageIds":["u"]}'));
    },
  });
  assert.deepEqual(calls, ["/coordinator/a", "/coordinator/b"]);
  assert.equal(result.leader.id, "b");
  assert.deepEqual(result.failedMemberIds, ["a"]);
  assert.equal(result.decision.memberIds[0], "b");
});

test("a hung coordinator times out before the next candidate is tried", async () => {
  const calls: string[] = [];
  const result = await requestGroupDecisionWithFailover({ group, context, signal: new AbortController().signal,
    candidates: group.members.map((member) => ({ member, endpoint: `/coordinator/${member.id}`,
      target: { paneId: groupControllerSessionId("g"), model: `model-${member.id}` } })), timeoutMs: 5,
    fetcher: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/a")) return new Promise<Response>(() => {});
      return stream(events('{"mode":"single","memberIds":["b"],"triggerMessageIds":["u"]}'));
    },
  });
  assert.deepEqual(calls, ["/coordinator/a", "/coordinator/b"]);
  assert.equal(result.leader.id, "b");
  assert.deepEqual(result.failedMemberIds, ["a"]);
});

test("user cancellation stops coordinator failover", async () => {
  const abort = new AbortController();
  let calls = 0;
  await assert.rejects(requestGroupDecisionWithFailover({ group, context, signal: abort.signal,
    candidates: group.members.map((member) => ({ member, endpoint: `/coordinator/${member.id}`,
      target: { paneId: groupControllerSessionId("g"), model: `model-${member.id}` } })),
    fetcher: async () => {
      calls++;
      abort.abort();
      throw new DOMException("cancelled", "AbortError");
    },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});
