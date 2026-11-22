#!/usr/bin/env node
// Release gate: install from this checkout into a throwaway root, audit the
// installed tree, and prove origin/main carries the commit under test.
//
//   node scripts/check-release.mjs
//
// Steps:
//   1. run bin/install.mjs into a temp config dir (no npm install, no LSP, no
//      provider probe)
//   2. run scripts/audit-install.mjs against that install and require
//      LIVE_INSTALL_CLEAN_OK
//   3. assert the retired 100c document is absent and the YAML card module is
//      present in the installed tree
//   4. run scripts/check-clone-install.mjs and require CLONE_INSTALL_OK, so a
//      release cannot pass while a stale checkout or a lost user skill regresses
//   5. assert the commit under test is what origin/main points at, and that the
//      new modules and gates are actually tracked in it
//
// Final line: RELEASE_GATE_OK head=… shipped=ok clone=ok

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "bin", "install.mjs");
const AUDIT = path.join(ROOT, "scripts", "audit-install.mjs");
const CLONE_GATE = path.join(ROOT, "scripts", "check-clone-install.mjs");
const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 60000 });
}

function firstLine(result) {
  const text = String(result.stderr || result.stdout || "").trim();
  return text.split("\n").find((line) => line.trim().length > 0) ?? "";
}

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-release-gate-"));
const configDir = path.join(parent, ".opencode");
// The audit treats a missing LSP block as incomplete, and a throwaway HOME has
// no language servers. Plant resolvable stubs (the installer records absolute
// paths; the audit checks existence, not protocol) so the gate exercises the
// same shape a real install has.
const binDir = path.join(parent, "bin");
fs.mkdirSync(binDir, { recursive: true });
for (const name of [
  "typescript-language-server",
  "pyright-langserver",
  "bash-language-server",
  "vscode-json-language-server",
]) {
  const file = path.join(binDir, process.platform === "win32" ? `${name}.cmd` : name);
  fs.writeFileSync(file, "\n");
  if (process.platform !== "win32") fs.chmodSync(file, 0o755);
}
const env = {
  ...process.env,
  HOME: parent,
  XDG_CONFIG_HOME: path.join(parent, ".config"),
  PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
  ZOMBIECODER_BASELINE_MODEL: process.env.ZOMBIECODER_BASELINE_MODEL || "opencode/big-pickle",
};

try {
  const install = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      INSTALLER,
      "--config-dir",
      configDir,
      "--yes",
      "--no-install",
      "--opencode",
      "none",
      "--provider-url",
      "none",
    ],
    { cwd: ROOT, encoding: "utf8", env },
  );
  check("fresh install exits 0", install.status === 0, firstLine(install));

  const audit = spawnSync(process.execPath, [AUDIT, "--config", configDir], {
    cwd: ROOT,
    encoding: "utf8",
    env,
  });
  check("install audit exits 0", audit.status === 0, firstLine(audit));
  check("audit reports a clean shipped tree", /LIVE_INSTALL_CLEAN_OK/.test(audit.stdout), firstLine(audit));
  check("audit summary marks shipped=ok", /shipped=ok/.test(audit.stdout), firstLine(audit));

  const assets = path.join(configDir, "zombiecoder");
  check(
    "retired 100c document is absent",
    !fs.existsSync(path.join(assets, "docs", "100c-runtime-template.md")),
  );
  check(
    "YAML card module is installed",
    fs.existsSync(path.join(configDir, "plugins", "zombiecoder", "zombie", "skillCard.ts")),
  );
  check(
    "skill card module parses YAML",
    fs.existsSync(path.join(configDir, "plugins", "zombiecoder", "zombie", "skillCard.ts")) &&
      /parseYamlSubset/.test(
        fs.readFileSync(path.join(configDir, "plugins", "zombiecoder", "zombie", "skillCard.ts"), "utf8"),
      ),
  );

  // Clone safety is a release condition, not a separate errand: the gate must
  // fail if a stale checkout is no longer refused or a user skill no longer
  // survives a reinstall. It runs in its own throwaway roots.
  const clone = spawnSync(process.execPath, [CLONE_GATE], {
    cwd: ROOT,
    encoding: "utf8",
    env,
    timeout: 240000,
  });
  const cloneTail = String(clone.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
  check("clone-install gate exits 0", clone.status === 0, firstLine(clone));
  check(
    "clone-install gate reports CLONE_INSTALL_OK",
    /CLONE_INSTALL_OK/.test(clone.stdout ?? ""),
    cloneTail,
  );
  check(
    "clone-install gate kept user files and one loader",
    /user skill kept byte-for-byte/.test(clone.stdout ?? "") &&
      /one plugin loader, no duplicate entry/.test(clone.stdout ?? ""),
  );

  const remote = git(["ls-remote", "origin", "refs/heads/main"]);
  const remoteSha = remote.stdout.trim().split(/\s+/)[0] ?? "";
  const head = git(["rev-parse", "HEAD"]);
  const headSha = head.stdout.trim();
  check("origin/main is reachable", remote.status === 0 && /^[0-9a-f]{40}$/.test(remoteSha), firstLine(remote));
  check("origin/main equals the commit under test", remoteSha !== "" && remoteSha === headSha, `${remoteSha.slice(0, 12)} vs ${headSha.slice(0, 12)}`);

  const tracked = new Set(
    git(["ls-tree", "-r", "--name-only", "HEAD"]).stdout.split("\n").filter(Boolean),
  );
  for (const file of [
    "src/zombie/skillCard.ts",
    "src/zombie/skillLibrary.ts",
    "docs/SKILL-LIBRARY.md",
    "scripts/audit-install.mjs",
    "scripts/check-clone-install.mjs",
    "scripts/check-install-assets.mjs",
    "scripts/check-release.mjs",
  ]) {
    check(`commit carries ${file}`, tracked.has(file));
  }
  check(
    "commit no longer carries the retired document",
    !tracked.has("docs/100c-runtime-template.md"),
  );

  if (failures.length === 0) {
    console.log(`RELEASE_GATE_OK head=${headSha.slice(0, 12)} shipped=ok clone=ok`);
  } else {
    console.error(`RELEASE_GATE_FAILED ${failures.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(parent, { recursive: true, force: true });
}
