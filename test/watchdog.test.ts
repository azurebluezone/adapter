import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { classifyIntent } from "../src/zombie/intent.ts";
import { memoryCompactFile, memoryIndexFile, ssotFile, syllabusFile } from "../src/zombie/paths.ts";
import { startProjectWatchdog, watchProject } from "../src/zombie/watchdog.ts";

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-watchdog-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "ignored"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const live = true;\n");
  fs.writeFileSync(path.join(root, "node_modules", "ignored", "package.json"), "{}\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "fixture", engines: { node: ">=22" }, scripts: { typecheck: "tsc --noEmit", test: "node --test" },
    dependencies: { next: "15.0.0" },
  }), "utf8");
  fs.writeFileSync(path.join(root, "pyproject.toml"), "[project]\nrequires-python = \">=3.11\"\n", "utf8");
  return root;
}

test("watchdog repairs context artifacts, inventories root runtimes, and ignores dependency trees", () => {
  const root = project();
  const first = watchProject(root, ["manu"]);
  assert.equal(first.changed, true);
  for (const file of [ssotFile(root), syllabusFile(root), memoryIndexFile(root), memoryCompactFile(root)]) {
    assert.ok(fs.existsSync(file), file);
  }
  const ssot = fs.readFileSync(ssotFile(root), "utf8");
  assert.match(ssot, /Node\.js \/ JavaScript/);
  assert.match(ssot, /Next\.js/);
  assert.match(ssot, /Python/);
  assert.doesNotMatch(ssot, /node_modules\/ignored/);
  const second = watchProject(root, ["manu"]);
  assert.equal(second.changed, false, "an unchanged project should not append a new footprint");
  fs.rmSync(root, { recursive: true, force: true });
});

test("intent classifier keeps the user request and selects only a bounded slice", () => {
  const intent = classifyIntent("ভাই invoice rounding ঠিক করো src/billing.ts-এ", ["src/billing.ts", "src/other.ts"]);
  assert.equal(intent.kind, "change");
  assert.equal(intent.confidence, "deterministic");
  assert.ok(intent.focus?.primary.some((item) => item.path === "src/billing.ts"));
});

test("watchdog records same-size edits and observed filesystem events", () => {
  const root = project();
  watchProject(root, ["manu"]);
  const target = path.join(root, "src", "app.ts");
  const before = fs.statSync(target);
  fs.writeFileSync(target, "export const live = null;\n");
  fs.utimesSync(target, before.atime, new Date(before.mtimeMs + 2000));
  const report = watchProject(root, ["manu"]);
  assert.equal(report.changed, true);
  assert.ok(report.changes.some((change) => change.path === "src/app.ts" && change.action === "modified"));
  const sameMetadataEvent = watchProject(root, ["manu"], undefined, "src/app.ts");
  assert.equal(sameMetadataEvent.changed, true);
  assert.ok(sameMetadataEvent.changes.some((change) => change.path === "src/app.ts"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("recursive watchdog promptly reconciles an external file change when supported", async () => {
  const root = project();
  watchProject(root, ["manu"]);
  const reports: Array<Awaited<ReturnType<typeof watchProject>>> = [];
  const watcher = startProjectWatchdog(root, ["manu"], undefined, (report) => reports.push(report));
  if (!watcher.supported) {
    watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
    return;
  }
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const live = false;\n");
  try {
    const until = Date.now() + 2500;
    while (reports.length === 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(reports.length > 0, "watcher should reconcile without waiting for the periodic timer");
    assert.ok(reports[0].changes.some((change) => change.path === "src/app.ts"));
  } finally {
    watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
