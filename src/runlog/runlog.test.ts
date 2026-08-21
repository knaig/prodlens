import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunLog, initRunLog, loadRunLog } from "./store.js";
import { deriveGraph, deriveEpisodes, deriveRunSummary, deriveFeedback } from "./derive.js";
import type { AnyRunEvent } from "./events.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "prodlens-runlog-"));
}

test("append assigns contiguous seq and rejects non-lossless-JSON data", () => {
  const log = new RunLog();
  const a = log.append("run/start", { runId: "r1", baseUrl: "http://app.test", mode: "explore" });
  const b = log.append("episode/start", { episodeId: "e1", goal: "g", entryPath: "/" });
  assert.equal(a.seq, 0);
  assert.equal(b.seq, 1);
  assert.equal(log.length, 2);
  const bad = { episodeId: "e1", step: 0, message: "x", code: "C", extra: undefined as unknown };
  // undefined object keys are normalized away (absent = no value), so this is allowed
  const normalized = log.append("error", bad);
  assert.equal("extra" in (normalized.data as Record<string, unknown>), false);
  const circular: Record<string, unknown> = { episodeId: "e2", step: 0, message: "x", code: "C" };
  circular.self = circular;
  assert.throws(() => log.append("error", circular as never));
  const undefinedInArray = { episodeId: "e3", step: 0, message: "x", code: "C", list: [undefined as unknown] };
  assert.throws(() => log.append("error", undefinedInArray as never));
});

test("append-only JSONL round-trips events with contiguous seq", () => {
  const dir = tempDir();
  const path = join(dir, "log.jsonl");
  initRunLog(path);
  const log = new RunLog({ path });
  log.append("run/start", { runId: "r1", baseUrl: "http://app.test", mode: "run" });
  log.append("tool/call", {
    episodeId: "e1",
    step: 1,
    callId: "c1",
    name: "navigate",
    arguments: { url: "/login" },
  });
  log.append("tool/result", { episodeId: "e1", step: 1, callId: "c1", name: "navigate", isError: false, value: "/login" });
  log.close();

  const loaded = loadRunLog(path);
  assert.equal(loaded.length, 3);
  assert.deepEqual(
    loaded.map((e) => e.seq),
    [0, 1, 2]
  );
  const toolCall = loaded[1];
  if (toolCall.type !== "tool/call") assert.fail("expected tool/call");
  assert.deepEqual(toolCall.data.arguments, { url: "/login" });
  rmSync(dir, { recursive: true, force: true });
});

