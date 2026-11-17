#!/usr/bin/env node
// End-to-end wiring proof for the three tasks in one run:
//   1. append_syllabus/read_ssot/env_get register beside same-named MCP tools.
//   2. the installed plugin is the source tree, byte for byte (clean reinstall).
//   3. the intent classifier, agent modes, context/MCP knowledge and the
//      compiler-enforced contract gate are proven, not described.
//
// The marker prints only after every check passes. A failed check prints the
// concrete reason and exits 1.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = os.homedir();
const INSTALL = path.join(HOME, ".config", "opencode", "plugins", "zombiecoder");
const CONFIG_FILE = path.join(HOME, ".config", "opencode", "opencode.json");
const AGENT_DIRS = [
  path.join(HOME, ".config", "opencode", "agents"),
  path.join(HOME, ".opencode", "agents"),
];
const PROJECT = fs.existsSync(path.join(HOME, "serena", ".zombiecoder"))
  ? path.join(HOME, "serena")
  : path.dirname(REPO);
const SURFACE_FILE = path.join(PROJECT, ".zombiecoder", ".state", "tool-surface.json");

const failures = [];
const notes = [];
const must = (condition, message) => {
  if (!condition) failures.push(message);
};
const pass = (message) => notes.push(message);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO,
    encoding: "utf8",
    timeout: options.timeout ?? 180_000,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message,
  };
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listTs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function checkParity() {
  const pairs = [
    [path.join(REPO, "src", "plugin.ts"), path.join(INSTALL, "plugin.ts")],
    [path.join(REPO, "src", "roster.ts"), path.join(INSTALL, "roster.ts")],
  ];
  for (const dir of ["agents", "zombie"]) {
    const sourceDir = path.join(REPO, "src", dir);
    const installDir = path.join(INSTALL, dir);
    for (const source of listTs(sourceDir)) {
      pairs.push([source, path.join(installDir, path.relative(sourceDir, source))]);
    }
  }
  for (const [source, target] of pairs) {
    if (!fs.existsSync(target)) {
      failures.push(`installed plugin missing ${path.relative(REPO, source)}`);
      continue;
    }
    if (sha256(source) !== sha256(target)) {
      failures.push(`installed ${path.relative(INSTALL, target)} differs from source ${path.relative(REPO, source)}`);
    }
  }
  // A stale file surviving a "clean" reinstall is the Nov-14 failure mode.
  const expected = new Set(pairs.map(([, target]) => target));
  for (const installed of listTs(INSTALL)) {
    if (!expected.has(installed)) failures.push(`stale installed file not in source: ${path.relative(INSTALL, installed)}`);
  }
  pass(`parity: ${pairs.length} files byte-identical, no stale .ts`);
}

function checkSource() {
  const code = `
    import { toolSpecs } from "./src/zombie/server.ts";
    import { classifyTask } from "./src/agents/route.ts";
    import { classifyIntent } from "./src/zombie/intent.ts";
    import { ROSTER } from "./src/roster.ts";
    const deps = { projectRoot: () => ${JSON.stringify(PROJECT)}, installRoot: () => ${JSON.stringify(INSTALL)}, storage: { get: async () => null, set: async () => undefined }, refreshSsot: () => ({ sha256: "", file: "", bytes: 0 }), modelPlan: () => ({}) };
    const request = "append_syllabus টুলটিকে লাইভ সিস্টেমে কানেক্ট কর; নতুন কোড reinstall কর; intent classifier আপডেট কর";
    console.log(JSON.stringify({
      names: toolSpecs(deps).map((s) => s.name),
      direct: toolSpecs(deps).filter((s) => s.direct).map((s) => s.name).sort(),
      route: classifyTask(request),
      context: classifyIntent(request).kind,
      modes: ROSTER.map((a) => [a.id, a.mode]),
    }));
  `;
  const result = run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code]);
  if (result.status !== 0) {
    failures.push(`source probe failed: ${result.stderr.trim() || result.error}`);
    return;
  }
  const data = JSON.parse(result.stdout.trim().split("\n").pop());
  must(data.names.length === 26, `source toolSpecs must be 26, got ${data.names.length}`);
  for (const name of ["append_syllabus", "read_ssot", "env_get", "symbol_overview", "find_symbols", "find_references", "diagnostics_for_file"]) {
    must(data.names.includes(name), `source surface missing ${name}`);
  }
  must(
    data.direct.length === 2 && data.direct.includes("append_syllabus") && data.direct.includes("context_status"),
    `source direct tools must be append_syllabus + context_status, got ${data.direct.join(", ") || "none"}`,
  );
  must(data.route === "substantive", `real change request classified as ${data.route}`);
  must(data.context === "change", `context classifier says ${data.context}, route says ${data.route}`);
  must(data.modes.length === 9, `roster must be 9 agents, got ${data.modes.length}`);
  for (const [id, mode] of data.modes) must(mode === "all", `${id} mode is ${mode}, expected all`);
  pass(`source: 26 tools, 2 direct release tools, change request=substantive, 9 agents mode all`);
}

