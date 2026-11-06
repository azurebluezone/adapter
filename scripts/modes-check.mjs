// Real check for the V2 frontmatter lock and the 9x3 agent-mode matrix.
// Run:
//   node --experimental-strip-types scripts/modes-check.mjs
//
// The goal contract expects the final ZC_MODES_OK line. Any failed assertion
// exits non-zero with the exact check name.

import assert from "node:assert/strict";
import {
  AGENT_CONTROLLERS,
  modeMatrix,
  resolveAgentController,
  subagentGuard,
} from "../src/agents/index.ts";
import { ROSTER, agentConfigEntry, agentMarkdown } from "../src/roster.ts";
import { AGENT_MODES, planModeSwitch } from "../src/zombie/modes.ts";

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
}

check("nine controllers and three documented modes", () => {
  assert.equal(AGENT_CONTROLLERS.length, 9);
  assert.deepEqual([...AGENT_MODES], ["primary", "subagent", "all"]);
});

check("V2 frontmatter uses permissions/subagent and never permission/task", () => {
  for (const agent of ROSTER) {
    const markdown = agentMarkdown(agent);
    assert.match(markdown, /^permissions:$/m, `${agent.id}: permissions key missing`);
    assert.doesNotMatch(markdown, /^permission:/m, `${agent.id}: V1 permission key present`);
    assert.match(markdown, /^\s+- action: subagent$/m, `${agent.id}: subagent action missing`);
    assert.doesNotMatch(markdown, /action:\s*task/, `${agent.id}: V1 task action present`);
    const entry = agentConfigEntry(agent);
    assert.ok(Array.isArray(entry.permissions), `${agent.id}: config permissions array missing`);
    assert.equal(Object.prototype.hasOwnProperty.call(entry, "permission"), false, `${agent.id}: V1 config permission key`);
  }
});

check("mode matrix has 9 agents x 3 modes and effective current mode", () => {
  const matrix = modeMatrix({ manu: "subagent", nila: "primary" });
  assert.equal(matrix.length, 9);
  for (const row of matrix) {
    assert.deepEqual(Object.keys(row.cells).sort(), ["all", "primary", "subagent"]);
    assert.equal(row.cells.primary.asPrimary, true);
    assert.equal(row.cells.primary.asSubagent, false);
    assert.equal(row.cells.subagent.asPrimary, false);
    assert.equal(row.cells.subagent.asSubagent, true);
    assert.equal(row.cells.all.asPrimary, true);
    assert.equal(row.cells.all.asSubagent, true);
  }
  assert.equal(matrix.find((row) => row.agent === "manu")?.current, "subagent");
  assert.equal(matrix.find((row) => row.agent === "nila")?.current, "primary");
  assert.equal(matrix.find((row) => row.agent === "jarin")?.current, "all");
});

check("config overrides resolve without mutating the default controller", () => {
  const base = resolveAgentController("manu");
  assert.equal(base?.profile.mode, "all");
  const switched = resolveAgentController("manu", { manu: "subagent" });
  assert.equal(switched?.profile.mode, "subagent");
  assert.equal(base?.profile.mode, "all");
  assert.equal(resolveAgentController("manu", { manu: "wizard" })?.profile.mode, "all");
  assert.equal(resolveAgentController("nope"), undefined);
});

check("every agent x mode returns the exact config patch", () => {
  for (const agent of ROSTER) {
    for (const next of AGENT_MODES) {
      const plan = planModeSwitch({ agent: { id: agent.id, mode: agent.mode }, next });
      assert.equal(plan.ok, true, `${agent.id}->${next}: refused`);
      assert.equal(plan.patch.agentModes[agent.id], next, `${agent.id}->${next}: config patch`);
      assert.equal(plan.patch.frontmatter, `mode: ${next}`, `${agent.id}->${next}: frontmatter`);
      assert.equal(plan.requiresReload, plan.changed, `${agent.id}->${next}: reload flag`);
    }
  }
});

check("primary targets are blocked from subagent launch", () => {
  assert.equal(subagentGuard("manu").allowed, true);
  const blocked = subagentGuard("manu", { manu: "primary" });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason ?? "", /primary/);
  assert.equal(subagentGuard("manu", { manu: "subagent" }).allowed, true);
  assert.equal(subagentGuard("nope").allowed, false);
});

if (failures.length > 0) {
  console.error(`\nZC_MODES_FAIL ${failures.length} check(s) failed`);
  process.exit(1);
}

console.log("\nZC_MODES_OK frontmatter=v2 matrix=9x3 guard=subagent reload=honest");
