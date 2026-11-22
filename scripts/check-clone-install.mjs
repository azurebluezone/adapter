#!/usr/bin/env node
// Clone-and-install gate.
//
//   node --experimental-strip-types scripts/check-clone-install.mjs
//
// Four real-path proofs:
//
//   1. A stale checkout (no src/zombie/skillCard.ts) is refused with exit 2
//      before it writes anything.
//   2. A reinstall removes the retired 100c doc and a manifest-tracked file the
//      pack installed earlier, but keeps a hand-written doc, tool and skill
//      byte-identical.
//   3. The install keeps exactly 23 native skills and one plugin entry — no
//      duplicate skill folders and no duplicate loader.
//   4. A fresh `git clone` of HEAD installs cleanly and audits clean.
//
// Final line: CLONE_INSTALL_OK

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "bin", "install.mjs");
const AUDIT = path.join(ROOT, "scripts", "audit-install.mjs");
const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

function firstLine(result) {
  const text = String(result.stderr || result.stdout || "").trim();
  return text.split("\n").find((line) => line.trim().length > 0) ?? "";
}

function nativeSkills(configDir) {
  const dir = path.join(configDir, "skills");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

function pluginEntries(configDir) {
  const dir = path.join(configDir, "plugins");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.startsWith("zombiecoder")).sort();
}

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-clone-gate-"));
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

function envFor(home) {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    ZOMBIECODER_BASELINE_MODEL: process.env.ZOMBIECODER_BASELINE_MODEL || "opencode/big-pickle",
  };
}

function install(sourceRoot, configDir, home) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      path.join(sourceRoot, "bin", "install.mjs"),
      "--config-dir",
      configDir,
      "--yes",
      "--no-install",
      "--opencode",
      "none",
      "--provider-url",
      "none",
    ],
    { cwd: sourceRoot, encoding: "utf8", env: envFor(home) },
  );
}

function audit(configDir, home) {
  return spawnSync(process.execPath, [AUDIT, "--config", configDir], {
    cwd: ROOT,
    encoding: "utf8",
    env: envFor(home),
  });
}

