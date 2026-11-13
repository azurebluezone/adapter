import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildProjectInvestigation } from "../src/zombie/investigation.ts";
import { readSyllabus } from "../src/zombie/syllabus.ts";

test("project investigation maps evidence and records one reusable, structured session note", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-investigation-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "fixture", engines: { node: ">=20" }, scripts: { test: "node --test" },
  }));
  fs.mkdirSync(path.join(root, "logs"));
  fs.writeFileSync(path.join(root, "logs", "server.log"), "Error: connection refused\n");
  const request = "Check why startup fails in package.json";
  const first = buildProjectInvestigation(root, request, "session-1");
  const syllabus = readSyllabus(root) ?? "";
  assert.equal(first.intent.kind, "inspect");
  assert.equal(first.technologies[0].version, ">=20");
  assert.ok(first.technologies[0].documentation.includes("https://nodejs.org/docs/latest/api/"));
  assert.match(first.modelTrainingData, /UNVERIFIED/);
  assert.match(syllabus, /- Session: session-1/);
  assert.match(syllabus, /- User request: Check why startup fails in package.json/);
  buildProjectInvestigation(root, request, "session-1");
  assert.equal((readSyllabus(root)!.match(/Investigation [a-f0-9]{16}/g) ?? []).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
