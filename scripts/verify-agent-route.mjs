#!/usr/bin/env node
// Regression proof for the investigate dead end found in
// ses_dffc9ac2affe8o5U2tIAruvhO9:
//   - question / webfetch / websearch / append_syllabus were denied in
//     investigate, so the agent could neither ask nor research nor record;
//   - an open goal contract on a readonly run stayed at readonly/intake, so the
//     approved work never reached the write phase;
//   - project_investigation ignored request URLs and returned generic local
//     gaps for an external research task;
//   - the context pack omitted the SSOT/syllabus standing rules.
//
// The marker prints only after the probe, typecheck and the full suite pass.

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const failures = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: options.timeout ?? 300_000,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message,
  };
}

const probe = `
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT_CONTROLLERS } from "./src/agents/index.ts";
import { startRun, noteContract } from "./src/agents/route.ts";
import { buildProjectInvestigation } from "./src/zombie/investigation.ts";
import { buildContextPack } from "./src/zombie/context.ts";
import { appendSyllabus, ensureSyllabus, readSyllabus } from "./src/zombie/syllabus.ts";
import { scanProject } from "./src/zombie/scan.ts";

const failures = [];
const must = (condition, message) => { if (!condition) failures.push(message); };
const controller = AGENT_CONTROLLERS.find((item) => item.id === "zombiecoder");
must(Boolean(controller), "zombiecoder controller missing");
if (controller) {
  for (const tool of ["question", "webfetch", "websearch", "append_syllabus"]) {
    must(controller.allows(tool, "investigate"), tool + " is denied in investigate");
  }
  must(!controller.allows("edit", "investigate"), "edit must stay denied in investigate");
  must(controller.allows("question", "propose"), "question is denied in propose");
  must(controller.allows("write", "work"), "write (alias edit) is denied in work");
}

let run = startRun({
  sessionID: "ses-route-fix",
  agentID: "zombiecoder",
  message: "ওয়েব সার্চ করে তিনটি রিপো যাচাই কর",
});
must(run.taskKind === "readonly", "research request must start readonly, got " + run.taskKind);
must(run.phase === "intake", "readonly run must start at intake, got " + run.phase);
run = noteContract(run, {
  id: "gc-route-fix",
  status: "open",
  at: new Date().toISOString(),
  check: "true",
  expected: "ROUTE_FIX_OK",
});
must(run.taskKind === "substantive", "open contract must promote readonly to substantive");
must(run.phase === "work", "open contract must advance to work, got " + run.phase);
must(run.routeKey === "zc/zombiecoder/substantive/work", "routeKey is " + run.routeKey);
must(run.contract?.id === "gc-route-fix", "contract was not carried into work");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zc-route-fix-"));
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response("<html><title>Fixture repo</title></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const investigation = await buildProjectInvestigation(
    root,
    "Check https://example.test/repo and cite the claim",
    "ses-route-fix",
  );
  must(investigation.focusCard?.scope === "external", "focusCard scope is not external");
  must(investigation.sources?.length === 1, "request URL was not probed");
  must(investigation.sources?.[0]?.status === 200, "probed source status is not 200");
  must(investigation.focusCard?.known?.length === 1, "focusCard known list is empty");
  must(/cite the URL/.test(investigation.focusCard?.next ?? ""), "focusCard next does not tell the agent to cite");
} finally {
  globalThis.fetch = originalFetch;
}

fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
fs.writeFileSync(
  path.join(root, ".zombiecoder", "SSOT.md"),
  ["## 1. Project", "fixture", "", "## 8. Shared operating rules", "- The current user request is the task source.", "- Substantive work order: inspect, contract, work.", ""].join("\\n"),
);
fs.writeFileSync(
  path.join(root, ".zombiecoder", "syllabus.md"),
  ["## 1. Scope", "fixture", "", "## 4. Standing rules", "1. SSOT first, then logic, then code.", "2. Evidence before confidence.", "", "## 6. Lessons (append-only)", "### seed", "seed lesson", ""].join("\\n"),
);
const pack = buildContextPack(root, "zombiecoder", [], "fix the investigate route", "ses-route-fix");
must(pack.text.includes("### Standing rules"), "context pack has no standing-rules block");
must(pack.text.includes("SSOT first"), "context pack lost the syllabus standing rule");
must(pack.text.includes("current user request is the task source"), "context pack lost the SSOT work rule");
fs.rmSync(root, { recursive: true, force: true });

// A contract or onboarding lesson can be appended before the watchdog seeds the
// syllabus. The later seed upgrade must keep that lesson instead of replacing
// it with the placeholder.
const sylRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zc-route-syl-"));
appendSyllabus(sylRoot, "Goal Contract gc-preseed", "- status: open");
const fp = scanProject(sylRoot);
ensureSyllabus(sylRoot, fp, ["zombiecoder"]);
const syllabus = readSyllabus(sylRoot) ?? "";
must(syllabus.includes("Goal Contract gc-preseed"), "a lesson appended before the seed was lost");
must(syllabus.includes("## 6. Lessons (append-only)"), "the seed upgrade did not write the lessons section");
fs.rmSync(sylRoot, { recursive: true, force: true });

console.log(JSON.stringify({ ok: failures.length === 0, failures }));
`;

const probeResult = run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", probe]);
if (probeResult.status !== 0) {
  failures.push(`route probe failed (exit ${probeResult.status}): ${(probeResult.stdout + probeResult.stderr).trim().slice(-2000)}`);
} else {
  try {
    const data = JSON.parse(probeResult.stdout.trim().split("\n").pop());
    for (const failure of data.failures ?? []) failures.push(failure);
  } catch (error) {
    failures.push(`route probe did not return JSON: ${String(error?.message ?? error)}`);
  }
}

const typecheck = run("npm", ["run", "typecheck"], { timeout: 180_000 });
if (typecheck.status !== 0) {
  failures.push(`typecheck failed:\n${(typecheck.stdout + typecheck.stderr).trim().slice(0, 2000)}`);
}

const tests = run("npm", ["test"], { timeout: 300_000 });
const testOutput = `${tests.stdout}\n${tests.stderr}`;
if (tests.status !== 0) {
  failures.push(`test suite failed:\n${testOutput.trim().slice(-3000)}`);
}
const failCount = Number((testOutput.match(/ℹ fail (\d+)/) ?? [])[1] ?? NaN);
if (!Number.isFinite(failCount) || failCount !== 0) {
  failures.push(`test suite reports fail=${Number.isNaN(failCount) ? "unknown" : failCount}`);
}

if (failures.length > 0) {
  console.error("FAILED:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("route: question/webfetch/websearch/append_syllabus allowed in investigate");
console.log("route: open contract promotes readonly to substantive/work");
console.log("investigation: request URL probed and returned in focusCard");
console.log("context: standing rules visible in every pack");
console.log("syllabus: a lesson appended before the seed survives the first upgrade");
console.log("typecheck: clean");
console.log(`tests: ${(testOutput.match(/ℹ pass (\d+)/) ?? [])[1] ?? "?"} pass, 0 fail`);
console.log("ZC_ROUTE_FIX_OK");
