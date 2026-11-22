// Capability-map regressions: every roster agent must know the installed skill
// protocol and the image-brand/public-api contracts before the user names them.
// The map is checked against the real server files, so it cannot drift.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROSTER, agentSystemPrompt } from "../src/roster.ts";
import { AGENT_CONTROLLERS } from "../src/agents/index.ts";
import { AGENT_CAPABILITIES } from "../src/agents/shared.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

function serverTools(relative: string): string[] {
  const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  return [...source.matchAll(/^ {4}name: "([a-z_]+)",$/gm)].map((match) => match[1]);
}

test("every roster agent prompt carries the proactive skill protocol", () => {
  for (const agent of ROSTER) {
    const prompt = agentSystemPrompt(agent);
    assert.match(prompt, /## Capabilities/, `${agent.id}: no capability map`);
    assert.match(prompt, /scan `skill`; no match → `skill_catalog` action=auto \(this stack\)/, `${agent.id}: no proactive skill search`);
    assert.match(prompt, /fetches \+ registers/, `${agent.id}: does not know a missing skill is downloaded`);
  }
});

test("every roster agent prompt keeps MCP environment-owned", () => {
  for (const agent of ROSTER) {
    const prompt = agentSystemPrompt(agent);
    assert.match(prompt, /### MCP surfaces \(optional — environment-provided\)/, `${agent.id}: no MCP policy`);
    assert.match(prompt, /mcpAllow/, `${agent.id}: does not know the environment allowlist`);
    assert.match(prompt, /opencode mcp list/, `${agent.id}: no live MCP check`);
    for (const server of ["image-brand", "public-api", "cdp", "missionbarisal"]) {
      assert.doesNotMatch(
        prompt,
        new RegExp(server, "i"),
        `${agent.id}: prompt hardcodes the ${server} server`,
      );
    }
    assert.match(prompt, /before header\/footer copy or images; never invent/, `${agent.id}: exact-size rule missing`);
  }
});

test("the bundled MCP servers keep their tool contracts discoverable", () => {
  // The prompt no longer copies tool schemas. The server remains the source of
  // truth and tools/list is the live proof, so only the server contract is
  // asserted here.
  const imageTools = serverTools("mcp/image-brand/server.mjs").sort();
  const publicTools = serverTools("mcp/public-api/sources.mjs").sort();
  assert.equal(imageTools.length, 6, "image-brand tool count changed");
  assert.equal(publicTools.length, 8, "public-api tool count changed");
  assert.deepEqual(imageTools, [
    "image_batch",
    "image_brand",
    "image_fetch",
    "image_fit",
    "image_search",
    "web_decorate",
  ]);
  assert.ok(publicTools.includes("country"));
  assert.ok(publicTools.includes("qr"));
});

test("every agent can install a skill discovered during work", () => {
  for (const controller of AGENT_CONTROLLERS) {
    assert.equal(controller.allows("skill_catalog", "work"), true, `${controller.id}: skill_catalog denied in work`);
    assert.equal(controller.allows("skill_catalog", "investigate"), true, `${controller.id}: skill_catalog denied in investigate`);
  }
});

test("the exact-size rule and built-in evidence tools survive without MCP", () => {
  assert.match(AGENT_CAPABILITIES, /read px\/columns\/ratio from the project/);
  assert.match(AGENT_CAPABILITIES, /never invent/);
  assert.match(AGENT_CAPABILITIES, /Built-in evidence tools/);
  assert.match(AGENT_CAPABILITIES, /http_probe/);
  assert.match(AGENT_CAPABILITIES, /diagnostics_for_file/);
});
