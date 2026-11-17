// Regression tests for the route gate that used to deadlock a substantive
// task after the first turn: a quoted error was read as a write request, an
// open contract was not carried into the next turn, and a duplicate open threw
// instead of returning the contract, so write tools stayed blocked in
// investigate. Each test pins one edge of that chain.

import test from "node:test";
import assert from "node:assert/strict";
import { applyToolEvent, beginTurn } from "../src/agents/runtime.ts";
import { classifyTask, noteContract, startRun, walk } from "../src/agents/route.ts";
import { isSyntheticText, readSyntheticHashes, rememberSynthetic } from "../src/agents/turn.ts";

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: any) => {
      values.set(key, value);
    },
  };
}

test("a pasted error message is not a write request", () => {
  const pasted =
    'tool "write" is not allowed for zombiecoder during investigate. Allowed next route phase(s): propose. আমাদের এই টুলে কোনো সমস্যা আছে কিনা এটা চেক করে দেখ';
  assert.equal(classifyTask(pasted), "readonly");
});

test("a real write instruction still classifies as substantive", () => {
  assert.equal(classifyTask("adapter-এ ৪টি patch apply করে ঠিক করো"), "substantive");
  assert.equal(classifyTask('implement "symbolOverview" in the adapter'), "substantive");
  assert.equal(
    classifyTask(
      "append_syllabus টুলটিকে লাইভ সিস্টেমে কানেক্ট কর; নতুন কোড reinstall কর; intent classifier আপডেট কর",
    ),
    "substantive",
    "Bengali imperative + English reinstall is a change request",
  );
  assert.equal(classifyTask("তিনটি কাজ একসাথে শুরু কর"), "substantive");
  assert.equal(classifyTask("plugin-টা wire করে দেও"), "substantive");
});

test("quoted diagnostics stay read-only in every quote style", () => {
  assert.equal(classifyTask("`write` tool is not allowed during investigate — কী করব?"), "readonly");
  assert.equal(classifyTask("error: 'delete' was rejected by the gate; explain why"), "readonly");
  assert.equal(
    classifyTask("```\nedit src/app.ts\nwrite src/x.ts\n```\nএই লগটা বিশ্লেষণ কর"),
    "readonly",
  );
});

test("an open contract is carried into a new user turn", () => {
  const contract = {
    id: "gc-carry",
    status: "open" as const,
    at: new Date().toISOString(),
    check: "true",
    expected: "CARRY_OK",
  };
  const started = startRun({
    sessionID: "s1",
    agentID: "zombiecoder",
    message: "symbol tools implement",
    kind: "substantive",
  });
  const investigated = walk(started, ["footprint", "investigate"]);
  const opened = noteContract(investigated, contract);
  assert.equal(opened.phase, "work");

  const next = beginTurn({
    sessionID: "s1",
    agentID: "zombiecoder",
    message: "adapter-এ ৪টি patch apply করে ঠিক করো",
    previous: opened,
    freshSyllabus: false,
    turnIndex: 2,
    openContract: contract,
  });

  assert.equal(next.continued, false);
  assert.equal(next.run.phase, "work");
  assert.equal(next.run.contract?.id, "gc-carry");
});

test("an open result from a duplicate open moves the route to work", () => {
  const started = startRun({
    sessionID: "s1",
    agentID: "zombiecoder",
    message: "adapter-এ ৪টি patch apply করে ঠিক করো",
    kind: "substantive",
  });
  const investigated = walk(started, ["footprint", "investigate"]);
  const next = applyToolEvent(investigated, {
    tool: "goal_contract",
    event: {
      status: "completed",
      result: {
        output: { id: "gc-dup", status: "open", check: "true", expected: "DUP_OK" },
      },
    },
  });

  assert.equal(next?.phase, "work");
  assert.equal(next?.contract?.id, "gc-dup");
});

test("a breaker card is recorded as synthetic user text", async () => {
  const storage = memoryStorage();
  const text = "**Circuit breaker:** zombiecoder এই attempt-এ আটকে গেছে";
  await rememberSynthetic(storage, "s1", text);
  const hashes = await readSyntheticHashes(storage, "s1");
  assert.equal(isSyntheticText(text, hashes), true);
});
