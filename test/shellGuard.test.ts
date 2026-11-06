// The shell guard is a parser test, not a regex test: the old pattern produced
// false positives on `2>/dev/null` and `node -e`, so these fixtures pin both
// directions. Ten writes must be caught; ten read-only commands must pass.

import test from "node:test";
import assert from "node:assert/strict";
import { analyzeShell, ledgerTarget, likelyMutatesShell } from "../src/zombie/shellGuard.ts";

const WRITES = [
  "echo hi > out.txt",
  "node build.mjs >> build.log",
  "tee notes.md",
  "cp src/a.ts src/b.ts",
  "mv old.txt new.txt",
  "sed -i 's/a/b/' src/x.ts",
  "python3 -c \"open('x','w').write('y')\"",
  "node -e \"require('fs').writeFileSync('x','y')\"",
  "rm -rf dist",
  "git commit -m 'tighten guard'",
  "chmod 600 .env",
  "curl -o out.json https://example.com/data",
  "npm install",
  "bash -c \"echo x > hidden.txt\"",
];

const READ_ONLY = [
  "git status --short",
  "git diff --stat",
  "npm test",
  "node --test test/shellGuard.test.ts",
  "rg \"foo > bar\" src",
  "echo done 2>/dev/null",
  "node -e \"console.log(1)\"",
  "python3 -c \"print(1)\"",
  "grep -n \"require\" src/plugin.ts",
  "ls -la",
  "sed -n '1,5p' package.json",
  "curl https://example.com/data",
  "cat CHANGELOG.md",
  "bash -c \"git status\"",
];

test("shell guard catches writes that carry no filePath", () => {
  for (const command of WRITES) {
    assert.equal(likelyMutatesShell(command), true, `${command} must count as a write`);
  }
});

test("shell guard keeps read-only commands out of the write gate", () => {
  for (const command of READ_ONLY) {
    assert.equal(likelyMutatesShell(command), false, `${command} must stay read-only`);
  }
});

test("a quoted redirect is data, not a destination", () => {
  const verdict = analyzeShell('echo "a > b"');
  assert.equal(verdict.mutates, false);
  assert.deepEqual(verdict.targets, []);
});

test("the ledger is protected, but a backup away from it is allowed", () => {
  const blocked = [
    "echo x >> .zombiecoder/syllabus.md",
    "cp fake.md .zombiecoder/syllabus.md",
    "mv /tmp/x .zombiecoder/SSOT.md",
    "sed -i s/FAIL/PASS/ .zombiecoder/syllabus.md",
    "tee .zombiecoder/syllabus.md",
    "bash -c \"echo x > .zombiecoder/syllabus.md\"",
  ];
  for (const command of blocked) {
    assert.notEqual(ledgerTarget(command), null, `${command} must be blocked`);
  }
  assert.equal(ledgerTarget("cp .zombiecoder/syllabus.md /tmp/backup.md"), null);
  assert.equal(ledgerTarget("cat .zombiecoder/syllabus.md"), null);
  assert.equal(ledgerTarget("rg syllabus.md src"), null);
});