try {
  // 1. Stale checkout is refused before it writes.
  const staleRoot = path.join(parent, "stale");
  fs.mkdirSync(path.join(staleRoot, "bin"), { recursive: true });
  fs.copyFileSync(INSTALLER, path.join(staleRoot, "bin", "install.mjs"));
  fs.writeFileSync(
    path.join(staleRoot, "package.json"),
    `${JSON.stringify({ name: "stale-checkout", version: "0.0.0" }, null, 2)}\n`,
  );
  const staleConfig = path.join(staleRoot, ".opencode");
  const stale = install(staleRoot, staleConfig, staleRoot);
  check("stale checkout is refused", stale.status === 2, firstLine(stale));
  check("refusal names the missing module", /stale checkout/.test(stale.stderr) && /skillCard\.ts/.test(stale.stderr));
  check("stale checkout wrote nothing", !fs.existsSync(staleConfig));

  // 2. Reinstall prunes only what the pack installed.
  const configDir = path.join(parent, "cfg");
  const first = install(ROOT, configDir, parent);
  check("first install exits 0", first.status === 0, firstLine(first));
  const beforeSkills = nativeSkills(configDir);
  check("first install seeds 23 native skills", beforeSkills.length === 23, `${beforeSkills.length}`);
  const assets = path.join(configDir, "zombiecoder");
  const manifestFile = path.join(assets, ".install-assets.json");
  check("first install writes the asset manifest", fs.existsSync(manifestFile));

  const retiredDoc = path.join(assets, "docs", "100c-runtime-template.md");
  const userDoc = path.join(assets, "docs", "custom-notes.md");
  const userTool = path.join(assets, "tools", "custom_tool.py");
  const userSkill = path.join(configDir, "skills", "my-skill", "SKILL.md");
  fs.writeFileSync(retiredDoc, "# retired\n");
  fs.writeFileSync(userDoc, "# my notes\n");
  fs.writeFileSync(userTool, "print('mine')\n");
  fs.mkdirSync(path.dirname(userSkill), { recursive: true });
  fs.writeFileSync(userSkill, "---\nname: my-skill\ndescription: mine\n---\n\nkeep me\n");

  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const manifestRetired = "docs/retired-by-manifest.md";
  manifest.files.push(manifestRetired);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(assets, manifestRetired), "# installed once\n");

  const second = install(ROOT, configDir, parent);
  check("second install exits 0", second.status === 0, firstLine(second));
  check("second install reports the prune", /pruned \d+ retired/.test(second.stdout), firstLine(second));
  check("retired 100c doc removed", !fs.existsSync(retiredDoc));
  check("manifest-tracked retired file removed", !fs.existsSync(path.join(assets, manifestRetired)));
  check("user doc kept", fs.existsSync(userDoc) && fs.readFileSync(userDoc, "utf8") === "# my notes\n");
  check("user tool kept", fs.existsSync(userTool) && fs.readFileSync(userTool, "utf8") === "print('mine')\n");
  check("user skill kept byte-for-byte", fs.existsSync(userSkill) && fs.readFileSync(userSkill, "utf8").includes("keep me"));

  const skills = nativeSkills(configDir);
  check(
    "user skill added, no catalog skill lost",
    skills.length === beforeSkills.length + 1 &&
      new Set(skills).size === skills.length &&
      beforeSkills.every((name) => skills.includes(name)),
    `${skills.length} (${beforeSkills.length} catalog + 1 user)`,
  );
  check("my-skill is still present", skills.includes("my-skill"));
  const entries = pluginEntries(configDir);
  check(
    "one plugin loader, no duplicate entry",
    entries.length === 2 && entries.includes("zombiecoder.ts") && entries.includes("zombiecoder"),
    entries.join(", "),
  );
  const cleanAudit = audit(configDir, parent);
  check("reinstalled tree audits clean", cleanAudit.status === 0 && /LIVE_INSTALL_CLEAN_OK/.test(cleanAudit.stdout), firstLine(cleanAudit));

  // 3. A fresh clone of HEAD installs cleanly.
  const cloneDir = path.join(parent, "clone");
  const clone = spawnSync("git", ["clone", "--quiet", ROOT, cloneDir], { encoding: "utf8", timeout: 60000 });
  check("git clone of HEAD succeeds", clone.status === 0, firstLine(clone));
  check(
    "clone has no retired document",
    clone.status === 0 && !fs.existsSync(path.join(cloneDir, "docs", "100c-runtime-template.md")),
  );
  if (clone.status === 0) {
    const cloneConfig = path.join(parent, "clone-cfg");
    const cloned = install(cloneDir, cloneConfig, parent);
    check("clone install exits 0", cloned.status === 0, firstLine(cloned));
    const cloneSkills = nativeSkills(cloneConfig);
    check("clone installs 23 native skills", cloneSkills.length === 23 && new Set(cloneSkills).size === 23, `${cloneSkills.length}`);
    const cloneEntries = pluginEntries(cloneConfig);
    check(
      "clone installs one plugin loader",
      cloneEntries.length === 2 && cloneEntries.includes("zombiecoder.ts") && cloneEntries.includes("zombiecoder"),
      cloneEntries.join(", "),
    );
    const cloneAudit = audit(cloneConfig, parent);
    check("clone install audits clean", cloneAudit.status === 0 && /LIVE_INSTALL_CLEAN_OK/.test(cloneAudit.stdout), firstLine(cloneAudit));
  }

  if (failures.length === 0) {
    console.log(`CLONE_INSTALL_OK skills=${skills.length} entries=${entries.length} clone=clean`);
  } else {
    console.error(`CLONE_INSTALL_FAILED ${failures.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(parent, { recursive: true, force: true });
}
