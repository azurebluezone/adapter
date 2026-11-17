// Real language-server tests for the read-only symbol tools. They spawn the
// same typescript-language-server the plugin configures and run against a
// temporary project on disk; when the binary is absent they skip instead of
// pretending a mock proves the behaviour.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveLspServers } from "../src/zombie/lspConfig.ts";
import {
  diagnosticsForFile,
  disposeSymbolServers,
  findReferences,
  findSymbols,
  symbolOverview,
} from "../src/zombie/symbols.ts";

const installRoot = path.join(os.homedir(), ".opencode");
const available = Boolean(resolveLspServers(installRoot).servers.typescript);

let root = "";
let ready = false;

function options() {
  return { root, installRoot };
}

before(() => {
  if (!available) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "zc-symbols-"));
  fs.writeFileSync(
    path.join(root, "a.ts"),
    [
      "export interface Point { x: number; y: number; }",
      "export function add(a: number, b: number): number { return a + b; }",
      'export const bad: number = "not a number";',
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "b.ts"),
    ['import { add } from "./a";', "export const total = add(1, 2);", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
        include: ["*.ts"],
      },
      null,
      2,
    ),
  );
  ready = true;
});

after(() => {
  disposeSymbolServers();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test("symbol_overview returns the real file outline", async (t) => {
  if (!ready) return t.skip("typescript-language-server is not installed");
  const result: any = await symbolOverview({ ...options(), file: "a.ts", depth: -1 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.language_server, "typescript");
  assert.equal(result.path, "a.ts");
  const names = (result.symbols ?? []).map((entry: any) => entry.name);
  assert.ok(names.includes("Point"), `outline names: ${names.join(", ")}`);
  assert.ok(names.includes("add"), `outline names: ${names.join(", ")}`);
});

test("find_symbols finds a top-level function by name", async (t) => {
  if (!ready) return t.skip("typescript-language-server is not installed");
  const result: any = await findSymbols({ ...options(), file: "a.ts", name: "add" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.count, 1);
  assert.equal(result.matches[0].name_path, "add");
  assert.equal(result.matches[0].kind, "function");
});

test("find_references returns the import in the second file", async (t) => {
  if (!ready) return t.skip("typescript-language-server is not installed");
  const result: any = await findReferences({ ...options(), file: "a.ts", namePath: "add" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.count >= 1, JSON.stringify(result));
  assert.ok(
    result.references.some((entry: any) => entry.path === "b.ts"),
    `references: ${JSON.stringify(result.references)}`,
  );
});

test("diagnostics_for_file reports the real type error", async (t) => {
  if (!ready) return t.skip("typescript-language-server is not installed");
  const result: any = await diagnosticsForFile({ ...options(), file: "a.ts", timeoutMs: 8000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.count >= 1, JSON.stringify(result));
  assert.ok(
    result.diagnostics.some(
      (entry: any) => entry.severity === "error" && /not assignable|Type 'string'/i.test(entry.message),
    ),
    `diagnostics: ${JSON.stringify(result.diagnostics)}`,
  );
});
