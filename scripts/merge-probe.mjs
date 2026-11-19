// Release gate for the five-step integration (gc-mwmz9ss6).
//
// A green unit test cannot prove a merge: the branch, the remote head and the
// installed plugin are different artifacts. This probe reads all three and
// prints one token per proven step; any failure exits non-zero.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const FEATURE = process.env.ZC_FEATURE_REF ?? "feat/five-step-enhancement";
const BASE = process.env.ZC_MERGE_BASE ?? "6da6cf3";
const REMOTE = process.env.ZC_REMOTE ?? "origin";
const BRANCH = process.env.ZC_BRANCH ?? "main";
const LIVE = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
  "opencode",
  "plugins",
  "zombiecoder",
);
const COPIED = ["plugin.ts", "roster.ts", "agents", "zombie"];

let failures = 0;

function run(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extraEnv },
  });
  return {
    code: result.status,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function git(...args) {
  return run("git", args);
}

function step(label, fn) {
  try {
    const detail = fn();
    console.log(`${label}${detail ? ` ${detail}` : ""}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${label}: ${error?.message ?? error}`);
  }
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function compareTree(sourceRoot, liveRoot, rel = "") {
  const diffs = [];
  const walk = (rel) => {
    const source = path.join(sourceRoot, rel);
    const live = path.join(liveRoot, rel);
    if (fs.statSync(source).isDirectory()) {
      if (!fs.existsSync(live) || !fs.statSync(live).isDirectory()) {
        diffs.push(`${rel || "."} missing`);
        return;
      }
      for (const entry of fs.readdirSync(source).sort()) walk(path.join(rel, entry));
      return;
    }
    if (!fs.existsSync(live)) {
      diffs.push(`${rel} missing`);
      return;
    }
    if (hash(source) !== hash(live)) diffs.push(`${rel} differs`);
  };
  for (const entry of COPIED) walk(entry);
  return diffs;
}

step("MERGE_OK", () => {
  const parents = git("rev-list", "--parents", "-n", "1", "HEAD").out.split(/\s+/).slice(1);
  must(parents.length === 2, `HEAD is not a merge commit (parents: ${parents.length})`);
  must(git("merge-base", "--is-ancestor", BASE, "HEAD").code === 0, `${BASE} is not an ancestor of HEAD`);
  must(git("merge-base", "--is-ancestor", FEATURE, "HEAD").code === 0, `${FEATURE} is not merged into HEAD`);
  const markers = git("grep", "-n", "-E", "^(<<<<<<< |>>>>>>> )", "--", "*.ts", "*.mjs", "*.md", "*.json");
  must(markers.code !== 0, `conflict markers remain:\n${markers.out}`);
  const dirty = git("status", "--porcelain", "--untracked-files=no").out;
  must(dirty === "", `working tree is not clean after the merge:\n${dirty}`);
  return parents.map((p) => p.slice(0, 7)).join(" + ");
});

step("CHECK_OK", () => {
  const result = run("npm", ["run", "check"]);
  const lines = result.out.split("\n");
  const pass = lines.find((line) => line.includes("pass "));
  const fail = lines.find((line) => line.includes("fail "));
  const summary = [pass, fail].filter(Boolean).join(" ");
  must(result.code === 0, `npm run check exited ${result.code}\n${lines.slice(-25).join("\n")}`);
  must(/fail 0\b/.test(summary), `test summary is not a clean pass: ${summary || "missing"}`);
  return summary.replaceAll("ℹ", "").replaceAll(/\s+/g, " ").trim();
});

step("LIVE_OK", () => {
  must(fs.existsSync(path.join(LIVE, "plugin.ts")), `installed plugin missing at ${LIVE}`);
  const diffs = compareTree(path.join(ROOT, "src"), LIVE);
  must(diffs.length === 0, `installed plugin is stale: ${diffs.slice(0, 6).join(", ")}`);
  return `plugin.ts ${hash(path.join(ROOT, "src", "plugin.ts")).slice(0, 12)}`;
});

step("PUSH_OK", () => {
  const local = git("rev-parse", "HEAD");
  must(local.code === 0, "cannot resolve HEAD");
  const remote = run("git", ["-c", "credential.helper=!gh auth git-credential", "ls-remote", "--heads", REMOTE, BRANCH]);
  must(remote.code === 0, `git ls-remote failed: ${remote.out}`);
  const remoteHead = remote.out.split(/\s+/)[0] ?? "";
  must(remoteHead === local.out, `${REMOTE}/${BRANCH} is ${remoteHead.slice(0, 12) || "missing"}, local HEAD is ${local.out.slice(0, 12)}`);
  return `${REMOTE}/${BRANCH} ${remoteHead.slice(0, 12)}`;
});

if (failures > 0) {
  console.error(`MERGE_GATE_FAILED (${failures} step(s))`);
  process.exit(1);
}
console.log("ZC_MAIN_MERGED_OK");
