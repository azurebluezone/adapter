// Wiring regressions: the live tool surface, the two intent classifiers, the
// agent mode matrix, MCP knowledge and the compiler-enforced contract gate.
// These are the failures that look fine in prose and break at runtime.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerTools, toolSpecs, type SurfaceDeps } from "../src/zombie/server.ts";
import { AGENT_CONTROLLERS } from "../src/agents/index.ts";
import { mcpAllowPatterns, mcpToolAllowed } from "../src/agents/defaults.ts";
import { ROSTER, agentSystemPrompt } from "../src/roster.ts";
import { classifyTask, noteContract, startRun, walk } from "../src/agents/route.ts";
import { classifyIntent } from "../src/zombie/intent.ts";

function depsFor(root: string): SurfaceDeps {
  return {
    projectRoot: () => root,
    installRoot: () => root,
    storage: { get: async () => null, set: async () => undefined },
    refreshSsot: () => ({ sha256: "", file: "", bytes: 0 }),
    modelPlan: () => ({}),
  };
}

test("tool registration survives MCP names that shadow a ZombieCoder tool", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zc-wiring-"));
  const entries: Array<{ name: string; options?: { namespace?: string } }> = [
    { name: "append_syllabus", options: { namespace: "public-api" } },
    { name: "read_ssot", options: { namespace: "public-api" } },
    { name: "env_get", options: { namespace: "public-api" } },
  ];
  const registration = registerTools(
    {
      transform: async (callback: (editor: any) => void) => {
        callback({ namespace: () => undefined, list: () => entries, add: (tool: any) => entries.push(tool) });
        return { dispose: async () => undefined };
      },
    },
    depsFor(root),
  );

  const applied = await registration.applied;
  assert.equal(applied.error, undefined);
  assert.equal(applied.registered.length, 29, "all 29 ZombieCoder tools must register");
  for (const name of ["append_syllabus", "read_ssot", "env_get"]) {
    assert.ok(
      applied.registered.includes(`zombiecoder_${name}`),
      `${name} must register under the ZombieCoder namespace`,
    );
  }
  const ids = entries.map((entry) =>
    entry.options?.namespace
      ? `${String(entry.options.namespace).replaceAll(".", "_")}_${entry.name}`
      : entry.name,
  );
  assert.ok(ids.includes("public-api_append_syllabus"), "the MCP tool keeps its own id");
  assert.ok(ids.includes("zombiecoder_append_syllabus"), "the plugin tool must be present too");
  assert.equal(ids.length, 32, "3 MCP tools + 29 ZombieCoder tools");

  // Workflow tools used in phases that deny `execute` must be direct calls:
  // a route gate sees the top-level tool name, and the Code Mode wrapper is
  // denied in intake/footprint/contract/respond.
  const own = entries.filter((entry) => entry.options?.namespace === "zombiecoder");
  for (const name of [
    "append_syllabus",
    "context_status",
    "goal_contract",
    "project_onboarding",
    "read_ssot",
  ]) {
    const entry = own.find((candidate) => candidate.name === name) as
      | { options?: { codemode?: boolean } }
      | undefined;
    assert.equal(entry?.options?.codemode, false, `${name} must register as a direct tool`);
  }

  const surface = JSON.parse(
    fs.readFileSync(path.join(root, ".zombiecoder", ".state", "tool-surface.json"), "utf8"),
  );
  assert.equal(surface.zombiecoder.length, 29);
  assert.ok(surface.zombiecoder.includes("zombiecoder_append_syllabus"));
  assert.ok(surface.surface.includes("public-api_append_syllabus"));

  await registration.release();
  fs.rmSync(root, { recursive: true, force: true });
});

