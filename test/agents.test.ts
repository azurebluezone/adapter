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
    assert.match(controller.prompt(), /Tool access \(enforced by plugin\)/, `${controller.id} is missing its tool policy`);
    assert.match(
      controller.prompt(),
      new RegExp(`<!-- zombiecoder-agent-profile:${controller.id}:[a-f0-9]{16} -->`),
      `${controller.id} is missing its current persona marker`,
    );
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
    assert.ok(controller.allows("goal_contract", "investigate"), `${controller.id} must be able to register its goal`);
    assert.ok(controller.allows("read", "investigate"));
    assert.equal(controller.allows("read", "footprint"), true);
    assert.equal(controller.allows("grep", "footprint"), true);
    assert.equal(controller.allows("glob", "footprint"), true);
    assert.equal(controller.allows("shell", "investigate"), true, "read-only shell probes are part of investigation");
    assert.equal(controller.allows("execute", "investigate"), true, "execute is the host alias for shell");
    assert.equal(controller.allows("edit", "investigate"), false, "write before work must be denied");
    assert.equal(controller.allows("edit", "propose"), false);
    assert.equal(controller.allows("edit", "work"), true);
    assert.equal(controller.allows("task", "work"), false, "delegation is denied in every phase");
    assert.equal(controller.allows("image-brand_image_brand", "investigate"), true, "MCP namespace must be usable while gathering facts");
    assert.equal(controller.allows("image-brand_image_brand", "work"), true, "MCP namespace must stay usable during work");
    assert.equal(controller.allows("public-api_weather", "verify"), true, "public-api namespace must be reviewable in verify");
    assert.equal(controller.allows("image-brand_image_brand", "intake"), false, "MCP tools must not leak into intake");
  }
  assert.equal(manu.allows("edit", "investigate"), false);
  assert.equal(manu.allows("edit", "work"), true);
});

test("each prompt exposes its phase tools and namespaced plugin tools", () => {
  const nilaPrompt = getAgentController("nila")!.prompt();
  const manuPrompt = getAgentController("manu")!.prompt();

  assert.match(nilaPrompt, /Tool access \(enforced by plugin\)/);
  assert.match(nilaPrompt, /design_sketch: investigate\/propose\/work/);
  assert.match(nilaPrompt, /design_review: investigate\/propose\/work\/verify/);
  assert.doesNotMatch(manuPrompt, /design_sketch|design_review/);
  assert.equal(getAgentController("nila")!.allows("zombiecoder_design_sketch", "investigate"), true);
  assert.equal(getAgentController("manu")!.allows("zombiecoder_design_sketch", "investigate"), false);
});

