// The merge point has to answer one question: whichever agent is running, does
// it carry the ZombieCoder persona exactly once? Roster agents already do (the
// generated markdown embeds it); builtin OpenCode runners do not.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ROSTER,
  SHARED_EXECUTION,
  SHARED_PERSONA,
  SHARED_RULES,
  agentMarkdown,
  mergeAgentPersona,
} from "../src/roster.ts";

test("mergeAgentPersona gives every builtin runner the full shared persona", () => {
  for (const id of ["build", "plan", "general", "explore"]) {
    const persona = mergeAgentPersona(id);
    assert.equal(persona.kind, "shared", `${id} must get the shared persona`);
    assert.match(persona.text, new RegExp(`builtin runner: ${id}`));
    assert.ok(persona.text.includes(SHARED_RULES), `${id}: shared rules missing`);
    assert.ok(persona.text.includes(SHARED_EXECUTION), `${id}: execution doctrine missing`);
    assert.equal(persona.bytes, Buffer.byteLength(persona.text, "utf8"));
    assert.ok(persona.bytes > 0, `${id}: persona must not be empty`);
    assert.ok(persona.bytes < 5000, `${id}: shared persona should stay project-scoped`);
  }
  assert.equal(mergeAgentPersona("my-custom-agent").kind, "shared");
});

test("roster agents expose their full prompt; hidden builtins get nothing", () => {
  for (const agent of ROSTER) {
    const persona = mergeAgentPersona(agent.id);
    assert.equal(persona.kind, "roster", `${agent.id}: roster markdown owns the rules`);
    // The text is returned so the runtime can repair a stale agent file, but the
    // plugin pushes it only when the live system prompt lacks PERSONA_MARKER.
    assert.ok(persona.text.includes(SHARED_RULES), `${agent.id}: shared rules missing`);
    assert.equal(persona.bytes, Buffer.byteLength(persona.text, "utf8"));
  }
  for (const id of ["title", "summary", "compaction", "unknown", "", "   "]) {
    const persona = mergeAgentPersona(id);
    assert.equal(persona.kind, "none", `${JSON.stringify(id)} must stay on the short contract`);
    assert.equal(persona.bytes, 0);
  }
});

test("delegation permissions are limited to bounded work and reviewer targets", async () => {
  const { agentPermissions, allowedSpecialistTargets, canDelegate, MAX_PARALLEL_SPECIALISTS, PERSONA_MARKER } = await import(
    "../src/roster.ts"
  );
  assert.equal(canDelegate("zombiecoder"), true);
  assert.equal(canDelegate("manu"), true);
  assert.equal(canDelegate("nila"), true);
  assert.equal(canDelegate("jarin"), true);
  assert.equal(canDelegate("majnu"), false);
  assert.deepEqual(allowedSpecialistTargets("nila"), ["majnu", "brishti", "jarin"]);
  assert.deepEqual(allowedSpecialistTargets("jarin"), ["majnu"]);
  assert.deepEqual(allowedSpecialistTargets("majnu"), []);
  assert.equal(MAX_PARALLEL_SPECIALISTS, 4);
  for (const agent of ROSTER) {
    const rules = agentPermissions(agent);
    const allowed = allowedSpecialistTargets(agent.id);
    assert.ok(rules.every((rule) => rule.action === "subagent"));
    assert.deepEqual(
      rules.filter((rule) => rule.effect === "allow").map((rule) => rule.resource),
      allowed,
      `${agent.id}: subagent permissions must match the bounded target matrix`,
    );
    if (allowed.length === 0) {
      assert.ok(rules.some((rule) => rule.effect === "deny" && rule.resource === "*"));
    }
  }
  assert.ok(SHARED_RULES.includes(PERSONA_MARKER));
});

test("the roster markdown embeds the shared rules exactly once", () => {
  const markdown = agentMarkdown(ROSTER[0]);
  assert.ok(markdown.includes(SHARED_RULES));
  assert.equal(
    markdown.split("ZombieCoder Shared Rules").length - 1,
    1,
    "the shared block must not be duplicated in a roster prompt",
  );
  assert.ok(SHARED_PERSONA.startsWith(SHARED_RULES));
});

test("shared rules carry project focus, evidence, and concise execution duties", () => {
  assert.match(SHARED_PERSONA, /current user request is the task source/);
  assert.match(SHARED_PERSONA, /business purpose/);
  assert.match(SHARED_PERSONA, /Use the injected request, focus files, and project map/);
  assert.match(SHARED_PERSONA, /Never ship mock\/demo\/placeholder logic/);
  assert.match(SHARED_PERSONA, /session notes/);
  assert.match(SHARED_PERSONA, /private chain-of-thought/);
  assert.match(SHARED_PERSONA, /circuit breaker/);
  assert.match(SHARED_PERSONA, /goal_contract/);
  assert.match(SHARED_PERSONA, /Barishal/);
});