test("respond phase receives the release tools as direct calls, not the Code Mode wrapper", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zc-respond-"));
  const specs = toolSpecs(depsFor(root));
  assert.deepEqual(
    specs.filter((spec) => spec.direct).map((spec) => spec.name).sort(),
    [
      "append_syllabus",
      "context_status",
      "goal_contract",
      "intent_judge",
      "memory_archive",
      "project_fingerprint",
      "project_onboarding",
      "read_ssot",
      "read_syllabus",
      "skill_catalog",
      "tool_result_read",
    ].sort(),
    "workflow tools used in phases without execute must leave Code Mode",
  );
  const controller = AGENT_CONTROLLERS.find((entry) => entry.id === "zombiecoder");
  assert.ok(controller, "zombiecoder controller missing");
  for (const tool of [
    "zombiecoder_append_syllabus",
    "zombiecoder_context_status",
    "append_syllabus",
    "context_status",
  ]) {
    assert.equal(controller.allows(tool, "respond"), true, `${tool} must be reachable in respond`);
  }
  // The wrapper stays closed: respond has no shell, so allowing `execute` would
  // hand the phase every Code Mode tool, including the mutating ones.
  assert.equal(controller.allows("execute", "respond"), false);
  assert.equal(controller.allows("shell", "respond"), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the source surface has 29 tools including the shadowed and symbol tools", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zc-specs-"));
  const names = toolSpecs(depsFor(root)).map((spec) => spec.name);
  assert.equal(names.length, 29);
  for (const name of [
    "append_syllabus",
    "read_ssot",
    "env_get",
    "symbol_overview",
    "find_symbols",
    "find_references",
    "diagnostics_for_file",
  ]) {
    assert.ok(names.includes(name), `${name} missing from the source surface`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("one shared intent classifier keeps route and context in sync", () => {
  const request =
    "append_syllabus টুলটিকে লাইভ সিস্টেমে ঠিকমতো কানেক্ট কর; নতুন কোড reinstall কর; intent classifier আপডেট কর";
  assert.equal(classifyTask(request), "substantive");
  assert.equal(classifyIntent(request).kind, "change");

  const pasted =
    'tool "write" is not allowed for zombiecoder during investigate. কনফিগারেশনটা চেক করে বলো কি সমস্যা';
  assert.equal(classifyTask(pasted), "readonly");
  assert.equal(classifyIntent(pasted).kind, "inspect");

  assert.equal(classifyTask("merge conflict-টা ঠিক করো"), "substantive");
  assert.equal(classifyTask("ফাইলগুলো দেখে বলো কী আছে"), "readonly");
});

test("all ten agents are main-selectable and know the shared context and MCP surfaces", () => {
  assert.equal(ROSTER.length, 10);
  for (const agent of ROSTER) {
    assert.equal(
      agent.mode,
      agent.id === "intent-judge" ? "subagent" : "all",
      `${agent.id} has the wrong mode`,
    );
    const prompt = agentSystemPrompt(agent);
    assert.match(prompt, /### Context you are given/, `${agent.id} does not know the context sources`);
    assert.match(prompt, /### Complexity budget/, `${agent.id} has no anti-overthink budget`);
    assert.match(prompt, /`read_ssot`/);
    assert.match(prompt, /`append_syllabus`/);
    assert.match(prompt, /`project_investigation`/);
    assert.match(prompt, /`project_fingerprint`/);
    assert.match(prompt, /`memory_archive`/);
    assert.match(prompt, /mcpAllow/);
    assert.doesNotMatch(
      prompt,
      /image-brand|public-api|cdp|missionbarisal/i,
      `${agent.id} hardcodes an MCP server name`,
    );
  }
});

test("MCP access is environment-owned and empty by default", () => {
  for (const controller of AGENT_CONTROLLERS) {
    // No implicit wildcard: the plugin ships no MCP server name and grants none.
    assert.equal(controller.allows("missionbarisal_read_file", "investigate"), false, controller.id);
    assert.equal(controller.allows("missionbarisal_exec", "work"), false, controller.id);
    assert.equal(controller.allows("image-brand_image_brand", "investigate"), false, controller.id);
    assert.equal(controller.allows("public-api_country", "investigate"), false, controller.id);
    assert.equal(controller.allows("unknown-mcp_exec", "work"), false, controller.id);
  }
  assert.deepEqual(mcpAllowPatterns([]), []);
  assert.deepEqual(mcpAllowPatterns(["public-api", "image-brand", "public-api"]), [
    "public-api_*",
    "image-brand_*",
  ]);
  assert.equal(mcpToolAllowed("public-api_country", ["public-api"]), true);
  assert.equal(mcpToolAllowed("image-brand_image_fit", ["public-api"]), false);
  assert.equal(
    mcpToolAllowed("zombiecoder_append_syllabus", ["zombiecoder"]),
    false,
    "the plugin namespace is never an MCP grant",
  );
});

test("the compiler route refuses a substantive answer without a PASS contract", () => {
  let run = startRun({
    sessionID: "ses-gate",
    agentID: "zombiecoder",
    message: "adapter-এ patch apply করে ঠিক করো",
  });
  assert.equal(run.taskKind, "substantive");
  run = walk(run, ["footprint", "investigate"]);
  assert.throws(() => walk(run, ["respond"]), /contract gate/);

  const opened = noteContract(run, {
    id: "gc-gate",
    status: "open",
    at: new Date().toISOString(),
    check: "true",
    expected: "GATE_OK",
  });
  assert.equal(opened.phase, "work");
  // work -> respond is not an edge; the gate is exercised on the verify edge.
  const verifying = walk(opened, ["verify"]);
  assert.throws(() => walk(verifying, ["respond"]), /contract gate/);

  const passed = noteContract(verifying, {
    id: "gc-gate",
    status: "PASS",
    at: new Date().toISOString(),
    check: "true",
    expected: "GATE_OK",
  });
  assert.equal(passed.phase, "respond");
  assert.equal(passed.contract?.status, "PASS");
});
