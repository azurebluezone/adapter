// Regressions for two delivery defects found in the Desktop/1 run:
// 1. The registered read-only symbol/LSP tools were absent from every phase
//    allowlist, so a specialist could never call diagnostics_for_file.
// 2. A new turn whose text looked read-only dropped an open contract and
//    stranded write tools in investigate.
import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_CONTROLLERS } from "../src/agents/index.ts";
import { beginTurn } from "../src/agents/runtime.ts";
import { noteOnboarding } from "../src/agents/route.ts";

const READ_ONLY_LSP = [
  "symbol_overview",
  "find_symbols",
  "find_references",
  "diagnostics_for_file",
] as const;

const OPEN_CONTRACT = {
  id: "gc_regression",
  status: "open" as const,
  check: "node check.mjs",
  expected: "OK",
  at: "2026-01-01T00:00:00.000Z",
};

function controller(id: string) {
  const found = AGENT_CONTROLLERS.find((candidate) => candidate.id === id);
  assert.ok(found, `missing controller ${id}`);
  return found;
}

test("every roster agent can call the read-only symbol and LSP tools while investigating", () => {
  for (const agent of AGENT_CONTROLLERS) {
    for (const tool of READ_ONLY_LSP) {
      assert.equal(
        agent.allows(tool, "investigate"),
        true,
        `${agent.id}: ${tool} must be reachable in investigate`,
      );
    }
  }
});

test("the symbol and LSP tools stay out of the answer-only phase", () => {
  for (const agent of AGENT_CONTROLLERS) {
    for (const tool of READ_ONLY_LSP) {
      assert.equal(
        agent.allows(tool, "respond"),
        false,
        `${agent.id}: ${tool} must not leak into respond`,
      );
    }
  }
});

test("a read-only-shaped message keeps an open contract in substantive work", () => {
  const turn = beginTurn({
    sessionID: "ses_contract_carry",
    agentID: "zombiecoder",
    message: "Continue kor.",
    openContract: OPEN_CONTRACT,
  });
  assert.equal(turn.run.taskKind, "substantive");
  assert.equal(turn.run.phase, "work");
  assert.equal(turn.run.contract?.id, "gc_regression");
  assert.equal(controller("zombiecoder").allows("edit", turn.run.phase), true);
});

test("without an open contract the same message stays read-only", () => {
  const turn = beginTurn({
    sessionID: "ses_no_contract",
    agentID: "zombiecoder",
    message: "Continue kor.",
  });
  assert.equal(turn.run.taskKind, "readonly");
  assert.equal(turn.run.phase, "investigate");
  assert.equal(turn.run.contract, null);
  assert.equal(controller("zombiecoder").allows("edit", turn.run.phase), false);
});

test("onboarding with an attached open contract lands in work", () => {
  const turn = beginTurn({
    sessionID: "ses_onboarding_contract",
    agentID: "zombiecoder",
    message: "Implement the installer fallback.",
    freshSyllabus: true,
    openContract: OPEN_CONTRACT,
  });
  assert.equal(turn.run.phase, "footprint");
  const onboarded = noteOnboarding(turn.run, true);
  assert.equal(onboarded.phase, "work");
  assert.equal(onboarded.contract?.id, "gc_regression");
  assert.equal(controller("zombiecoder").allows("edit", onboarded.phase), true);
});
