#!/usr/bin/env node
// End-to-end wiring proof for the self-dependent plugin:
//   1. the installed plugin is the source tree, byte for byte;
//   2. the plugin source has no hardcoded MCP server name and no Mission Barisal hook;
//   3. LSP is configured with real binaries and answers initialize (7/7);
//   4. MCP is environment-owned: the config registers the bundled servers, the
//      live `opencode mcp list` sees them, and real tools/call requests work;
//   5. the plugin root is read-only from a session working elsewhere;
//   6. audit --require-mcp passes on the real install and fails without MCP;
//   7. typecheck + the full test suite pass and the empty tracked `tests` file is gone.
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

const CONFIG_CANDIDATES = [
  process.env.OPENCODE_CONFIG,
  path.join(HOME, ".config", "opencode", "opencode.json"),
  path.join(HOME, ".opencode", "opencode.json"),
].filter(Boolean);
const CONFIG_FILE = CONFIG_CANDIDATES.find((file) => fs.existsSync(file)) ?? CONFIG_CANDIDATES[0];
const CONFIG_REAL = fs.existsSync(CONFIG_FILE) ? fs.realpathSync(CONFIG_FILE) : CONFIG_FILE;
// The config file is often a symlink (~/.config/opencode/opencode.json ->
// ~/.opencode/opencode.json). The plugin loader and plugin graph can live next
// to either the symlink or its target, so search both instead of picking one.
const CONFIG_DIR = path.dirname(CONFIG_FILE);
const CONFIG_DIRS = [
  ...new Set([CONFIG_DIR, path.dirname(CONFIG_REAL)]),
];
const INSTALL = [
  ...CONFIG_DIRS.flatMap((dir) => [
    path.join(dir, "plugins", "zombiecoder"),
    path.join(dir, "zombiecoder"),
  ]),
  path.join(HOME, ".config", "opencode", "plugins", "zombiecoder"),
  path.join(HOME, ".config", "opencode", "zombiecoder"),
  path.join(HOME, ".opencode", "plugins", "zombiecoder"),
  path.join(HOME, ".opencode", "zombiecoder"),
].find((dir) => fs.existsSync(path.join(dir, "plugin.ts"))) ?? path.join(CONFIG_DIRS[0], "plugins", "zombiecoder");
const AGENT_DIRS = [...new Set([...CONFIG_DIRS.map((dir) => path.join(dir, "agents")), path.join(HOME, ".opencode", "agents")])];
const PROJECT = process.env.ZOMBIECODER_PROJECT
  ? path.resolve(process.env.ZOMBIECODER_PROJECT)
  : fs.existsSync(path.join(REPO, ".zombiecoder"))
    ? REPO
    : process.cwd();
const SURFACE_FILE = path.join(PROJECT, ".zombiecoder", ".state", "tool-surface.json");
const ZOMBIE_CONFIG =
  [...CONFIG_DIRS, ...CONFIG_DIRS.map((dir) => path.dirname(dir))]
    .map((dir) => path.join(dir, "zombiecoder", "config.json"))
    .find((file) => fs.existsSync(file)) ?? path.join(CONFIG_DIR, "zombiecoder", "config.json");

const failures = [];
const notes = [];

