import test from "node:test";
import assert from "node:assert/strict";
import {
  ENVELOPE_HEADER,
  ENVELOPE_LIMITS,
  buildSubagentEnvelope,
  parseEnvelope,
  renderEnvelope,
  validateEnvelopePrompt,
} from "../src/zombie/subagentEnvelope.ts";
import {
  createInvestigation,
  investigationDigest,
  validateInvestigation,
} from "../src/zombie/investigation.ts";

const investigation = createInvestigation({
  task: "prove the install is duplicate-free",
  project: "zombiecoder-opencode",
  findings: [
    { claim: "one plugin entry", evidence: "find ~/.config/opencode/plugins -name zombiecoder.ts", label: "SOURCE_VERIFIED" },
    { claim: "reinstall is idempotent", evidence: "sha256 before == after", label: "END_TO_END_TESTED" },
  ],
  errors: [],
  skills: ["evidence-before-confidence"],
  constraints: ["do not touch the live config"],
  expected: "ZC_AUDIO_OK",
  uncertainty: ["window title not checked"],
});

test("envelope renders the four required blocks and round-trips", () => {
  const envelope = buildSubagentEnvelope({
    intent: "user wants the five-step plan implemented",
    goal: "ZC_FIVE_STEPS_OK",
    files: ["src/zombie/taskClass.ts", "src/zombie/taskClass.ts", "src/plugin.ts"],
    priorFailures: ["installer forked the config symlink"],
    investigation,
  });
  const prompt = renderEnvelope(envelope);
  assert.ok(prompt.startsWith(ENVELOPE_HEADER));
  assert.equal(prompt.length <= ENVELOPE_LIMITS.chars, true);
  assert.deepEqual(envelope.files, ["src/zombie/taskClass.ts", "src/plugin.ts"], "files are deduped");
  const parsed = parseEnvelope(prompt);
  assert.ok(parsed);
  assert.equal(parsed.intent, envelope.intent);
  assert.equal(parsed.goal, envelope.goal);
  assert.deepEqual(parsed.files, envelope.files);
  assert.deepEqual(parsed.priorFailures, envelope.priorFailures);
});

test("plugin gate refuses a prompt without the envelope", () => {
  const missing = validateEnvelopePrompt("please fix the bug in src/a.ts");
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, [
    "SUBAGENT ENVELOPE header",
    "intent",
    "approved goal",
    "files line",
  ]);
  const partial = validateEnvelopePrompt(`${ENVELOPE_HEADER}\n- Intent: x`);
  assert.equal(partial.ok, false);
  assert.ok(partial.missing.includes("approved goal"));
  const full = renderEnvelope(buildSubagentEnvelope({ intent: "x", goal: "y" }));
  assert.equal(validateEnvelopePrompt(full).ok, true);
});

test("the same investigation schema is used by the envelope and rejects bad evidence labels", () => {
  assert.equal(validateInvestigation(investigation).ok, true);
  const digest = investigationDigest(investigation);
  assert.match(digest, /2 findings/);
  assert.match(digest, /1 uncertainty/);
  const bad = validateInvestigation({
    ...investigation,
    findings: [{ claim: "x", evidence: "y", label: "TRUST_ME" }],
  });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /evidence label/);
  assert.throws(
    () =>
      buildSubagentEnvelope({
        intent: "x",
        investigation: { version: 1, task: "t", project: "p", findings: [{ claim: "c", evidence: "e", label: "MADE_UP" }] },
      }),
    /investigation is invalid/,
  );
  assert.throws(() => buildSubagentEnvelope({ intent: "  " }), /original intent/);
});
