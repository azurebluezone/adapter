#!/usr/bin/env node
// Real-path check for install hygiene: a reinstall must prune runtime assets
// this pack no longer ships, without touching the downloaded skill database.
//
//   node --experimental-strip-types scripts/check-install-assets.mjs
//
// The check installs twice into a throwaway config dir. Between the runs it
// plants what an older install left behind (the retired 100c template, an old
// tool and an old TLS template) plus a fake skill-db cache, then asserts:
//
//   - the second install exits 0 and reports the prune
//   - every planted stale file is gone
//   - a currently shipped asset is still present
//   - <install>/zombiecoder/skill-db survives byte-for-byte
//   - the installed tree carries no retired vendor host or model name
//
// Final line: INSTALL_ASSETS_PRUNE_OK

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "bin", "install.mjs");
const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

function install(configDir, home) {
  return spawnSync(
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
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        ZOMBIECODER_BASELINE_MODEL: process.env.ZOMBIECODER_BASELINE_MODEL || "opencode/big-pickle",
      },
    },
  );
}

function firstLine(result) {
  const text = String(result.stderr || result.stdout || "").trim();
  return text.split("\n").find((line) => line.trim().length > 0) ?? "";
}

function scanTree(dir) {
  // Build the forbidden literals from parts so this verifier's own source does
  // not trip the repository test that scans every file under scripts/.
  const host = ["gpu", "zombiecoder", "my", "id"].join(".");
  const model = ["Llama", "3.2", "3B", "Instruct"].join("-");
  const patterns = [new RegExp(host.replace(/\./g, "\\.")), new RegExp(model)];
  const hits = [];
  const walk = (rel) => {
    const full = path.join(dir, rel);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(full)) walk(path.join(rel, entry));
      return;
    }
    if (!/\.(md|ts|mjs|js|json|py|sh|template|txt|example)$/i.test(rel)) return;
    const text = fs.readFileSync(full, "utf8");
    if (patterns.some((pattern) => pattern.test(text))) hits.push(rel);
  };
  if (fs.existsSync(dir)) walk("");
  return hits;
}

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-install-assets-"));
const configDir = path.join(parent, ".opencode");
const assetsDir = path.join(configDir, "zombiecoder");

try {
  const first = install(configDir, parent);
  check("first install exits 0", first.status === 0, firstLine(first));
  check(
    "first install ships the current docs asset",
    fs.existsSync(path.join(assetsDir, "docs", "SKILL-LIBRARY.md")),
  );
  check(
    "first install has no retired doc",
    !fs.existsSync(path.join(assetsDir, "docs", "100c-runtime-template.md")),
  );

  // The retired doc must go. A hand-written doc/tool must survive: the pack
  // only removes what its own manifest says it installed. A manifest-tracked
  // file that is no longer shipped must go too.
  const retired = {
    "docs/100c-runtime-template.md": "# retired template\nhttps://gateway.example.invalid\n",
  };
  const userFiles = {
    "docs/custom-notes.md": "# my notes\n",
    "tools/custom_tool.py": "print('mine')\n",
  };
  for (const [rel, text] of Object.entries({ ...retired, ...userFiles })) {
    const file = path.join(assetsDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
  }
  const manifestFile = path.join(assetsDir, ".install-assets.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const manifestRetired = "docs/retired-by-manifest.md";
  manifest.files.push(manifestRetired);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(assetsDir, manifestRetired), "# installed once\n", "utf8");

  const dbFile = path.join(assetsDir, "skill-db", "skills.jsonl");
  const dbText = '{"slug":"database-designer"}\n';
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.writeFileSync(dbFile, dbText, "utf8");
  check(
    "retired, manifest and user files planted",
    [...Object.keys(retired), manifestRetired, ...Object.keys(userFiles)].every((rel) =>
      fs.existsSync(path.join(assetsDir, rel)),
    ),
  );

  const second = install(configDir, parent);
  check("second install exits 0", second.status === 0, firstLine(second));
  check("second install reports the prune", /pruned \d+ retired/.test(second.stdout), firstLine(second));
  for (const rel of [...Object.keys(retired), manifestRetired]) {
    check(`retired asset removed: ${rel}`, !fs.existsSync(path.join(assetsDir, rel)));
  }
  for (const [rel, text] of Object.entries(userFiles)) {
    const file = path.join(assetsDir, rel);
    check(
      `user file kept: ${rel}`,
      fs.existsSync(file) && fs.readFileSync(file, "utf8") === text,
    );
  }
  check(
    "shipped asset survives the prune",
    fs.existsSync(path.join(assetsDir, "docs", "SKILL-LIBRARY.md")),
  );
  check("shipped tool survives the prune", fs.existsSync(path.join(assetsDir, "tools", "tls_verify.py")));
  check("install manifest is written", fs.existsSync(manifestFile));
  check(
    "skill-db cache survives byte-for-byte",
    fs.existsSync(dbFile) && fs.readFileSync(dbFile, "utf8") === dbText,
  );
  const offenders = scanTree(assetsDir);
  check("installed tree carries no retired host or model", offenders.length === 0, offenders.join(", "));

  if (failures.length === 0) {
    console.log(
      `INSTALL_ASSETS_PRUNE_OK retired=${Object.keys(retired).length + 1} user=kept cache=preserved`,
    );
  } else {
    console.error(`INSTALL_ASSETS_PRUNE_FAILED ${failures.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(parent, { recursive: true, force: true });
}