function checkCollision() {
  const code = `
    import fs from "node:fs";
    import os from "node:os";
    import path from "node:path";
    import { registerTools } from "./src/zombie/server.ts";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zc-verify-"));
    const entries = [
      { name: "append_syllabus", options: { namespace: "mcp" } },
      { name: "read_ssot", options: { namespace: "mcp" } },
      { name: "env_get", options: { namespace: "mcp" } },
    ];
    const deps = { projectRoot: () => root, installRoot: () => root, storage: { get: async () => null, set: async () => undefined }, refreshSsot: () => ({ sha256: "", file: "", bytes: 0 }), modelPlan: () => ({}) };
    const registration = registerTools({ transform: async (cb) => { cb({ namespace: () => undefined, list: () => entries, add: (tool) => entries.push(tool) }); return { dispose: async () => undefined }; } }, deps);
    const applied = await registration.applied;
    const surface = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", ".state", "tool-surface.json"), "utf8"));
    console.log(JSON.stringify({
      registered: applied.registered,
      surface,
      codemode: entries.filter((e) => e.options?.namespace === "zombiecoder").map((e) => [e.name, e.options?.codemode ?? null]),
      ids: entries.map((e) => e.options?.namespace ? e.options.namespace.replaceAll(".", "_") + "_" + e.name : e.name),
    }));
    await registration.release();
    fs.rmSync(root, { recursive: true, force: true });
  `;
  const result = run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code]);
  if (result.status !== 0) {
    failures.push(`collision probe failed: ${result.stderr.trim() || result.error}`);
    return;
  }
  const data = JSON.parse(result.stdout.trim().split("\n").pop());
  must(data.registered.length === 26, `collision probe registered ${data.registered.length}, expected 26`);
  for (const name of ["append_syllabus", "read_ssot", "env_get"]) {
    must(data.registered.includes(`zombiecoder_${name}`), `collision dropped zombiecoder_${name}`);
    must(data.ids.includes(`mcp_${name}`), `MCP ${name} lost from the surface`);
  }
  must(data.surface.zombiecoder.length === 26, `tool-surface zombiecoder=${data.surface.zombiecoder.length}`);
  const codemode = new Map(data.codemode);
  for (const name of ["append_syllabus", "context_status"]) {
    must(codemode.get(name) === false, `${name} must be registered as a direct tool (codemode:false), got ${codemode.get(name)}`);
  }
  must(codemode.get("read_ssot") !== false, "read_ssot must stay inside Code Mode");
  pass("collision: 26 ZombieCoder tools coexist with 3 same-named MCP tools; release tools are direct");
}

