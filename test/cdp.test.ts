// CDP wiring regressions: the real server surface, the phase allowlist, and
// the editor-browser fallback every roster agent must know. The map is checked
// against the server source, so a renamed tool cannot silently drift.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROSTER, agentSystemPrompt } from "../src/roster.ts";
import { AGENT_CONTROLLERS } from "../src/agents/index.ts";
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

test("the shared MCP map names every CDP tool", () => {
  for (const name of serverTools("mcp/cdp/server.mjs")) {
    assert.ok(SHARED_EXPERTISE.includes(name), `cdp_${name} is missing from the shared MCP map`);
  }
  assert.match(SHARED_EXPERTISE, /`cdp_\*`: status\/launch\/targets\/navigate/);
});

test("every roster agent knows CDP and the editor-browser fallback", () => {
  for (const agent of ROSTER) {
    const prompt = agentSystemPrompt(agent);
    assert.match(
      prompt,
      /`cdp_\*`: status\/launch\/targets\/navigate\/dom\/markers\/audit\/screenshot\/console\/network\/act\/eval/,
      `${agent.id}: CDP tool surface missing`,
    );
    assert.match(prompt, /CDP_UNAVAILABLE/, `${agent.id}: fallback code missing`);
    assert.match(prompt, /editor `browser` tools \(Chromium\)/, `${agent.id}: editor browser fallback missing`);
    assert.ok(prompt.length < 7000, `${agent.id}: prompt budget exceeded`);
  }
});

test("CDP is allowed where evidence is gathered and denied elsewhere", () => {
  for (const controller of AGENT_CONTROLLERS) {
    for (const phase of ["investigate", "work", "verify"] as const) {
      assert.equal(
        controller.allows("cdp_markers", phase),
        true,
        `${controller.id}: cdp_markers denied in ${phase}`,
      );
    }
    for (const phase of ["propose", "contract", "respond"] as const) {
      assert.equal(
        controller.allows("cdp_markers", phase),
        false,
        `${controller.id}: cdp_markers must stay out of ${phase}`,
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
