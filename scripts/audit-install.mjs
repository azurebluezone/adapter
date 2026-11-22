#!/usr/bin/env node
/**
 * Inspect an OpenCode install that ZombieCoder produced and report whether the
 * pieces that matter actually exist: agents, LSP binaries, MCP servers, the
 * plugin entrypoint and the skill store.
 *
 * This reads the real filesystem; it does not trust the installer log.
 *
 *   node scripts/audit-install.mjs [--config <dir>] [--install <dir>] [--require-mcp]
 *
 *   --config       directory that holds opencode.json (default ~/.config/opencode)
 *   --install      install root with agents/, plugins/, zombiecoder/
 *                  (default: the --config directory)
 *   --require-mcp  treat zero registered MCP servers as incomplete. Without this
 *                  flag MCP stays opt-in and a zero count is not a failure.
 *   -h, --help     show usage and exit 0
 *
 * Exit codes: 0 complete, 1 incomplete, 2 bad arguments or unreadable config.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE = `Usage: node scripts/audit-install.mjs [options]

Options:
  --config <dir>   OpenCode config directory (default: ~/.config/opencode)
  --install <dir>  Install root with agents/, plugins/, zombiecoder/
                   (default: the --config directory)
  --require-mcp    Zero registered MCP servers is incomplete (opt-in by default)
  -h, --help       Show this help and exit

Exit codes: 0 complete, 1 incomplete, 2 bad arguments or unreadable config.`;

function usage(stream = process.stdout) {
  stream.write(USAGE + "\n");
}

function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(0);
  }
  const options = {
    config: path.join(os.homedir(), ".config", "opencode"),
    install: null,
    requireMcp: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--require-mcp") {
      options.requireMcp = true;
      continue;
    }
    const match = /^--(config|install)(?:=(.*))?$/.exec(token);
    if (!match) {
      console.error(`FAIL unknown argument ${JSON.stringify(token)}`);
      usage(process.stderr);
      process.exit(2);
    }
    const value = match[2] ?? argv[index + 1];
    if (!value || value.startsWith("-")) {
      console.error(`FAIL --${match[1]} needs a directory`);
      usage(process.stderr);
      process.exit(2);
    }
    if (match[2] === undefined) index += 1;
    options[match[1]] = value;
  }
  options.config = path.resolve(options.config);
  options.install = path.resolve(options.install ?? options.config);
  return options;
}

const options = parseArgs(process.argv.slice(2));
const { config: configDir, install: installDir } = options;
const jsonFile = path.join(configDir, "opencode.json");
const jsoncFile = path.join(configDir, "opencode.jsonc");
const configFile = fs.existsSync(jsonFile) ? jsonFile : jsoncFile;
if (!fs.existsSync(configFile)) {
  console.error(`FAIL no opencode.json/jsonc under ${configDir}`);
  process.exit(2);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configFile, "utf8"));
} catch (error) {
  console.error(`FAIL ${configFile} is not strict JSON: ${error.message}`);
  process.exit(2);
}

const has = (target) => fs.existsSync(target);
const agents = Object.keys(config.agents ?? {});
const agentsDir = path.join(installDir, "agents");
const agentFiles = has(agentsDir) ? fs.readdirSync(agentsDir).filter((name) => name.endsWith(".md")) : [];

const lsp = Object.entries(config.lsp ?? {}).map(([name, entry]) => {
  const command = Array.isArray(entry?.command) ? entry.command[0] : null;
  return { name, command, ok: Boolean(command) && has(command) };
});
const lspOk = lsp.filter((entry) => entry.ok).length;

// V2 keeps servers under `mcp.servers`; older configs put them directly under
// `mcp`. Read both so a migrated install is not reported as empty.
const mcpEntries = new Map(Object.entries(config.mcp?.servers ?? {}));
for (const [name, entry] of Object.entries(config.mcp ?? {})) {
  if (name !== "servers") mcpEntries.set(name, entry);
}
const mcp = [...mcpEntries].map(([name, entry]) => {
  const command = Array.isArray(entry?.command) ? entry.command : null;
  const target = entry?.url ?? (command ? command[command.length - 1] : null);
  const local = entry?.type === "local";
  const ok = local ? Boolean(command && command.length > 0 && has(command[command.length - 1])) : Boolean(entry?.url);
  return {
    name,
    type: entry?.type ?? "remote",
    target,
    ok,
  };
});

const entrypoint = has(path.join(installDir, "plugins", "zombiecoder.ts"));
const skillsDir = path.join(installDir, "zombiecoder", "skills");
const catalogDir = path.join(installDir, "zombiecoder", "skills-catalog");
const countMd = (dir) => (has(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".md")).length : 0);
// OpenCode discovers `<config>/skills/<name>/SKILL.md`, not the legacy flat
// store. Count the door that actually loads, and label the old one separately.
const nativeSkillsRoot = path.join(installDir, "skills");
const countNative = (dir) =>
  has(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && has(path.join(dir, entry.name, "SKILL.md")))
        .length
    : 0;
const skills = countMd(skillsDir);
const nativeSkills = countNative(nativeSkillsRoot);
const catalog = countMd(catalogDir);
const model = config.model ?? "(unset)";

const summary = [
  `agents=${agents.length}`,
  `lsp=${lspOk}/${lsp.length}`,
  `mcp=${mcp.length}`,
  `entrypoint=${entrypoint ? "ok" : "missing"}`,
  `skills=${nativeSkills} native`,
  `legacy=${skills}`,
  `model=${model}`,
];
console.log(`config=${configDir} install=${installDir}`);
console.log(summary.join(" "));

console.log(`agents_detail=${agentFiles.length} files: ${agentFiles.join(", ") || "-"}`);
for (const entry of lsp) {
  console.log(`lsp.${entry.name}=${entry.ok ? "ok" : "MISSING"} ${entry.command ?? "(no command)"}`);
}
for (const server of mcp) {
  console.log(`mcp.${server.name}=${server.ok ? "ok" : "MISSING"} ${server.type} ${server.target ?? ""}`.trim());
}
console.log(
  `skills_detail=${nativeSkills} native (${nativeSkillsRoot}), ${skills} legacy flat, ${catalog} in catalog`,
);

const problems = [];
if (agents.length === 0) problems.push("no agents");
if (lsp.length === 0) problems.push("no lsp servers");
for (const entry of lsp) if (!entry.ok) problems.push(`lsp.${entry.name} binary missing`);
if (options.requireMcp && mcp.length === 0) problems.push("no MCP servers configured (--require-mcp)");
for (const server of mcp) {
  if (!server.ok) problems.push(`mcp.${server.name} ${server.type === "local" ? "command" : "url"} missing`);
}
if (!entrypoint) problems.push("plugin entrypoint missing");

if (problems.length > 0) {
  console.log(`FAIL ${problems.join("; ")}`);
  process.exit(1);
}
console.log("PASS install configuration complete");