test("flush writes only pending events and is idempotent", () => {
  const dir = tempDir();
  const path = join(dir, "log.jsonl");
  initRunLog(path);
  const log = new RunLog({ path });
  log.append("run/start", { runId: "r1", baseUrl: "http://app.test", mode: "run" });
  log.flush();
  log.append("run/end", { reason: "completed" });
  log.close();
  const lines = readFileSync(path, "utf-8").split("\n").filter((l) => l.length);
  assert.equal(lines.length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("deriveGraph folds state/observed + edge/observed into a Graph", () => {
  const events: AnyRunEvent[] = [
    { type: "run/start", seq: 0, time: 1, data: { runId: "r1", baseUrl: "http://app.test", mode: "explore" } },
    {
      type: "state/observed",
      seq: 1,
      time: 2,
      data: { episodeId: "e1", nodeId: "/", url: "http://app.test/", stateSignature: "/#sig" },
    },
    {
      type: "state/observed",
      seq: 2,
      time: 3,
      data: { episodeId: "e1", nodeId: "/login", url: "http://app.test/login", stateSignature: "/login#sig" },
    },
    {
      type: "edge/observed",
      seq: 3,
      time: 4,
      data: { episodeId: "e1", from: "/", to: "/login", action: "Click \"Login\"", status: "working" },
    },
  ];
  const graph = deriveGraph(events);
  assert.deepEqual(Object.keys(graph.nodes).sort(), ["/", "/login"]);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].from, "/");
  assert.equal(graph.edges[0].to, "/login");
  assert.deepEqual(graph.entryPoints, ["/"]);
});

test("deriveEpisodes and deriveRunSummary summarize tool calls and errors", () => {
  const events: AnyRunEvent[] = [
    { type: "run/start", seq: 0, time: 1, data: { runId: "r1", baseUrl: "http://app.test", mode: "run" } },
    { type: "episode/start", seq: 1, time: 2, data: { episodeId: "e1", goal: "Login", entryPath: "/login" } },
    { type: "step/start", seq: 2, time: 3, data: { episodeId: "e1", step: 0 } },
    { type: "tool/call", seq: 3, time: 4, data: { episodeId: "e1", step: 0, callId: "c1", name: "navigate", arguments: {} } },
    { type: "tool/call", seq: 4, time: 5, data: { episodeId: "e1", step: 0, callId: "c2", name: "click_label", arguments: {} } },
    { type: "fallback/used", seq: 5, time: 6, data: { episodeId: "e1", step: 0, reason: "no selector", resolvedBy: "agent" } },
    { type: "error", seq: 6, time: 7, data: { episodeId: "e1", step: 0, message: "boom", code: "E" } },
    { type: "episode/end", seq: 7, time: 8, data: { episodeId: "e1", status: "failed", error: "boom" } },
    { type: "run/end", seq: 8, time: 9, data: { reason: "completed" } },
  ];
  const summary = deriveRunSummary(events);
  assert.equal(summary.mode, "run");
  assert.equal(summary.reason, "completed");
  assert.equal(summary.episodes.length, 1);
  assert.equal(summary.episodes[0].status, "failed");
  assert.equal(summary.episodes[0].toolCalls, 2);
  assert.equal(summary.episodes[0].fallbacks, 1);
  assert.deepEqual(summary.episodes[0].errors, ["boom"]);
});

test("deriveFeedback emits per-episode TraceFeedback with score, errors, and guard denials", () => {
  const events: AnyRunEvent[] = [
    { type: "run/start", seq: 0, time: 1, data: { runId: "r1", baseUrl: "http://app.test", mode: "run" } },
    { type: "episode/start", seq: 1, time: 2, data: { episodeId: "e1", goal: "Login", entryPath: "/login" } },
    { type: "step/start", seq: 2, time: 3, data: { episodeId: "e1", step: 0 } },
    { type: "step/end", seq: 3, time: 4, data: { episodeId: "e1", step: 0, outcome: "working" } },
    { type: "step/start", seq: 4, time: 5, data: { episodeId: "e1", step: 1 } },
    { type: "step/end", seq: 5, time: 6, data: { episodeId: "e1", step: 1, outcome: "broken" } },
    { type: "fallback/used", seq: 6, time: 7, data: { episodeId: "e1", step: 1, reason: "no selector", resolvedBy: "agent" } },
    { type: "error", seq: 7, time: 8, data: { episodeId: "e1", step: 1, message: "navigate blocked: leaves origin", code: "GUARD_DENIED" } },
    { type: "agent/decide", seq: 8, time: 9, data: { episodeId: "e1", step: 1, goal: "Login", candidates: ["a", "b"], chosen: "b", reason: "probably b", resolve: "agent" } },
    { type: "episode/end", seq: 9, time: 10, data: { episodeId: "e1", status: "failed", error: "navigate blocked: leaves origin" } },
    { type: "episode/start", seq: 10, time: 11, data: { episodeId: "e2", goal: "Logout", entryPath: "/" } },
    { type: "step/start", seq: 11, time: 12, data: { episodeId: "e2", step: 0 } },
    { type: "step/end", seq: 12, time: 13, data: { episodeId: "e2", step: 0, outcome: "working" } },
    { type: "episode/end", seq: 13, time: 14, data: { episodeId: "e2", status: "passed" } },
  ];
  const feedback = deriveFeedback(events);
  assert.equal(feedback.length, 2);
  const failing = feedback.find((f) => f.traceSummary.includes("1/2"))!;
  assert.equal(failing.runId, "r1");
  assert.equal(failing.score, 0.5);
  assert.match(failing.feedback, /GUARD_DENIED|navigate blocked/);
  assert.ok(failing.traceSummary.includes("guard") || failing.traceSummary.includes("denied"));
  assert.ok(failing.examples!.some((ex) => ex.type === "agent/decide"));
  assert.ok(failing.examples!.some((ex) => ex.code === "GUARD_DENIED"));
  const passing = feedback.find((f) => f.score === 1)!;
  assert.match(passing.feedback, /e2 passed all steps/);
  assert.deepEqual(passing.examples, []);
});

test("loadRunLog rejects non-contiguous seq", () => {
  const dir = tempDir();
  const path = join(dir, "log.jsonl");
  writeFileSync(
    path,
    `${JSON.stringify({ type: "run/start", seq: 0, time: 1, data: { runId: "r", baseUrl: "http://a", mode: "run" } })}\n` +
      `${JSON.stringify({ type: "run/end", seq: 2, time: 2, data: { reason: "completed" } })}\n`
  );
  assert.throws(() => loadRunLog(path));
  rmSync(dir, { recursive: true, force: true });
});