// Tools used in phases that deny `execute` must be direct calls, not Code Mode.
const DIRECT_TOOLS = [
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
].sort();
const must = (condition, message) => {
  if (!condition) failures.push(message);
};
const pass = (message) => notes.push(message);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO,
    encoding: "utf8",
    timeout: options.timeout ?? 180_000,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...(options.env ?? {}) },
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function mcpEntries(config) {
  const entries = new Map(Object.entries(config?.mcp?.servers ?? {}));
  for (const [name, entry] of Object.entries(config?.mcp ?? {})) {
    if (name !== "servers") entries.set(name, entry);
  }
  return entries;
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
    import { ROSTER, agentSystemPrompt } from "./src/roster.ts";
    import { mcpAllowPatterns, mcpToolAllowed } from "./src/agents/defaults.ts";
    const deps = { projectRoot: () => ${JSON.stringify(PROJECT)}, installRoot: () => ${JSON.stringify(INSTALL)}, storage: { get: async () => null, set: async () => undefined }, refreshSsot: () => ({ sha256: "", file: "", bytes: 0 }), modelPlan: () => ({}) };
    const request = "append_syllabus টুলটিকে লাইভ সিস্টেমে কানেক্ট কর; নতুন কোড reinstall কর; intent classifier আপডেট কর";
    console.log(JSON.stringify({
      names: toolSpecs(deps).map((s) => s.name),
      direct: toolSpecs(deps).filter((s) => s.direct).map((s) => s.name).sort(),
      route: classifyTask(request),
      context: classifyIntent(request).kind,
      modes: ROSTER.map((a) => [a.id, a.mode]),
      prompts: ROSTER.map((a) => agentSystemPrompt(a)),
      mcp: {
        patterns: mcpAllowPatterns(["public-api", "image-brand"]),
        allowed: mcpToolAllowed("public-api_country", ["public-api"]),
        denied: mcpToolAllowed("image-brand_image_fit", ["public-api"]),
        pluginNamespace: mcpToolAllowed("zombiecoder_append_syllabus", ["zombiecoder"]),
      },
    }));
  `;
  const result = run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code]);
  if (result.status !== 0) {
    failures.push(`source probe failed: ${result.stderr.trim() || result.error}`);
    return;
  }
  const data = JSON.parse(result.stdout.trim().split("\n").pop());
  must(data.names.length === 29, `source toolSpecs must be 29, got ${data.names.length}`);
  for (const name of ["append_syllabus", "read_ssot", "env_get", "symbol_overview", "find_symbols", "find_references", "diagnostics_for_file"]) {
    must(data.names.includes(name), `source surface missing ${name}`);
  }
  must(
    data.direct.length === DIRECT_TOOLS.length && DIRECT_TOOLS.every((name) => data.direct.includes(name)),
    `source direct tools must be ${DIRECT_TOOLS.join(", ")}, got ${data.direct.join(", ") || "none"}`,
  );
  must(data.route === "substantive", `real change request classified as ${data.route}`);
  must(data.context === "change", `context classifier says ${data.context}, route says ${data.route}`);
  must(data.modes.length === 10, `roster must be 10 agents, got ${data.modes.length}`);
  for (const [id, mode] of data.modes) must(mode === (id === "intent-judge" ? "subagent" : "all"), `${id} mode is ${mode}, expected ${id === "intent-judge" ? "subagent" : "all"}`);
  for (const [index, prompt] of data.prompts.entries()) {
    const id = data.modes[index][0];
    must(/mcpAllow/.test(prompt), `${id} prompt does not explain the environment MCP allowlist`);
    must(!/image-brand|public-api|cdp|missionbarisal/i.test(prompt), `${id} prompt hardcodes an MCP server name`);
  }
  must(
    data.mcp.patterns.includes("public-api_*") && data.mcp.patterns.includes("image-brand_*"),
    `mcpAllowPatterns returned ${data.mcp.patterns.join(", ") || "none"}`,
  );
  must(data.mcp.allowed === true, "mcpAllow did not grant a listed namespace");
  must(data.mcp.denied === false, "mcpAllow granted an unlisted namespace");
  must(data.mcp.pluginNamespace === false, "the plugin namespace leaked into the MCP allowlist");
  pass(`source: 29 tools, ${data.direct.length} workflow tools outside Code Mode, no hardcoded MCP server name, environment allowlist works`);
}

function checkCollision() {
  const code = `
    import fs from "node:fs";
    import os from "node:os";
    import path from "node:path";
    import { registerTools } from "./src/zombie/server.ts";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zc-verify-"));
    const entries = [
      { name: "append_syllabus", options: { namespace: "public-api" } },
      { name: "read_ssot", options: { namespace: "public-api" } },
      { name: "env_get", options: { namespace: "public-api" } },
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
  must(data.registered.length === 29, `collision probe registered ${data.registered.length}, expected 29`);
  for (const name of ["append_syllabus", "read_ssot", "env_get"]) {
    must(data.registered.includes(`zombiecoder_${name}`), `collision dropped zombiecoder_${name}`);
    must(data.ids.includes(`public-api_${name}`), `MCP ${name} lost from the surface`);
  }
  must(data.surface.zombiecoder.length === 29, `tool-surface zombiecoder=${data.surface.zombiecoder.length}`);
  must(data.surface.surface.includes("public-api_append_syllabus"), "tool-surface lost the MCP id");
  const codemode = new Map(data.codemode);
  for (const name of ["append_syllabus", "context_status", "goal_contract", "project_onboarding", "read_ssot"]) {
    must(codemode.get(name) === false, `${name} must be registered as a direct tool (codemode:false), got ${codemode.get(name)}`);
  }
  pass("collision: 29 ZombieCoder tools coexist with 3 same-named MCP tools; release tools are direct");
}

function checkInstalled() {
  const code = `
    import { toolSpecs } from ${JSON.stringify(pathToFileURL(path.join(INSTALL, "zombie", "server.ts")).href)};
    import { protectedWriteTarget } from ${JSON.stringify(pathToFileURL(path.join(INSTALL, "zombie", "protectedRoots.ts")).href)};
    const deps = { projectRoot: () => ${JSON.stringify(PROJECT)}, installRoot: () => ${JSON.stringify(INSTALL)}, storage: { get: async () => null, set: async () => undefined }, refreshSsot: () => ({ sha256: "", file: "", bytes: 0 }), modelPlan: () => ({}) };
    console.log(JSON.stringify({
      names: toolSpecs(deps).map((s) => s.name),
      direct: toolSpecs(deps).filter((s) => s.direct).map((s) => s.name).sort(),
      blocked: protectedWriteTarget(["/tmp/zc-other/.opencode/opencode.json"], "", "/tmp/zc-other", { installRoot: "/tmp/zc-other/.opencode", sourceRoot: "/tmp/zc-other/adapter" }),
      allowed: protectedWriteTarget(["/tmp/zc-other/adapter/src/plugin.ts"], "", "/tmp/zc-other/adapter", { installRoot: "/tmp/zc-other/.opencode", sourceRoot: "/tmp/zc-other/adapter" }),
    }));
  `;
  const result = run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code]);
  if (result.status !== 0) {
    failures.push(`installed spec probe failed: ${result.stderr.trim() || result.error}`);
    return;
  }
  const data = JSON.parse(result.stdout.trim().split("\n").pop());
  const names = data.names;
  must(names.length === 29, `installed toolSpecs must be 29, got ${names.length}`);
  for (const name of ["append_syllabus", "read_ssot", "env_get", "symbol_overview", "find_symbols", "find_references", "diagnostics_for_file"]) {
    must(names.includes(name), `installed surface missing ${name}`);
  }
  must(
    data.direct.length === DIRECT_TOOLS.length && DIRECT_TOOLS.every((name) => data.direct.includes(name)),
    `installed direct tools must be ${DIRECT_TOOLS.join(", ")}, got ${data.direct.join(", ") || "none"}`,
  );
  must(Boolean(data.blocked), "installed plugin allowed a write into the plugin root from another working directory");
  must(data.allowed === null, "installed plugin blocked a write from inside the plugin root");
  pass(`installed: ${names.length} tool specs, ${data.direct.length} workflow tools outside Code Mode, plugin-root guard present`);
}

