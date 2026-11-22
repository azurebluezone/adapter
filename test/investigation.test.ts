import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildProjectInvestigation } from "../src/zombie/investigation.ts";
import { readSyllabus } from "../src/zombie/syllabus.ts";

test("project investigation maps evidence and records one reusable, structured session note", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-investigation-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "fixture", engines: { node: ">=20" }, scripts: { test: "node --test" },
  }));
  fs.mkdirSync(path.join(root, "logs"));
  fs.writeFileSync(path.join(root, "logs", "server.log"), "Error: connection refused\n");
  const request = "Check why startup fails in package.json";
  const first = await buildProjectInvestigation(root, request, "session-1");
  const syllabus = readSyllabus(root) ?? "";
  assert.equal(first.intent.kind, "inspect");
  assert.equal(first.technologies[0].version, ">=20");
  assert.ok(first.technologies[0].documentation.includes("https://nodejs.org/docs/latest/api/"));
  assert.match(first.modelTrainingData, /UNVERIFIED/);
  assert.equal(first.focusCard.scope, "local");
  assert.match(syllabus, /- Session: session-1/);
  assert.match(syllabus, /- User request: Check why startup fails in package.json/);
  await buildProjectInvestigation(root, request, "session-1");
  assert.equal((readSyllabus(root)!.match(/Investigation [a-f0-9]{16}/g) ?? []).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("an external research request probes its URLs and returns a focus card", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-investigation-url-"));
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: any) => {
    seen.push(String(input));
    return new Response("<html><title>Repo fixture</title></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;
  try {
    const request = "Compare https://example.test/one and https://example.test/two, then cite each claim";
    const result = await buildProjectInvestigation(root, request, "session-url");
    assert.deepEqual(seen.sort(), ["https://example.test/one", "https://example.test/two"]);
    assert.equal(result.focusCard.scope, "external");
    assert.equal(result.sources.length, 2);
    assert.equal(result.sources.every((source) => source.ok && source.status === 200), true);
    assert.equal(result.focusCard.known.length, 2);
    assert.equal(result.focusCard.missing.length, 0);
    assert.match(result.focusCard.next, /cite the URL/);
    assert.match(readSyllabus(root) ?? "", /- Sources: https:\/\/example\.test\/one \(200\)/);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
