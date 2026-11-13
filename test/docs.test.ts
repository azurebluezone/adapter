// Documentation consistency: stale circuit-breaker prose must fail the suite.
//
// A code fix that leaves the old handoff promise in README/runtime docs is not
// a fix. These tests make the prose part of the regression surface.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { docsConsistencyProblems } from "../src/zombie/docsConsistency.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-docs-"));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

test("repository documentation no longer promises a cross-agent handoff", () => {
  assert.deepEqual(docsConsistencyProblems(ROOT), []);
});

test("a stale roster-agent switch sentence is rejected with its location", () => {
  const root = fixture({
    "README.md": [
      "# Project",
      "",
      "একই agent retry করে।",
      "session পরের roster agent-এ switch হয়।",
      "acp-client doc lives here.",
    ].join("\n"),
    "docs/AGENT-HANDOFF.md": "acp-client setup lives here.\n",
  });
  const problems = docsConsistencyProblems(root);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, "README.md");
  assert.equal(problems[0].line, 4);
  assert.match(problems[0].reason, /never switches agents/);
});

test("a delegation rule in the syllabus seed is rejected", () => {
  const root = fixture({
    "README.md": "একই এজেন্ট retry করে। acp-client\n",
    "docs/AGENT-HANDOFF.md": "acp-client\n",
    "src/zombie/syllabus.ts": "11. Every agent is a main agent; delegate with a named teammate.\n",
  });
  const problems = docsConsistencyProblems(root);
  assert.ok(problems.some((problem) => problem.file === "src/zombie/syllabus.ts"));
});

test("stale license, runtime version, and mandatory context-call claims are rejected", () => {
  const root = fixture({
    "README.md": [
      "একই agent retry করে।",
      "agent substantive কাজ শুরুর আগে এই tool call করে: context_status",
      "VS Code ACP setup",
    ].join("\n"),
    "docs/AGENT-HANDOFF.md": "ACP setup; OpenCode V2.2.5-এ lsp works.\n",
    "src/identity.ts": "license: Proprietary - Local Freedom Protocol",
    "doc/identity.json": "license: Proprietary - Local Freedom Protocol",
    "src/runtime.ts": "শেষ ৫টি RAM-এ থাকে",
  });

  const problems = docsConsistencyProblems(root);
  assert.ok(problems.length >= 5);
  assert.ok(problems.some((problem) => problem.reason.includes("identity license")));
  assert.ok(problems.some((problem) => problem.reason.includes("generation-time runtime")));
  assert.ok(problems.some((problem) => problem.reason.includes("mandatory call")));
  assert.ok(problems.some((problem) => problem.reason.includes("newest-ten-message")));
});