function checkInstalled() {
  const code = `
    import { toolSpecs } from ${JSON.stringify(pathToFileURL(path.join(INSTALL, "zombie", "server.ts")).href)};
    const deps = { projectRoot: () => ${JSON.stringify(PROJECT)}, installRoot: () => ${JSON.stringify(INSTALL)}, storage: { get: async () => null, set: async () => undefined }, refreshSsot: () => ({ sha256: "", file: "", bytes: 0 }), modelPlan: () => ({}) };
    console.log(JSON.stringify({
      names: toolSpecs(deps).map((s) => s.name),
      direct: toolSpecs(deps).filter((s) => s.direct).map((s) => s.name).sort(),
    }));
  `;
  const result = run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code]);
  if (result.status !== 0) {
    failures.push(`installed spec probe failed: ${result.stderr.trim() || result.error}`);
    return;
  }
  const data = JSON.parse(result.stdout.trim().split("\n").pop());
  const names = data.names;
  must(names.length === 26, `installed toolSpecs must be 26, got ${names.length}`);
  for (const name of ["append_syllabus", "read_ssot", "env_get", "symbol_overview", "find_symbols", "find_references", "diagnostics_for_file"]) {
    must(names.includes(name), `installed surface missing ${name}`);
  }
  must(
    data.direct.length === 2 && data.direct.includes("append_syllabus") && data.direct.includes("context_status"),
    `installed direct tools must be append_syllabus + context_status, got ${data.direct.join(", ") || "none"}`,
  );
  pass(`installed: ${names.length} tool specs, 2 direct release tools`);
}

function checkSurface() {
  if (!fs.existsSync(SURFACE_FILE)) {
    failures.push(`live tool surface snapshot missing: ${SURFACE_FILE}`);
    return;
  }
  const data = JSON.parse(fs.readFileSync(SURFACE_FILE, "utf8"));
  must(data.namespace === "zombiecoder", `surface namespace is ${data.namespace}`);
  must(data.zombiecoder.length === 26, `live zombiecoder surface is ${data.zombiecoder.length}, expected 26`);
  for (const name of ["append_syllabus", "read_ssot", "env_get"]) {
    must(data.zombiecoder.includes(`zombiecoder_${name}`), `live surface missing zombiecoder_${name}`);
  }
  const installedAt = fs.statSync(path.join(INSTALL, "zombie", "server.ts")).mtimeMs;
  const writtenAt = fs.statSync(SURFACE_FILE).mtimeMs;
  must(writtenAt >= installedAt, "surface snapshot predates the installed plugin; setup has not reloaded it");
  pass(`live surface snapshot: ${data.zombiecoder.length} tools, append_syllabus present`);
}

function checkAgents() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  const agents = config.agents ?? config.agent ?? {};
  const ids = Object.keys(agents);
  const mcpServers = Object.keys(config.mcp?.servers ?? {});
  must(ids.length === 9, `config has ${ids.length} agents, expected 9`);
  must(mcpServers.length >= 2, `config mounts ${mcpServers.length} MCP servers, expected at least 2`);
  must(config.default_agent === "zombiecoder", `default_agent is ${config.default_agent}`);
  for (const [id, agent] of Object.entries(agents)) {
    must(agent.mode === "all", `config agent ${id} mode=${agent.mode}`);
  }
  for (const id of ids) {
    for (const dir of AGENT_DIRS) {
      const file = path.join(dir, `${id}.md`);
      if (!fs.existsSync(file)) {
        failures.push(`agent markdown missing: ${file}`);
        continue;
      }
      const text = fs.readFileSync(file, "utf8");
      must(/^mode:\s*all\s*$/m.test(text), `${file} is not mode: all`);
      must(text.includes(`zombiecoder-agent-profile:${id}:`), `${file} has no persona marker`);
      for (const needle of [
        "### Context you are given",
        "### Complexity budget",
        "`append_syllabus`",
        "`project_investigation`",
        "`memory_archive`",
        ...mcpServers.map((server) => `${server}_`),
      ]) {
        must(text.includes(needle), `${file} missing ${needle}`);
      }
    }
  }
  pass(`agents: 9 config entries mode all, markdown knows context + MCP`);
}

