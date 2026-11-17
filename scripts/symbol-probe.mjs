#!/usr/bin/env node
// Live probe for the read-only symbol tools.
//
// Creates a temporary TypeScript project, calls all four module functions
// against the real language server the plugin configures, and prints
// SYMBOL_PROBE_OK only when every call returned real data. No fixture is
// mocked: the server is spawned and answers over JSON-RPC.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const {
  diagnosticsForFile,
  disposeSymbolServers,
  findReferences,
  findSymbols,
  symbolOverview,
} = await import("../src/zombie/symbols.ts");

const installRoot = join(homedir(), ".opencode");
const root = mkdtempSync(join(tmpdir(), "zc-symbol-probe-"));
const options = { root, installRoot };

let failure = null;
try {
  writeFileSync(
    join(root, "a.ts"),
    [
      "export interface Point { x: number; y: number; }",
      "export function add(a: number, b: number): number { return a + b; }",
      'export const bad: number = "not a number";',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "b.ts"),
    ['import { add } from "./a";', "export const total = add(1, 2);", ""].join("\n"),
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
        include: ["*.ts"],
      },
      null,
      2,
    ),
  );

  const overview = await symbolOverview({ ...options, file: "a.ts", depth: -1 });
  const symbols = await findSymbols({ ...options, file: "a.ts", name: "add" });
  const references = await findReferences({ ...options, file: "a.ts", namePath: "add" });
  const diagnostics = await diagnosticsForFile({ ...options, file: "a.ts", timeoutMs: 8000 });

  const checks = {
    overview: overview.ok === true && Number(overview.count) > 0,
    symbols: symbols.ok === true && Number(symbols.count) === 1,
    references:
      references.ok === true &&
      Array.isArray(references.references) &&
      references.references.some((entry) => entry.path === "b.ts"),
    diagnostics:
      diagnostics.ok === true &&
      Array.isArray(diagnostics.diagnostics) &&
      diagnostics.diagnostics.some((entry) => entry.severity === "error"),
  };

  process.stdout.write(
    `${JSON.stringify(
      {
        checks,
        overview: { ok: overview.ok, count: overview.count, server: overview.language_server },
        symbols: { ok: symbols.ok, count: symbols.count },
        references: {
          ok: references.ok,
          count: references.count,
          paths: Array.isArray(references.references) ? references.references.map((entry) => entry.path) : [],
        },
        diagnostics: {
          ok: diagnostics.ok,
          count: diagnostics.count,
          source: diagnostics.source,
          messages: Array.isArray(diagnostics.diagnostics)
            ? diagnostics.diagnostics.slice(0, 2).map((entry) => entry.message)
            : [],
        },
      },
      null,
      2,
    )}\n`,
  );

  if (!Object.values(checks).every(Boolean)) failure = "one or more symbol checks failed";
} catch (error) {
  failure = error?.stack ?? String(error);
} finally {
  disposeSymbolServers();
  rmSync(root, { recursive: true, force: true });
}

if (failure) {
  console.error(`SYMBOL_PROBE_FAILED: ${failure}`);
  process.exit(1);
}
console.log("SYMBOL_PROBE_OK");
