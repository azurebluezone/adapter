import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_CONTROLLERS } from "../src/agents/index.ts";
import { SHARED_RULES } from "../src/agents/shared.ts";
import { auditPromptBudget } from "../src/zombie/promptBudget.ts";

test("every persona prompt stays inside the budget with one shared-rules block", () => {
  const prompts = Object.fromEntries(AGENT_CONTROLLERS.map((agent) => [agent.id, agent.prompt()]));
  const report = auditPromptBudget(prompts, SHARED_RULES, 32000);
  assert.deepEqual(report.issues, []);
  assert.equal(report.ok, true);
  assert.ok(report.maxBytes <= 32000, `largest prompt is ${report.maxBytes} bytes`);
  assert.equal(report.agents.length, 10);
  for (const [agent, copies] of Object.entries(report.sharedCopies)) {
    assert.equal(copies, 1, `${agent} carries the shared rules ${copies} times`);
  }
});