function checkGate() {
  const code = `
    import { classifyTask, noteContract, startRun, walk } from "./src/agents/route.ts";
    let run = startRun({ sessionID: "ses-verify", agentID: "zombiecoder", message: "adapter-এ patch apply করে ঠিক করো" });
    run = walk(run, ["footprint", "investigate"]);
    let blocked = false;
    try { walk(run, ["respond"]); } catch (error) { blocked = /contract gate/.test(String(error.message)); }
    const opened = noteContract(run, { id: "gc-verify", status: "open", at: new Date().toISOString(), check: "true", expected: "GATE_OK" });
    const verifying = walk(opened, ["verify"]);
    let blockedOpen = false;
    try { walk(verifying, ["respond"]); } catch (error) { blockedOpen = /contract gate/.test(String(error.message)); }
    const passed = noteContract(verifying, { id: "gc-verify", status: "PASS", at: new Date().toISOString(), check: "true", expected: "GATE_OK" });
    console.log(JSON.stringify({ task: classifyTask("adapter-এ patch apply করে ঠিক করো"), blocked, blockedOpen, released: passed.phase }));
  `;
  const result = run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code]);
  if (result.status !== 0) {
    failures.push(`gate probe failed: ${result.stderr.trim() || result.error}`);
    return;
  }
  const data = JSON.parse(result.stdout.trim().split("\n").pop());
  must(data.task === "substantive", `gate probe task=${data.task}`);
  must(data.blocked, "route allowed respond without any contract");
  must(data.blockedOpen, "route allowed respond with only an open contract");
  must(data.released === "respond", `route did not release after PASS (phase=${data.released})`);
  pass("gate: respond refused without PASS, released after PASS");
}

function checkRespond() {
  const code = `
    import { AGENT_CONTROLLERS } from ${JSON.stringify(pathToFileURL(path.join(INSTALL, "agents", "index.ts")).href)};
    const controller = AGENT_CONTROLLERS.find((c) => c.id === "zombiecoder");
    if (!controller) throw new Error("installed controller zombiecoder missing");
    const reachable = ["zombiecoder_append_syllabus", "zombiecoder_context_status", "append_syllabus", "context_status"];
    console.log(JSON.stringify({
      allowed: reachable.map((tool) => [tool, controller.allows(tool, "respond")]),
      denied: [["execute", controller.allows("execute", "respond")], ["shell", controller.allows("shell", "respond")]],
    }));
  `;
  const result = run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code]);
  if (result.status !== 0) {
    failures.push(`respond probe failed: ${result.stderr.trim() || result.error}`);
    return;
  }
  const data = JSON.parse(result.stdout.trim().split("\n").pop());
  for (const [tool, allowed] of data.allowed) {
    must(allowed === true, `respond cannot reach ${tool} as a direct tool`);
  }
  for (const [tool, allowed] of data.denied) {
    must(allowed === false, `${tool} must stay denied in respond; the direct-tool fix must not open the wrapper`);
  }
  pass("respond: append_syllabus + context_status reachable as direct tools; execute/shell stay denied");
}

function checkSuite() {
  const typecheck = run("npm", ["run", "typecheck"]);
  must(typecheck.status === 0, `typecheck failed:\n${(typecheck.stdout + typecheck.stderr).trim().slice(0, 2000)}`);
  const tests = run("npm", ["test"], { timeout: 300_000 });
  const output = `${tests.stdout}\n${tests.stderr}`;
  must(tests.status === 0, `test suite failed:\n${output.trim().slice(-3000)}`);
  const fail = Number((output.match(/ℹ fail (\d+)/) ?? [])[1] ?? NaN);
  must(Number.isFinite(fail) && fail === 0, `test suite reports fail=${Number.isNaN(fail) ? "unknown" : fail}`);
  const passMatch = Number((output.match(/ℹ pass (\d+)/) ?? [])[1] ?? 0);
  must(passMatch >= 291, `test suite pass count dropped to ${passMatch}`);
  pass(`suite: typecheck clean, ${passMatch} tests pass, 0 fail`);
}

console.log("== ZombieCoder wiring verification ==");
checkParity();
checkSource();
checkCollision();
checkInstalled();
checkSurface();
checkAgents();
checkGate();
checkRespond();
checkSuite();

for (const note of notes) console.log(`ok  ${note}`);
if (failures.length > 0) {
  console.error("\nFAILED:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("\nZC_RESPOND_DIRECT_OK");
console.log("\nZC_WIRING_OK");
