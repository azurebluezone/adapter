import test from "node:test";
import assert from "node:assert/strict";
import {
  TASK_COMPLEXITIES,
  classifyComplexity,
  isTrivialMessage,
} from "../src/zombie/taskClass.ts";
import { beginTurn } from "../src/agents/runtime.ts";
import { releaseCheck } from "../src/agents/route.ts";

test("classifier returns all five levels with honest signals", () => {
  assert.deepEqual([...TASK_COMPLEXITIES], ["trivial", "small", "medium", "substantive", "complex"]);
  const fixtures: Array<[string, boolean, string]> = [
    ["hello", false, "trivial"],
    ["check the node version", false, "small"],
    ["fix the typo in README", true, "medium"],
    ["migrate the database schema", true, "substantive"],
    ["deploy to production and delete the auth secrets", true, "complex"],
  ];
  for (const [message, writeIntent, level] of fixtures) {
    const report = classifyComplexity({ message, writeIntent });
    assert.equal(report.level, level, `${message} -> ${report.level} (${report.signals.join(",")})`);
    assert.ok(report.signals.length > 0);
  }
  assert.equal(classifyComplexity({ message: "hello" }).fastPath, true);
  assert.equal(classifyComplexity({ message: "check the node version" }).fastPath, true);
  // A small write still needs the project contract: the local gate is stricter
  // than the document, and the classifier says so instead of hiding it.
  assert.equal(classifyComplexity({ message: "fix the typo in README", writeIntent: true }).contractRequired, true);
  assert.equal(classifyComplexity({ message: "check the node version" }).contractRequired, false);
  assert.equal(isTrivialMessage("  "), true);
});

test("read-only fast path answers without the footprint walk, writes do not", () => {
  const small = beginTurn({
    sessionID: "ses_class_small",
    agentID: "zombiecoder",
    message: "check the node version",
  });
  assert.equal(small.run.taskKind, "readonly");
  assert.equal(small.run.complexity, "small");
  assert.equal(small.run.fastPath, true);
  assert.equal(small.run.phase, "intake", "fast path must not pay for footprint/investigate");
  assert.equal(releaseCheck(small.run).ok, true);

  const write = beginTurn({
    sessionID: "ses_class_write",
    agentID: "zombiecoder",
    message: "fix the typo in README",
  });
  assert.equal(write.run.taskKind, "substantive");
  assert.equal(write.run.complexity, "medium");
  assert.equal(write.run.fastPath, false);
  assert.equal(releaseCheck(write.run).ok, false, "a write without a PASS contract must stay blocked");
  assert.match(releaseCheck(write.run).reason, /contract/i);
});

test("domain routing assigns a bounded owner and minimum process", () => {
  const cases = [
    ["Node API slow fix", "performance", "rashed"],
    ["CSS button align", "ui", "nila"],
    ["database migration", "architecture", "manu"],
    ["security issue", "security", "brishti"],
    ["README docs mismatch", "documentation", "halim"],
  ] as const;
  for (const [message, domain, owner] of cases) {
    const turn = beginTurn({ sessionID: `ses_domain_${owner}`, agentID: "zombiecoder", message });
    assert.equal(turn.run.domain, domain, `${message} domain`);
    assert.equal(turn.run.domainOwner, owner, `${message} owner`);
    assert.ok((turn.run.minimumProcess?.length ?? 0) >= 3, `${message} must name a minimum process`);
  }
});

test("a trivial turn is still classified trivial and releasable", () => {
  const turn = beginTurn({ sessionID: "ses_class_hi", agentID: "zombiecoder", message: "hello" });
  assert.equal(turn.run.complexity, "trivial");
  assert.equal(releaseCheck(turn.run).ok, true);
});