function checkConfig() {
  const config = readJson(CONFIG_REAL);
  const agents = config.agents ?? config.agent ?? {};
  const ids = Object.keys(agents);
  must(ids.length === 10, `config has ${ids.length} agents, expected 10`);
  must(config.default_agent === "zombiecoder", `default_agent is ${config.default_agent}`);
  for (const [id, agent] of Object.entries(agents)) {
    const expected = id === "intent-judge" ? "subagent" : "all";
    must(agent.mode === expected, `config agent ${id} mode=${agent.mode}, expected ${expected}`);
  }

  const lsp = Object.entries(config.lsp ?? {});
  must(lsp.length === 7, `config has ${lsp.length} LSP servers, expected 7`);
  for (const [name, entry] of lsp) {
    const command = Array.isArray(entry?.command) ? entry.command[0] : null;
    must(Boolean(command), `lsp.${name} has no command`);
    must(Boolean(command) && fs.existsSync(command), `lsp.${name} binary missing: ${command}`);
  }

  const servers = mcpEntries(config);
  for (const name of ["image-brand", "public-api"]) {
    const entry = servers.get(name);
    must(Boolean(entry), `mcp.servers.${name} is not registered`);
    if (!entry) continue;
    must(entry.type === "local", `mcp.servers.${name} type=${entry.type}, expected local`);
    const command = Array.isArray(entry.command) ? entry.command : null;
    must(Boolean(command && command.length > 0), `mcp.servers.${name} has no command`);
    must(Boolean(command && fs.existsSync(command[command.length - 1])), `mcp.servers.${name} entrypoint missing`);
  }

  must(fs.existsSync(ZOMBIE_CONFIG), `zombiecoder config missing: ${ZOMBIE_CONFIG}`);
  if (fs.existsSync(ZOMBIE_CONFIG)) {
    const zombie = readJson(ZOMBIE_CONFIG);
    must(Array.isArray(zombie.mcpAllow), "zombiecoder config has no mcpAllow array");
    // The allowlist is user/environment-owned. Empty is valid and means MCP
    // access is off; every entry that does exist must name a registered server.
    for (const name of zombie.mcpAllow ?? []) {
      must(servers.has(name), `mcpAllow names unknown MCP server ${name}`);
    }
    if (Array.isArray(zombie.mcpAllow) && zombie.mcpAllow.length === 0) {
      notes.push("mcpAllow is empty: MCP access stays off until the user opts in");
    }
    must(
      typeof zombie.sourceRoot === "string" && zombie.sourceRoot.length > 0,
      "zombiecoder config has no sourceRoot; the plugin cannot protect its source tree",
    );
  }
  pass(`config: 10 agents, ${lsp.length}/7 LSP binaries, ${servers.size} MCP servers, mcpAllow array + sourceRoot set`);
}

