// The controller layer is model-agnostic and parameterized: agent / task-kind /
// phase. These tests prove the fixed edges, the contract gate and the bypass
// attempts, without needing a live model or the OpenCode host.

import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_CONTROLLERS,
  AGENT_PROFILES,
  getAgentController,
} from "../src/agents/index.ts";
import { manu } from "../src/agents/manu.ts";
import { halim } from "../src/agents/halim.ts";
import { ROSTER, agentSystemPrompt } from "../src/roster.ts";
import { classifyTask, isConsent } from "../src/agents/route.ts";
import {
  applyToolEvent,
  beginTurn,
  contractFromEvent,
} from "../src/agents/runtime.ts";

test("nine controllers own the roster in the same order", () => {
  assert.equal(AGENT_CONTROLLERS.length, 9);
  assert.equal(AGENT_PROFILES.length, 9);
  const ids = AGENT_CONTROLLERS.map((controller) => controller.id);
  assert.deepEqual(ids, ROSTER.map((agent) => agent.id));
  assert.deepEqual(ids, [
    "manu",
    "jarin",
    "brishti",
    "rashed",
    "halim",
    "majnu",
    "nila",
    "tuhin",
    "zombiecoder",
  ]);
});

test("a model is transport, never profile identity", () => {
  for (const controller of AGENT_CONTROLLERS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(controller.profile, "model"),
      false,
      `${controller.id}: AgentProfile must not carry a model`,
    );
    assert.equal(controller.prompt(), agentSystemPrompt(ROSTER.find((a) => a.id === controller.id)!));
    assert.doesNotMatch(controller.prompt(), /opencode\/|big-pickle|provider\//i);
    const free = controller.runnerLine("opencode/free-small");
    const large = controller.runnerLine("anthropic/claude-large");
    assert.notEqual(free, large);
    assert.match(free, /transport only/);
    assert.equal(controller.prompt(), controller.prompt(), "prompt must not vary with a runner");
  }
});

test("each agent owns its tools and footprint policy", () => {
  for (const controller of AGENT_CONTROLLERS) {
    assert.ok(controller.profile.tools.phases.investigate.length > 0);
    assert.ok(controller.profile.tools.phases.verify.length > 0);
    assert.ok(controller.profile.footprint.required.includes("ssot"));
    assert.ok(controller.profile.footprint.required.includes("syllabus"));
    assert.equal(controller.profile.footprint.owner, "halim");
    assert.ok(controller.allows("read", "investigate"));
    assert.equal(controller.allows("edit", "investigate"), false, "write before work must be denied");
    assert.equal(controller.allows("edit", "propose"), false);
    assert.equal(controller.allows("edit", "work"), true);
    assert.equal(controller.allows("task", "work"), false, "delegation is denied in every phase");
  }
  assert.equal(manu.allows("edit", "investigate"), false);
  assert.equal(manu.allows("edit", "work"), true);
});

test("the route is parameterized and illegal edges are impossible", () => {
  const run = manu.start({
    sessionID: "ses_route",
    message: "Implement src/agents with a contract",
    now: new Date("2026-11-05T00:00:00Z"),
  });
  assert.equal(run.routeKey, "zc/manu/substantive/intake");
  assert.equal(run.taskKind, "substantive");
  assert.throws(() => manu.advance(run, "respond"), /illegal route step/);
  assert.throws(() => manu.advance(run, "work"), /illegal route step/);

  const proposed = manu.walk(run, ["footprint", "investigate", "propose"]);
  assert.equal(proposed.routeKey, "zc/manu/substantive/propose");
  assert.throws(() => manu.advance(proposed, "respond"), /illegal route step/);

  const working = manu.noteContract(proposed, {
    id: "gc_route",
    status: "open",
    at: proposed.updatedAt,
  });
  assert.equal(working.phase, "work");
  assert.equal(manu.release(working).ok, false, "open contract must not release an answer");

  const passed = manu.noteContract(working, {
    id: "gc_route",
    status: "PASS",
    at: working.updatedAt,
  });
  assert.equal(passed.phase, "respond");
  assert.equal(manu.release(passed).ok, true);

  const frozen = manu.start({ sessionID: "ses_route", message: "fix the bug" });
  assert.throws(() => {
    (frozen as any).phase = "respond";
  }, /read only|Cannot assign/);
});

