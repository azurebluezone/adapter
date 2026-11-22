// CDP wiring regressions: the real server surface, the phase allowlist, and
// the editor-browser fallback every roster agent must know. The map is checked
// against the server source, so a renamed tool cannot silently drift.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROSTER, agentSystemPrompt } from "../src/roster.ts";
import { AGENT_CONTROLLERS } from "../src/agents/index.ts";
import { MCP_PHASES } from "../src/agents/defaults.ts";
import { SHARED_EXPERTISE } from "../src/agents/shared.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

function serverTools(relative: string): string[] {
  const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  return [...source.matchAll(/^ {4}name: "([a-z_]+)",$/gm)].map((match) => match[1]);
}

test("the CDP server exposes the twelve browser tools", () => {
  const tools = serverTools("mcp/cdp/server.mjs");
  assert.deepEqual(tools, [
    "status",
    "launch",
    "targets",
    "navigate",
    "dom",
    "markers",
    "audit",
    "screenshot",
    "console",
    "network",
    "act",
    "eval",
  ]);
  // OpenCode mounts an MCP tool as `<server>_<tool>`; a prefixed server name
  // would produce cdp_cdp_status. The server names must stay unprefixed.
  for (const name of tools) {
    assert.ok(!name.startsWith("cdp_"), `mounted name would double-prefix: cdp_${name}`);
  }
});

test("the bundled CDP server stays discoverable without a plugin hook", () => {
  // The plugin never names the server. The bundled server remains the source
  // of truth, and the prompt teaches the generic environment-owned policy.
  assert.doesNotMatch(SHARED_EXPERTISE, /cdp/i);
  assert.match(SHARED_EXPERTISE, /`mcpAllow` names the namespaces/);
});

test("every roster agent knows MCP is environment-owned and optional", () => {
  for (const agent of ROSTER) {
    const prompt = agentSystemPrompt(agent);
    assert.match(prompt, /MCP surfaces \(optional — environment-provided\)/, `${agent.id}: MCP policy missing`);
    assert.match(prompt, /`mcpAllow`/, `${agent.id}: allowlist missing`);
    assert.match(prompt, /opencode mcp list/, `${agent.id}: live MCP check missing`);
    assert.doesNotMatch(prompt, /cdp_|image-brand|public-api/i, `${agent.id}: prompt hardcodes a server`);
    assert.ok(prompt.length < 7000, `${agent.id}: prompt budget exceeded`);
  }
});

test("MCP phases are read/work/verify and the profile grants none by default", () => {
  assert.deepEqual(MCP_PHASES, ["investigate", "work", "verify"]);
  for (const controller of AGENT_CONTROLLERS) {
    for (const phase of ["propose", "contract", "respond", "intake", "footprint"] as const) {
      assert.equal(
        controller.allows("cdp_markers", phase),
        false,
        `${controller.id}: MCP namespace must stay out of ${phase}`,
      );
    }
  }
});

test("the CDP scripts and files stay wired", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  for (const key of ["mcp:cdp", "mcp:cdp:check", "mcp:cdp:test", "mcp:cdp:live"]) {
    assert.ok(pkg.scripts[key], `package.json script ${key} missing`);
  }
  assert.match(pkg.scripts["mcp:test"], /mcp\/cdp\/test\/\*\.test\.mjs/);
  assert.match(pkg.scripts["mcp:live"], /mcp\/cdp\/e2e-live\.mjs/);

  for (const file of [
    "mcp/cdp/server.mjs",
    "mcp/cdp/selfcheck.mjs",
    "mcp/cdp/e2e-live.mjs",
    "mcp/cdp/test/cdp.test.mjs",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} missing`);
  }

  const installSource = fs.readFileSync(path.join(ROOT, "bin", "install.mjs"), "utf8");
  assert.match(installSource, /server\.name === "cdp" && !names\.includes\("markers"\)/);
});