function checkLsp() {
  const result = run("node", ["scripts/lsp-probe.mjs", "--root", PROJECT, "--compact"], { timeout: 120_000 });
  if (result.status !== 0) {
    failures.push(`LSP initialize probe failed (exit ${result.status}): ${(result.stdout + result.stderr).trim().slice(-1500)}`);
    return;
  }
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch (error) {
    failures.push(`LSP probe did not return JSON: ${String(error.message)}`);
    return;
  }
  must(data.ok === true, "LSP probe reports ok=false");
  must(Array.isArray(data.servers) && data.servers.length === 7, `LSP probe saw ${data.servers?.length ?? 0} servers, expected 7`);
  for (const server of data.servers ?? []) {
    must(server.ok === true, `LSP ${server.server} failed initialize: ${server.error ?? "unknown"}`);
  }
  pass(`LSP: 7/7 servers answered initialize in ${data.servers.map((s) => `${s.server}(${s.duration_ms}ms)`).join(", ")}`);
}

function checkMcpList() {
  const result = run("opencode", ["mcp", "list"], {
    timeout: 120_000,
    env: { OPENCODE_CONFIG: CONFIG_REAL },
  });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.status !== 0) {
    failures.push(`opencode mcp list failed (exit ${result.status}): ${output.slice(-1500)}`);
    return;
  }
  must(!/No MCP servers configured/i.test(output), "opencode mcp list still reports no servers");
  for (const name of ["image-brand", "public-api"]) {
    must(output.includes(name), `opencode mcp list does not show ${name}`);
  }
  pass(`mcp list: ${output.split("\n").filter((line) => /image-brand|public-api/.test(line)).join(" | ").slice(0, 300)}`);
}