test("a FAIL returns the run to work and never releases", () => {
  let run = manu.walk(
    manu.start({ sessionID: "ses_fail", message: "fix login" }),
    ["footprint", "investigate", "propose"],
  );
  run = manu.noteContract(run, { id: "gc_fail", status: "open", at: run.updatedAt });
  run = manu.noteContract(run, { id: "gc_fail", status: "FAIL", at: run.updatedAt });
  assert.equal(run.phase, "work");
  assert.equal(manu.release(run).ok, false);
  assert.match(manu.release(run).reason, /FAIL|contract/);
});

test("read-only and trivial turns do not require a contract", () => {
  assert.equal(classifyTask("what does src/plugin.ts do?"), "readonly");
  assert.equal(classifyTask("চেক করো src/roster.ts"), "readonly");
  assert.equal(classifyTask("Implement src/agents"), "substantive");
  assert.equal(classifyTask("ঠিক করে দাও"), "substantive");
  assert.equal(classifyTask("হ্যালো"), "trivial");
  assert.equal(isConsent("হ্যাঁ"), true);
  assert.equal(isConsent("এটা নতুন কাজ"), false);

  const readonly = beginTurn({
    sessionID: "ses_read",
    agentID: "manu",
    message: "check src/plugin.ts",
  });
  assert.equal(readonly.run.taskKind, "readonly");
  assert.equal(readonly.run.phase, "investigate");
  const answered = manu.noteAnswer(readonly.run, false);
  assert.equal(answered.phase, "propose");
  assert.equal(manu.release(answered).ok, true);

  const trivial = beginTurn({ sessionID: "ses_hi", agentID: "manu", message: "হ্যালো" });
  assert.equal(trivial.run.taskKind, "trivial");
  assert.equal(manu.release(trivial.run).ok, true);

  const freshRead = beginTurn({
    sessionID: "ses_read_fresh",
    agentID: "manu",
    message: "check src/plugin.ts",
    freshSyllabus: true,
  });
  assert.equal(freshRead.run.phase, "footprint", "a fresh syllabus blocks even read-only work");
});

test("a consent continues the pending proposal into the contract phase", () => {
  const first = beginTurn({
    sessionID: "ses_consent",
    agentID: "manu",
    message: "Implement the agents folder",
  });
  const proposed = manu.advance(first.run, "propose");
  const consent = beginTurn({
    sessionID: "ses_consent",
    agentID: "manu",
    message: "হ্যাঁ",
    previous: proposed,
  });
  assert.equal(consent.consent, true);
  assert.equal(consent.continued, true);
  assert.equal(consent.run.phase, "contract");
  assert.equal(consent.run.taskKind, "substantive");
  assert.equal(manu.release(consent.run).ok, false);
});

test("a fresh syllabus waits for Halim's onboarding footprint", () => {
  const first = beginTurn({
    sessionID: "ses_fresh",
    agentID: "manu",
    message: "Implement the agents folder",
    freshSyllabus: true,
  });
  assert.equal(first.run.phase, "footprint");
  assert.equal(manu.release(first.run).ok, false);
  assert.match(manu.release(first.run).reason, /footprint|contract/);

  const onboarded = applyToolEvent(first.run, {
    tool: "project_onboarding",
    event: { status: "ok", result: { output: { created: true } } },
  });
  assert.equal(onboarded?.phase, "investigate");
  assert.equal(halim.profile.footprint.required.includes("onboarding"), true);
});

test("contract tool results are parsed from the real hook shapes", () => {
  const open = contractFromEvent({ result: { output: { id: "gc_1", status: "open" } } });
  assert.equal(open?.status, "open");
  const pass = contractFromEvent({
    output: { id: "gc_1", status: "PASS", check: "node ok.mjs", exitCode: 0 },
  });
  assert.equal(pass?.status, "PASS");
  assert.equal(pass?.exitCode, 0);
  const fail = contractFromEvent({ result: JSON.stringify({ id: "gc_1", status: "FAIL" }) });
  assert.equal(fail?.status, "FAIL");
  assert.equal(contractFromEvent({ result: { status: "rejected" } }), null);
});

test("unknown agents have no route controller", () => {
  assert.equal(getAgentController("build"), undefined);
  assert.throws(
    () =>
      beginTurn({
        sessionID: "ses_builtin",
        agentID: "build",
        message: "fix this",
      }),
    /no controller/,
  );
});
