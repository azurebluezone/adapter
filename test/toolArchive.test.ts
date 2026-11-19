import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ARCHIVE_THRESHOLD,
  archiveToolResult,
  extractToolOutput,
  readArchivedResult,
} from "../src/zombie/toolArchive.ts";

test("a small result stays inline; a large result becomes an artifact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-archive-"));
  try {
    const small = archiveToolResult({ root, tool: "read", output: "short output" });
    assert.equal(small.archived, false);
    assert.equal(small.truncated, false);
    assert.match(small.preview, /short output/);

    const body = `Bearer supersecret-token\n${"x".repeat(ARCHIVE_THRESHOLD + 100)}`;
    const large = archiveToolResult({ root, tool: "shell", output: body });
    assert.equal(large.archived, true);
    assert.equal(large.truncated, true);
    assert.ok(large.file?.startsWith(".zombiecoder/tool-results/"));
    assert.ok(large.bytes > ARCHIVE_THRESHOLD);
    const absolute = path.join(root, large.file!);
    assert.ok(fs.existsSync(absolute), "the archive must be on disk");
    const stored = fs.readFileSync(absolute, "utf8");
    assert.match(stored, /Bearer \[REDACTED\]/, "secrets must not be persisted");
    assert.equal(readArchivedResult(root, large.file!), stored);
    assert.equal(readArchivedResult(root, "../../etc/passwd"), null, "path traversal must be refused");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the after-hook output is unwrapped, readable text first", () => {
  assert.equal(extractToolOutput({ output: "legacy" }), "legacy");
  assert.equal(
    extractToolOutput({ result: { output: { exitCode: 0 }, content: "real stdout" } }),
    "real stdout",
    "string content wins over the structured output",
  );
  assert.equal(
    extractToolOutput({ result: { content: [{ text: "line one" }, { text: "line two" }] } }),
    "line one\nline two",
  );
  const structured = { exitCode: 1, stderr: "boom" };
  assert.deepEqual(extractToolOutput({ result: { output: structured } }), structured);
  assert.deepEqual(extractToolOutput({ result: structured }), structured);
});