async function checkMcpLive() {
  const installedMcp = path.join(CONFIG_DIR, "mcp");
  const mcpRoot = fs.existsSync(path.join(installedMcp, "public-api", "server.mjs")) ? installedMcp : path.join(REPO, "mcp");
  const { startServer } = await import(pathToFileURL(path.join(REPO, "mcp", "shared", "client.mjs")).href);

  const publicServer = path.join(mcpRoot, "public-api", "server.mjs");
  const publicClient = await startServer(publicServer);
  try {
    await publicClient.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "zc-verify", version: "1" },
    });
    const tools = await publicClient.request("tools/list", {});
    must(Array.isArray(tools?.tools) && tools.tools.length === 8, `public-api tools/list returned ${tools?.tools?.length ?? 0}, expected 8`);
    const country = await publicClient.callTool("country", { name: "Bangladesh" });
    must(country?.ok === true, `public-api country failed: ${JSON.stringify(country).slice(0, 500)}`);
    must(Array.isArray(country?.matches) && country.matches.length > 0, "public-api country returned no matches");
    must(
      String(country?.matches?.[0]?.name ?? "").toLowerCase().includes("bangladesh"),
      `public-api country returned ${country?.matches?.[0]?.name ?? "nothing"}`,
    );
    pass(`public-api live: country=ok (${country?.matches?.[0]?.name ?? "?"}, ${country?.matches?.[0]?.iso2 ?? "?"}), 8 tools`);
  } finally {
    await publicClient.close();
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zc-image-"));
  try {
    const fixtures = path.join(mcpRoot, "image-brand", "fixtures.py");
    const fixtureRun = run("python3", [fixtures, "--dir", tmp], { timeout: 60_000 });
    if (fixtureRun.status !== 0) {
      failures.push(`image fixture generation failed: ${(fixtureRun.stdout + fixtureRun.stderr).trim().slice(-1000)}`);
      return;
    }
    const imageServer = path.join(mcpRoot, "image-brand", "server.mjs");
    const imageClient = await startServer(imageServer);
    try {
      await imageClient.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "zc-verify", version: "1" },
      });
      const tools = await imageClient.request("tools/list", {});
      must(Array.isArray(tools?.tools) && tools.tools.length === 6, `image-brand tools/list returned ${tools?.tools?.length ?? 0}, expected 6`);
      const fit = await imageClient.callTool("image_fit", {
        input: path.join(tmp, "input.jpg"),
        output: path.join(tmp, "fit.png"),
        width: 320,
        height: 200,
        format: "png",
      });
      must(fit?.width === 320 && fit?.height === 200, `image_fit returned ${fit?.width}x${fit?.height}`);
      must(fs.existsSync(path.join(tmp, "fit.png")), "image_fit did not write fit.png");
      pass(`image-brand live: image_fit=ok (${fit?.width ?? "?"}x${fit?.height ?? "?"}, ${fit?.bytes ?? fs.statSync(path.join(tmp, "fit.png")).size} bytes), 6 tools`);
    } finally {
      await imageClient.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function checkAgents() {
  const config = readJson(CONFIG_REAL);
  const servers = [...mcpEntries(config).keys()];
  const zombie = fs.existsSync(ZOMBIE_CONFIG) ? readJson(ZOMBIE_CONFIG) : {};
  const agentDir = AGENT_DIRS.find((dir) =>
    fs.existsSync(dir) && Object.keys(config.agents ?? {}).every((id) => fs.existsSync(path.join(dir, `${id}.md`))),
  );
  must(Boolean(agentDir), `no agent directory has all ${Object.keys(config.agents ?? {}).length} markdown files`);
  if (!agentDir) return;
  for (const id of Object.keys(config.agents ?? {})) {
    const file = path.join(agentDir, `${id}.md`);
    const text = fs.readFileSync(file, "utf8");
    const mode = id === "intent-judge" ? "subagent" : "all";
    must(new RegExp(`^mode:\\s*${mode}\\s*$`, "m").test(text), `${file} is not mode: ${mode}`);
    must(text.includes(`zombiecoder-agent-profile:${id}:`), `${file} has no persona marker`);
    for (const needle of [
      "### Context you are given",
      "### Complexity budget",
      "`append_syllabus`",
      "`project_investigation`",
      "`memory_archive`",
      "mcpAllow",
    ]) {
      must(text.includes(needle), `${file} missing ${needle}`);
    }
    must(!/image-brand|public-api|cdp|missionbarisal/i.test(text), `${file} hardcodes an MCP server name`);
  }
  must(Array.isArray(zombie.mcpAllow), "zombiecoder config has no mcpAllow array");
  for (const name of zombie.mcpAllow ?? []) {
    must(servers.includes(name), `mcpAllow names unknown MCP server ${name}`);
  }
  pass(`agents: 10 markdown files with role modes, rules + mcpAllow present, no hardcoded MCP server name`);
}

function checkSurface() {
  if (!fs.existsSync(SURFACE_FILE)) {
    failures.push(`live tool surface snapshot missing: ${SURFACE_FILE}`);
    return;
  }
  const data = readJson(SURFACE_FILE);
  must(data.namespace === "zombiecoder", `surface namespace is ${data.namespace}`);
  must(data.zombiecoder.length === 29, `live zombiecoder surface is ${data.zombiecoder.length}, expected 29`);
  for (const name of ["append_syllabus", "read_ssot", "env_get"]) {
    must(data.zombiecoder.includes(`zombiecoder_${name}`), `live surface missing zombiecoder_${name}`);
  }
  const mcpIds = (data.surface ?? []).filter((id) => /^(?:image-brand|public-api|cdp)_/.test(id));
  pass(`live surface snapshot: 29 tools; MCP ids: ${mcpIds.join(", ") || "none yet (registration is environment-owned)"}`);
}

function checkProtected() {
  const zombie = fs.existsSync(ZOMBIE_CONFIG) ? readJson(ZOMBIE_CONFIG) : {};
  const sourceRoot = zombie.sourceRoot || REPO;
  const target = path.join(REPO, "src", "plugin.ts");
  const code = `
    import { protectedWriteTarget } from "./src/zombie/protectedRoots.ts";
    console.log(JSON.stringify({
      outside: protectedWriteTarget([${JSON.stringify(target)}], "", "/tmp/zc-other-project", { installRoot: ${JSON.stringify(CONFIG_DIR)}, sourceRoot: ${JSON.stringify(sourceRoot)} }),
      inside: protectedWriteTarget([${JSON.stringify(target)}], "", ${JSON.stringify(REPO)}, { installRoot: ${JSON.stringify(CONFIG_DIR)}, sourceRoot: ${JSON.stringify(sourceRoot)} }),
    }));
  `;
  const result = run(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code]);
  if (result.status !== 0) {
    failures.push(`protected-root probe failed: ${result.stderr.trim() || result.error}`);
    return;
  }
  const data = JSON.parse(result.stdout.trim().split("\n").pop());
  must(Boolean(data.outside), "a write into the plugin root from another working directory was allowed");
  must(data.inside === null, "a write from inside the plugin root was blocked");
  pass("protected: plugin source/install root is read-only from another working directory");
}

