import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../src/zombie/scan.ts";
import { redact } from "../src/zombie/io.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("installer/runtime sources do not duplicate provider defaults or credentials", () => {
  const files = [
    ...sourceFiles(path.join(ROOT, "src")),
    ...sourceFiles(path.join(ROOT, "bin")),
    ...sourceFiles(path.join(ROOT, "scripts")),
  ];
  const relative = (file: string) => path.relative(ROOT, file);
  const contents = files.map((file) => ({ file: relative(file), text: fs.readFileSync(file, "utf8") }));

  const onlyIn = (pattern: RegExp, allowed: readonly string[]) => {
    const hits = contents.filter(({ text }) => pattern.test(text)).map(({ file }) => file).sort();
    assert.deepEqual(hits, [...allowed].sort(), `${pattern} must live only in ${allowed.join(", ")}`);
  };

  assert.doesNotMatch(contents.find(({ file }) => file === "src/zombie/defaults.ts")?.text ?? "", /127\.0\.0\.1:49374/);
  // The plugin is self-dependent: no Mission Barisal hook may ship in runtime
  // sources. A machine without that server must lose nothing but its tools.
  // Runtime sources ship no hook. The verification script is allowed to name
  // the forbidden surface because it checks for its absence.
  onlyIn(/missionbarisal/i, ["scripts/verify-wiring.mjs"]);
  assert.doesNotMatch(
    contents.find(({ file }) => file === "src/zombie/defaults.ts")?.text ?? "",
    /missionbarisal/i,
    "src/zombie/defaults.ts still ships the vendor provider id",
  );
  assert.doesNotMatch(contents.find(({ file }) => file === "src/roster.ts")?.text ?? "", /opencode\/big-pickle/);

  // A shipped vendor gateway host is a hardcoded decision the owner cannot see.
  const shippedHost = contents
    .filter(({ text }) => /gpu\.zombiecoder\.my\.id/.test(text))
    .map(({ file }) => file);
  assert.deepEqual(shippedHost, [], "runtime sources still ship the vendor gateway host");

  for (const { file, text } of contents) {
    assert.doesNotMatch(text, /apiKey\s*:\s*["']public["']/, `${file} still hardcodes a fake credential`);
    assert.doesNotMatch(text, /\.archive-2026-10-19/, `${file} still carries a project-specific ignore path`);
    if (file === "scripts/verify-wiring.mjs") continue; // names it only to prove absence
    assert.doesNotMatch(text, /missionbarisal/i, `${file} still references Mission Barisal`);
  }
});

test("redact removes bearer tokens and key assignments from reports", () => {
  assert.equal(
    redact("Authorization: Bearer zc-super-secret"),
    "Authorization: Bearer [REDACTED]",
  );
  assert.equal(redact("apiKey=abc123 token: xyz"), "apiKey=[REDACTED] token: [REDACTED]");
  assert.doesNotMatch(redact("contact user@example.test"), /\[REDACTED\]/);
});

test("scanProject does not silently ignore an archive-looking directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-scan-"));
  const hidden = path.join(root, ".archive-2026-10-19");
  fs.mkdirSync(hidden, { recursive: true });
  fs.writeFileSync(path.join(hidden, "note.txt"), "keep me\n");
  const fp = scanProject(root);
  assert.ok(fp.files.includes(".archive-2026-10-19/note.txt"));
  assert.ok(!fp.ignored.includes(".archive-2026-10-19"));
  fs.rmSync(root, { recursive: true, force: true });
});
