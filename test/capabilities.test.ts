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

test("every roster agent prompt names the branding and API surfaces", () => {
  for (const agent of ROSTER) {
    const prompt = agentSystemPrompt(agent);
    assert.match(prompt, /`image-brand_image_brand` \{input, title, canvas:\{width,height\}\}/, `${agent.id}: no exact canvas contract`);
    assert.match(prompt, /`image-brand_image_fit` \{input, width, height\}/, `${agent.id}: no exact image_fit contract`);
    assert.match(prompt, /`public-api_\*`: wiki_search, wiki_page, wiki_onthisday, wiki_featured, weather, currency, country, qr \{data, size\}/, `${agent.id}: public-api map missing`);
    assert.match(prompt, /before header\/footer copy or images; never invent/, `${agent.id}: exact-size rule missing`);
  }
});

test("the capability map covers every mounted MCP tool", () => {
  const imageTools = serverTools("mcp/image-brand/server.mjs").sort();
  const publicTools = serverTools("mcp/public-api/sources.mjs").sort();
  assert.equal(imageTools.length, 6, "image-brand tool count changed");
  assert.equal(publicTools.length, 8, "public-api tool count changed");
  for (const name of imageTools) {
    // Compact map: full name for the two exact-size tools, short verb otherwise.
    const short = name.replace(/^image_/, "").replace(/^web_/, "");
    assert.ok(
      AGENT_CAPABILITIES.includes(`image-brand_${name}`) || AGENT_CAPABILITIES.includes(short),
      `image-brand_${name} is not mentioned in the capability map`,
    );
  }
  for (const name of publicTools) {
    assert.ok(AGENT_CAPABILITIES.includes(name), `public-api_${name} is not mentioned in the capability map`);
  }
});

test("every agent can install a skill discovered during work", () => {
  for (const controller of AGENT_CONTROLLERS) {
    assert.equal(controller.allows("skill_catalog", "work"), true, `${controller.id}: skill_catalog denied in work`);
    assert.equal(controller.allows("skill_catalog", "investigate"), true, `${controller.id}: skill_catalog denied in investigate`);
  }
});

test("the exact-size rule forbids inventing a size", () => {
  assert.match(AGENT_CAPABILITIES, /read px\/columns\/ratio from the project/);
  assert.match(AGENT_CAPABILITIES, /never invent/);
  assert.match(AGENT_CAPABILITIES, /canvas:\{width,height\}/);
  assert.match(AGENT_CAPABILITIES, /qr \{data, size\}/);
});