function checkAudit() {
  const real = run("node", ["scripts/audit-install.mjs", "--config", CONFIG_DIR, "--install", CONFIG_DIR, "--require-mcp"], {
    timeout: 60_000,
  });
  const realOut = `${real.stdout}\n${real.stderr}`.trim();
  must(real.status === 0, `audit --require-mcp failed on the real install: ${realOut.slice(-1500)}`);
  must(/PASS/.test(realOut), "audit --require-mcp did not print PASS");
  const count = Number((realOut.match(/mcp=(\d+)/) ?? [])[1] ?? 0);
  must(count >= 2, `audit sees ${count} MCP servers, expected at least 2`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zc-audit-"));
  try {
    const bare = readJson(CONFIG_REAL);
    delete bare.mcp;
    fs.writeFileSync(path.join(tmp, "opencode.json"), JSON.stringify(bare, null, 2) + "\n");
    const strict = run("node", ["scripts/audit-install.mjs", "--config", tmp, "--install", CONFIG_DIR, "--require-mcp"], {
      timeout: 60_000,
    });
    const strictOut = `${strict.stdout}\n${strict.stderr}`.trim();
    must(strict.status === 1, `audit --require-mcp accepted a config with no MCP servers (exit ${strict.status})`);
    must(/no MCP servers configured/i.test(strictOut), "audit --require-mcp did not name the missing MCP servers");
    const optIn = run("node", ["scripts/audit-install.mjs", "--config", tmp, "--install", CONFIG_DIR], { timeout: 60_000 });
    must(optIn.status === 0, `audit without --require-mcp rejected an opt-in install: ${(optIn.stdout + optIn.stderr).trim().slice(-1000)}`);
    pass(`audit: real install mcp=${count} PASS; --require-mcp fails on a zero-MCP config; opt-in still passes`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function checkTestsFile() {
  must(!fs.existsSync(path.join(REPO, "tests")), "empty tracked `tests` file still exists");
  const tracked = run("git", ["ls-files", "--error-unmatch", "tests"]);
  must(tracked.status !== 0, "`tests` is still tracked by git");
  pass("repo hygiene: empty tracked `tests` file is gone");
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
  must(passMatch >= 300, `test suite pass count dropped to ${passMatch}`);
  pass(`suite: typecheck clean, ${passMatch} tests pass, 0 fail`);
}

console.log("== ZombieCoder wiring verification ==");
console.log(`config=${CONFIG_REAL}`);
console.log(`install=${INSTALL}`);
console.log(`project=${PROJECT}`);
checkParity();
checkSource();
checkCollision();
checkInstalled();
checkConfig();
checkLsp();
checkMcpList();
try {
  await checkMcpLive();
} catch (error) {
  failures.push(`MCP live probe failed: ${String(error?.message ?? error)}`);
}
checkAgents();
checkSurface();
checkProtected();
checkAudit();
checkTestsFile();
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
