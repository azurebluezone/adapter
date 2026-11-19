// Five-step acceptance probe. Each step prints its own evidence line; the
// final line is the goal_contract token. The last two checks run the real
// typecheck and the full test suite, so a green probe cannot hide a broken repo.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
let failures = 0;

function step(label, fn) {
  try {
    fn();
    console.log(label);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${label}: ${error?.message ?? error}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { TASK_COMPLEXITIES, classifyComplexity } = await import("../src/zombie/taskClass.ts");
const { beginTurn } = await import("../src/agents/runtime.ts");
const { releaseCheck } = await import("../src/agents/route.ts");
const {
  ENVELOPE_HEADER,
  buildSubagentEnvelope,
  renderEnvelope,
  validateEnvelopePrompt,
} = await import("../src/zombie/subagentEnvelope.ts");
const {
  createInvestigation,
  validateInvestigation,
} = await import("../src/zombie/investigation.ts");
const { archiveToolResult, readArchivedResult } = await import("../src/zombie/toolArchive.ts");
const { findSkill, catalogIds } = await import("../src/zombie/skillCatalog.ts");
const { AGENT_CONTROLLERS } = await import("../src/agents/index.ts");
const { SHARED_RULES } = await import("../src/agents/shared.ts");
const { auditPromptBudget } = await import("../src/zombie/promptBudget.ts");

step("STEP1_OK classifier=5-levels fastpath=readonly writes=contract", () => {
  assert(TASK_COMPLEXITIES.length === 5, "expected five levels");
  const levels = [
    ["hello", false, "trivial"],
    ["check the node version", false, "small"],
    ["fix the typo in README", true, "medium"],
    ["migrate the database schema", true, "substantive"],
    ["deploy to production and delete the auth secrets", true, "complex"],
  ].map(([message, writeIntent]) => classifyComplexity({ message, writeIntent }).level);
  assert(new Set(levels).size === 5, `levels were ${levels.join(",")}`);
  const read = beginTurn({ sessionID: "probe-read", agentID: "zombiecoder", message: "check the node version" });
  assert(read.run.fastPath === true && read.run.phase === "intake", "read-only fast path did not skip the walk");
  assert(releaseCheck(read.run).ok, "fast-path read-only turn should be releasable");
  const write = beginTurn({ sessionID: "probe-write", agentID: "zombiecoder", message: "fix the typo in README" });
  assert(write.run.taskKind === "substantive", "a write must stay substantive");
  assert(!releaseCheck(write.run).ok, "a write without a PASS contract must be blocked");
});

step("STEP2_OK envelope=intent/goal/files/failures plugin=blocks-missing", () => {
  const envelope = renderEnvelope(
    buildSubagentEnvelope({
      intent: "implement the approved plan",
      goal: "ZC_FIVE_STEPS_OK",
      files: ["src/zombie/taskClass.ts", "src/plugin.ts"],
      priorFailures: ["config symlink fork"],
    }),
  );
  assert(envelope.startsWith(ENVELOPE_HEADER), "header missing");
  assert(validateEnvelopePrompt(envelope).ok, "rendered envelope failed its own gate");
  const bare = validateEnvelopePrompt("fix src/a.ts");
  assert(!bare.ok && bare.missing.includes("intent"), "bare prompt must be refused");
  const plugin = fs.readFileSync(path.join(ROOT, "src", "plugin.ts"), "utf8");
  assert(plugin.includes("agent.envelope.block"), "plugin does not enforce the envelope");
});

step("STEP3_OK investigation=shared-schema goal_contract+envelope", () => {
  const investigation = createInvestigation({
    task: "probe",
    project: "zombiecoder-opencode",
    findings: [{ claim: "one entry", evidence: "find ...", label: "SOURCE_VERIFIED" }],
    expected: "ZC_FIVE_STEPS_OK",
  });
  assert(validateInvestigation(investigation).ok, "valid package was rejected");
  const bad = validateInvestigation({ ...investigation, findings: [{ claim: "x", evidence: "y", label: "TRUST_ME" }] });
  assert(!bad.ok, "bad evidence label was accepted");
  const envelope = renderEnvelope(buildSubagentEnvelope({ intent: "probe", goal: "probe", investigation }));
  assert(envelope.includes("Investigation JSON"), "envelope did not embed the shared package");
  const server = fs.readFileSync(path.join(ROOT, "src", "zombie", "server.ts"), "utf8");
  assert(server.includes("validateInvestigation(input.investigation)"), "goal_contract does not validate the shared schema");
});

step("STEP4_OK archive=large-only redact=on reader=path-confined", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zc-probe-archive-"));
  try {
    const small = archiveToolResult({ root, tool: "read", output: "small" });
    assert(!small.archived, "small output should stay inline");
    const large = archiveToolResult({
      root,
      tool: "shell",
      output: `Bearer secret-token\n${"y".repeat(9000)}`,
    });
    assert(large.archived && large.file, "large output was not archived");
    const body = fs.readFileSync(path.join(root, large.file), "utf8");
    assert(body.includes("Bearer [REDACTED]"), "secret was persisted");
    assert(readArchivedResult(root, large.file) === body, "reader did not return the archive");
    assert(readArchivedResult(root, "../../etc/passwd") === null, "path traversal was allowed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

step("STEP5_OK skills=root-cause/threat-model/test-planning prompt-budget=pass", () => {
  for (const id of ["root-cause", "threat-model", "test-planning"]) {
    const spec = findSkill(id);
    assert(spec, `${id} missing from the catalog`);
    assert(fs.existsSync(path.join(ROOT, "docs", "skills", spec.file)), `${spec.file} missing`);
  }
  const prompts = Object.fromEntries(AGENT_CONTROLLERS.map((agent) => [agent.id, agent.prompt()]));
  const budget = auditPromptBudget(prompts, SHARED_RULES, 32000);
  assert(budget.ok, budget.issues.join("; "));
  console.log(`  catalog=${catalogIds().length} maxPromptBytes=${budget.maxBytes}`);
});

function run(label, command, args, verify) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", timeout: 110000 });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const output = combined.trim().split("\n");
  for (const line of output.slice(-6)) console.log(`  ${line}`);
  if (result.status !== 0) {
    failures += 1;
    console.error(`FAIL ${label}: exit ${result.status}`);
    return;
  }
  if (verify && !verify(combined)) {
    failures += 1;
    console.error(`FAIL ${label}: summary check failed`);
    return;
  }
  console.log(label);
}

run("STEP6_OK typecheck exit 0", "npm", ["run", "typecheck"]);
run("STEP7_OK suite fail 0", "npm", ["test"], (output) => /ℹ fail 0/.test(output));

if (failures > 0) {
  console.error(`ZC_FIVE_STEPS_FAILED failures=${failures}`);
  process.exit(1);
}
console.log("ZC_FIVE_STEPS_OK");