test("shared routing keeps the selected agent as owner without forcing review on simple tasks", () => {
  const prompt = getAgentController("manu")!.prompt();
  assert.match(prompt, /UI-selected agent as the primary owner and final reporter/);
  assert.match(prompt, /do not add a reviewer to a simple task/);
  assert.match(prompt, /project_investigation/);
  assert.doesNotMatch(prompt, /After substantive implementation, have Majnu review/);
  for (const controller of AGENT_CONTROLLERS) assert.equal(controller.profile.mode, "all");
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

  const investigating = manu.walk(run, ["footprint", "investigate"]);
  assert.equal(investigating.routeKey, "zc/manu/substantive/investigate");
  assert.throws(() => manu.advance(investigating, "respond"), /illegal route step/);

  const working = manu.noteContract(investigating, {
    id: "gc_route",
    status: "open",
    at: investigating.updatedAt,
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
    ["footprint", "investigate"],
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
  assert.equal(
    classifyTask("zombiecoder_goal_contractতুই আগে এটাকে ঠিক কর। এরপরে ধাপ চার ফিলাপ করে টেস্ট কর।"),
    "substantive",
  );
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

test("a focused write opens its contract directly from investigation", () => {
  const first = beginTurn({
    sessionID: "ses_consent",
    agentID: "manu",
    message: "Implement src/agents/base.ts",
  });
  assert.equal(first.run.phase, "investigate");
  assert.equal(manu.allows("goal_contract", "investigate"), true);
  const opened = applyToolEvent(first.run, {
    tool: "goal_contract",
    event: { status: "completed", output: { id: "gc_direct", status: "open" } },
  });
  assert.equal(opened?.phase, "work");
  assert.equal(manu.release(opened ?? null).ok, false);
});

test("a namespaced zombiecoder_goal_contract open advances the run", () => {
  const first = beginTurn({
    sessionID: "ses_namespaced_open",
    agentID: "manu",
    message: "Implement src/agents/base.ts",
  });
  assert.equal(first.run.phase, "investigate");
  const opened = applyToolEvent(first.run, {
    tool: "zombiecoder_goal_contract",
    event: { status: "completed", output: { id: "gc_namespaced", status: "open" } },
  });
  assert.equal(opened?.phase, "work");
  assert.equal(opened?.contract?.id, "gc_namespaced");
  assert.equal(opened?.contract?.status, "open");
});

test("a namespaced close PASS releases the run from work", () => {
  const first = beginTurn({
    sessionID: "ses_namespaced_close",
    agentID: "manu",
    message: "Implement src/agents/base.ts",
  });
  const working = applyToolEvent(first.run, {
    tool: "zombiecoder_goal_contract",
    event: { status: "completed", output: { id: "gc_namespaced", status: "open" } },
  });
  assert.equal(working?.phase, "work");
  assert.equal(manu.allows("goal_contract", "work"), true);

  const released = applyToolEvent(working, {
    tool: "zombiecoder_goal_contract",
    event: {
      status: "completed",
      output: { id: "gc_namespaced", status: "PASS", check: "node ok.mjs", exitCode: 0 },
    },
  });
  assert.equal(released?.phase, "respond");
  assert.equal(released?.contract?.status, "PASS");
  assert.equal(manu.release(released ?? null).ok, true);
});

test("switching agents in the same user turn preserves phase and contract", () => {
  const message = "Implement src/agents/base.ts";
  const first = beginTurn({
    sessionID: "ses_handoff",
    agentID: "manu",
    message,
    turnIndex: 1,
  });
  const working = applyToolEvent(first.run, {
    tool: "goal_contract",
    event: { status: "completed", output: { id: "gc_handoff", status: "open" } },
  });
  assert.equal(working?.phase, "work");

  const handoff = beginTurn({
    sessionID: "ses_handoff",
    agentID: "nila",
    message,
    previous: working,
    turnIndex: 1,
  });
  assert.equal(handoff.handedOff, true);
  assert.equal(handoff.run.agentID, "nila");
  assert.equal(handoff.run.phase, "work");
  assert.equal(handoff.run.contract?.id, "gc_handoff");
  assert.equal(handoff.run.routeKey, "zc/nila/substantive/work");
  assert.equal(getAgentController("nila")!.allows("edit", handoff.run.phase), true);
  assert.equal(handoff.run.steps.at(-1)?.kind, "agent_handoff");

  const nextTurn = beginTurn({
    sessionID: "ses_handoff",
    agentID: "nila",
    message: "Implement src/agents/defaults.ts",
    previous: handoff.run,
    turnIndex: 2,
  });
  assert.equal(nextTurn.handedOff, false);
  assert.equal(nextTurn.run.phase, "investigate");
  assert.equal(nextTurn.run.contract, null);
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

test("every persona keeps the friendly, playful Barishal tone and its own identity", () => {
  for (const agent of ROSTER) {
    const prompt = agentSystemPrompt(agent);
    assert.match(prompt, /\*\*Tone:\*\*/, `${agent.id} lost the tone contract`);
    assert.match(prompt, /Barishal/);
    assert.match(prompt, /lightly playful/);
    // The tone must never displace the role, the decision rule or the evidence
    // labels — a funny agent that cannot prove a claim is still a bad agent.
    assert.ok(prompt.includes(agent.callSign), `${agent.id} lost its call sign`);
    assert.ok(prompt.includes(agent.rule), `${agent.id} lost its decision rule`);
    assert.match(prompt, /UNVERIFIED/);
    assert.match(prompt, /No closing offer/);
    assert.match(prompt, /Finish your own slice/);
    assert.match(prompt, /selected agent as task owner\/reporter/);
    assert.match(prompt, /Majnu cannot delegate/);
    assert.ok(prompt.length < 7000, `${agent.id} shared prompt should stay concise`);
  }
});
