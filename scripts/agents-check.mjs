// Real check for the per-agent controller layer. Run:
//   node --experimental-strip-types scripts/agents-check.mjs
//
// The goal contract's expected output is the final ZC_AGENTS_OK line. A failure
// exits non-zero and prints the exact assertion that failed.

import assert from "node:assert/strict";
import { AGENT_CONTROLLERS, AGENT_PROFILES, getAgentController } from "../src/agents/index.ts";
import { manu } from "../src/agents/manu.ts";
import { halim } from "../src/agents/halim.ts";
import { ROSTER, agentSystemPrompt } from "../src/roster.ts";
import { classifyTask } from "../src/agents/route.ts";
import { applyToolEvent, beginTurn, contractFromEvent } from "../src/agents/runtime.ts";

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

check("nine controllers in roster order", () => {
  assert.equal(AGENT_CONTROLLERS.length, 9);
  assert.deepEqual(
    AGENT_CONTROLLERS.map((controller) => controller.id),
    ["manu", "jarin", "brishti", "rashed", "halim", "majnu", "nila", "tuhin", "zombiecoder"],
  );
  assert.deepEqual(AGENT_CONTROLLERS.map((controller) => controller.id), ROSTER.map((a) => a.id));
});

check("profiles and prompts are model-agnostic", () => {
  for (const controller of AGENT_CONTROLLERS) {
    assert.equal(Object.prototype.hasOwnProperty.call(controller.profile, "model"), false);
    assert.equal(controller.prompt(), agentSystemPrompt(ROSTER.find((a) => a.id === controller.id)));
    assert.doesNotMatch(controller.prompt(), /opencode\/|big-pickle/);
    assert.notEqual(
      controller.runnerLine("opencode/free-small"),
      controller.runnerLine("anthropic/claude-large"),
    );
  }
});

check("tool policy blocks writes before work", () => {
  for (const controller of AGENT_CONTROLLERS) {
    for (const phase of ["intake", "footprint", "investigate", "propose", "contract", "verify", "respond"]) {
      assert.equal(controller.allows("edit", phase), false, `${controller.id}: edit in ${phase}`);
      assert.equal(controller.allows("write", phase), false, `${controller.id}: write in ${phase}`);
    }
    assert.equal(controller.allows("edit", "work"), true, `${controller.id}: edit in work`);
    assert.equal(controller.allows("task", "work"), false, `${controller.id}: delegation denied`);
    assert.equal(controller.profile.footprint.owner, "halim");
  }
});

check("route key is agent/task/phase and illegal edges throw", () => {
  const run = manu.start({ sessionID: "check", message: "Implement src/agents" });
  assert.equal(run.routeKey, "zc/manu/substantive/intake");
  assert.throws(() => manu.advance(run, "respond"), /illegal route step/);
  assert.throws(() => manu.advance(run, "verify"), /illegal route step/);
  const proposed = manu.walk(run, ["footprint", "investigate", "propose"]);
  assert.equal(proposed.routeKey, "zc/manu/substantive/propose");
  assert.equal(manu.release(proposed).ok, true, "proposal is allowed before consent");
  assert.throws(() => manu.advance(proposed, "respond"), /illegal route step/);
});

check("substantive release requires goal_contract PASS", () => {
  let run = manu.walk(manu.start({ sessionID: "check", message: "fix login" }), [
    "footprint",
    "investigate",
    "propose",
  ]);
  run = manu.noteContract(run, { id: "gc_check", status: "open", at: run.updatedAt });
  assert.equal(run.phase, "work");
  assert.equal(manu.release(run).ok, false);
  run = manu.noteContract(run, { id: "gc_check", status: "PASS", at: run.updatedAt });
  assert.equal(run.phase, "respond");
  assert.equal(manu.release(run).ok, true);
});

check("a FAIL never releases", () => {
  let run = manu.walk(manu.start({ sessionID: "check", message: "fix login" }), [
    "footprint",
    "investigate",
    "propose",
  ]);
  run = manu.noteContract(run, { id: "gc_fail", status: "open", at: run.updatedAt });
  run = manu.noteContract(run, { id: "gc_fail", status: "FAIL", at: run.updatedAt });
  assert.equal(run.phase, "work");
  assert.equal(manu.release(run).ok, false);
});

check("route state is frozen against direct phase writes", () => {
  const run = manu.start({ sessionID: "check", message: "fix login" });
  assert.throws(() => {
    run.phase = "respond";
  }, /read only|Cannot assign/);
});

check("fresh syllabus waits for onboarding, then advances", () => {
  const first = beginTurn({
    sessionID: "check",
    agentID: "manu",
    message: "Implement src/agents",
    freshSyllabus: true,
  });
  assert.equal(first.run.phase, "footprint");
  assert.equal(manu.release(first.run).ok, false);
  assert.equal(halim.profile.footprint.required.includes("onboarding"), true);
  const next = applyToolEvent(first.run, {
    tool: "project_onboarding",
    event: { status: "ok", result: { output: { created: true } } },
  });
  assert.equal(next.phase, "investigate");
});

check("consent continues the proposal into contract", () => {
  const first = beginTurn({ sessionID: "check", agentID: "manu", message: "Implement src/agents" });
  const proposed = manu.advance(first.run, "propose");
  const consent = beginTurn({
    sessionID: "check",
    agentID: "manu",
    message: "হ্যাঁ",
    previous: proposed,
  });
  assert.equal(consent.consent, true);
  assert.equal(consent.run.phase, "contract");
});

check("a fresh syllabus blocks read-only work too", () => {
  const run = beginTurn({
    sessionID: "check",
    agentID: "manu",
    message: "check src/plugin.ts",
    freshSyllabus: true,
  });
  assert.equal(run.run.phase, "footprint");
  assert.equal(manu.release(run.run).ok, false);
});

check("classification keeps read-only and trivial turns contract-free", () => {
  assert.equal(classifyTask("what does src/plugin.ts do?"), "readonly");
  assert.equal(classifyTask("চেক করো src/roster.ts"), "readonly");
  assert.equal(classifyTask("Implement src/agents"), "substantive");
  assert.equal(classifyTask("হ্যালো"), "trivial");
});

check("goal_contract hook shapes parse", () => {
  assert.equal(contractFromEvent({ result: { output: { id: "gc", status: "open" } } })?.status, "open");
  assert.equal(contractFromEvent({ result: { output: { id: "gc", status: "PASS" } } })?.status, "PASS");
  assert.equal(contractFromEvent({ output: { id: "gc", status: "FAIL" } })?.status, "FAIL");
  assert.equal(contractFromEvent({ result: { status: "rejected" } }), null);
});

check("unknown runner has no controller", () => {
  assert.equal(getAgentController("build"), undefined);
});

if (failures.length > 0) {
  console.error(`\nZC_AGENTS_FAIL ${failures.length} check(s) failed`);
  process.exit(1);
}

console.log(`\nZC_AGENTS_OK agents=9 model=agnostic route=manu`);
