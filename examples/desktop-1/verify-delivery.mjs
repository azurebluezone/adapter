#!/usr/bin/env node
/**
 * Delivery verifier for the ZombieCoder adapter release.
 *
 * Every check reads a real file, a real git ref, or a command result. A claim
 * that has no evidence is a FAIL, never a warning. The script exits 0 and
 * prints ZC_DELIVERY_OK only when all checks pass.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DESKTOP = "/home/sahon/Desktop/1";
const REPORT = join(DESKTOP, "report.html");
const RUN_JSON = join(DESKTOP, "run.json");
const BROWSER = join(DESKTOP, "browser.json");
const PROOF = join(DESKTOP, "install-proof.json");

const AGENTS = ["zombiecoder", "manu", "nila", "tuhin", "jarin", "brishti", "rashed", "halim", "majnu"];
const HEADINGS = ["Who did what", "Who got what", "Who did not get", "How reality works"];
const FALLBACKS = [
  ["install.sh", "FALLBACK_CHECKOUT"],
  ["install.sh", "FALLBACK_DOWNLOAD"],
  ["bin/install.mjs", "FALLBACK_NPM"],
  ["bin/install.mjs", "FALLBACK_LSP"],
  ["bin/install.mjs", "FALLBACK_MCP"],
];

const checks = [];
function record(id, ok, detail) {
  checks.push({ id, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${id}: ${detail}`);
}

function git(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function read(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

// 1. Git state: HEAD, the working branch and main all point at the same commit.
try {
  const head = git(["rev-parse", "HEAD"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const remoteBranch = git(["ls-remote", "origin", `refs/heads/${branch}`]).split(/\s+/)[0];
  const remoteMain = git(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
  const ok = head === remoteBranch && head === remoteMain;
  record("git-push", ok, `HEAD ${head.slice(0, 7)} | origin/${branch} ${String(remoteBranch).slice(0, 7)} | origin/main ${String(remoteMain).slice(0, 7)}`);
} catch (error) {
  record("git-push", false, String(error?.message ?? error));
}

// 2. Documentation carries the release marker and the run section.
try {
  const readme = read(join(REPO, "README.md"));
  const ok = readme.includes("ZC_DELIVERY_DOCS") && /Desktop\/1/.test(readme) && /install\.sh/.test(readme);
  record("docs", ok, ok ? "README.md carries ZC_DELIVERY_DOCS + installer + Desktop/1" : "README.md is missing the release section");
} catch (error) {
  record("docs", false, String(error?.message ?? error));
}

// 3. Inline installer proof: a real non-TTY run wrote a PASS proof file.
try {
  const proof = JSON.parse(read(PROOF) || "null");
  const ok = proof?.schema === "zombiecoder.install-proof/1" && proof?.verdict === "PASS";
  record(
    "inline-install",
    Boolean(ok),
    ok
      ? `${proof.summary.pass}/${proof.summary.total} checks passed; source=${proof.install?.sourceKind}`
      : "install-proof.json missing or verdict != PASS",
  );
} catch (error) {
  record("inline-install", false, String(error?.message ?? error));
}

// 4. Fallback markers exist in the real source of both installer layers.
try {
  const missing = FALLBACKS.filter(([file, marker]) => !read(join(REPO, file)).includes(marker));
  record("fallbacks", missing.length === 0, missing.length === 0 ? "5 fallback markers present" : `missing ${missing.map(([f, m]) => `${m} in ${f}`).join(", ")}`);
} catch (error) {
  record("fallbacks", false, String(error?.message ?? error));
}

// 5. Test suite passes from scratch.
try {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", ...["agents", "route", "wiring", "install", "goalContract", "docs"].map((name) => `test/${name}.test.ts`)],
    { cwd: REPO, encoding: "utf8", timeout: 300000 },
  );
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const passed = /# pass (\d+)/.exec(out)?.[1] ?? "0";
  const failed = /# fail (\d+)/.exec(out)?.[1] ?? "?";
  record("tests", result.status === 0, `exit ${result.status}; pass ${passed}, fail ${failed}`);
} catch (error) {
  record("tests", false, String(error?.message ?? error));
}

// 6. Installed configuration: 9 agents, 3 MCP servers, 7 LSP servers.
try {
  const result = spawnSync(process.execPath, ["scripts/audit-install.mjs"], { cwd: REPO, encoding: "utf8", timeout: 120000 });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const agents = /agents=(\d+)/.exec(out)?.[1];
  const mcp = /mcp=(\d+)/.exec(out)?.[1];
  const lsp = /lsp=(\d+)/.exec(out)?.[1];
  const ok = result.status === 0 && agents === "9" && mcp === "3" && lsp === "7";
  record("config-audit", ok, `exit ${result.status}; agents=${agents}, mcp=${mcp}, lsp=${lsp}`);
} catch (error) {
  record("config-audit", false, String(error?.message ?? error));
}

// 7. The example folder and its brief exist in the repo.
try {
  const ok = statSync(join(REPO, "examples/desktop-1/input.md")).size > 0 && statSync(join(REPO, "examples/desktop-1/README.md")).size > 0;
  record("example-folder", ok, "examples/desktop-1/input.md + README.md present");
} catch (error) {
  record("example-folder", false, String(error?.message ?? error));
}

// 8. The report names all nine agents and the four attribution sections.
try {
  const html = read(REPORT);
  const missingAgents = AGENTS.filter((id) => !new RegExp(`\\b${id}\\b`, "i").test(html));
  const missingHeadings = HEADINGS.filter((heading) => !html.toLowerCase().includes(heading.toLowerCase()));
  const ok = Boolean(html) && missingAgents.length === 0 && missingHeadings.length === 0;
  record(
    "report",
    ok,
    ok
      ? `report.html ${statSync(REPORT).size}B; 9 agents + 4 headings present`
      : `missing agents: ${missingAgents.join(", ") || "-"}; missing headings: ${missingHeadings.join(", ") || "-"}`,
  );
} catch (error) {
  record("report", false, String(error?.message ?? error));
}

// 9. run.json records one row per agent with a real status.
try {
  const rows = JSON.parse(read(RUN_JSON) || "[]");
  const named = new Set(rows.map((row) => String(row.agent ?? "").toLowerCase()));
  const ok = Array.isArray(rows) && AGENTS.every((id) => named.has(id)) && rows.every((row) => row.status && row.evidence !== undefined);
  record("run-json", ok, Array.isArray(rows) ? `${rows.length} rows; ${AGENTS.filter((id) => named.has(id)).length}/9 agents named` : "run.json is not an array");
} catch (error) {
  record("run-json", false, String(error?.message ?? error));
}

// 10. The report was really opened in a browser (recorded URL + title).
try {
  const browser = JSON.parse(read(BROWSER) || "null");
  const ok = Boolean(browser?.url?.startsWith("file://")) && Boolean(browser?.title) && Boolean(browser?.openedAt);
  record("browser-open", ok, ok ? `${browser.title} — ${browser.url}` : "browser.json missing url/title/openedAt");
} catch (error) {
  record("browser-open", false, String(error?.message ?? error));
}

const failed = checks.filter((check) => !check.ok);
console.log("-".repeat(72));
if (failed.length > 0) {
  console.log(`ZC_DELIVERY_FAIL — ${failed.length}/${checks.length} checks failed: ${failed.map((c) => c.id).join(", ")}`);
  process.exit(1);
}
console.log(`ZC_DELIVERY_OK — ${checks.length}/${checks.length} checks passed`);
