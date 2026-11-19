// Release gate for the model-routing rule (gc-mwn0lvlx).
//
// The rule has four different artifacts, so this probe checks all of them:
//   1. the pure assignment function (main unpinned, subagents distinct)
//   2. the repository's own full check (npm run check)
//   3. the live OpenCode config the desktop app actually reads
//   4. the installed plugin graph and the pushed main branch
//
// Any failure exits non-zero. It writes nothing.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const REMOTE = process.env.ZC_REMOTE ?? "origin";
const BRANCH = process.env.ZC_BRANCH ?? "main";
const HOME = os.homedir();
const XDG = process.env.XDG_CONFIG_HOME ?? path.join(HOME, ".config");
const LIVE = path.join(XDG, "opencode", "plugins", "zombiecoder");
const ZOMBIE_CONFIG = path.join(XDG, "opencode", "zombiecoder", "config.json");
const LIVE_CONFIG_CANDIDATES = [
  process.env.ZC_LIVE_OPENCODE,
  path.join(HOME, ".opencode", "opencode.json"),
  path.join(XDG, "opencode", "opencode.json"),
].filter(Boolean);

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

async function stepAsync(label, fn) {
  try {
    const detail = await fn();
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
  const walk = (relPath) => {
    const source = path.join(sourceRoot, relPath);
    const live = path.join(liveRoot, relPath);
    if (fs.statSync(source).isDirectory()) {
      if (!fs.existsSync(live) || !fs.statSync(live).isDirectory()) {
        diffs.push(`${relPath || "."} missing`);
        return;
      }
      for (const entry of fs.readdirSync(source).sort()) walk(path.join(relPath, entry));
      return;
    }
    if (!fs.existsSync(live)) {
      diffs.push(`${relPath} missing`);
      return;
    }
    if (hash(source) !== hash(live)) diffs.push(`${relPath} differs`);
  };
  for (const entry of ["plugin.ts", "roster.ts", "agents", "zombie"]) walk(entry);
  return diffs;
}

function liveConfigFile() {
  const file = LIVE_CONFIG_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  must(file, `no live opencode.json found (looked at ${LIVE_CONFIG_CANDIDATES.join(", ")})`);
  return file;
}

async function main() {
  const models = await import(path.join(ROOT, "src", "zombie", "models.ts"));
  const { ROSTER } = await import(path.join(ROOT, "src", "roster.ts"));
  const { assignModels, MAIN_AGENT_ID } = models;

  step("ASSIGN_OK", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => `probe/model-${index + 1}`);
    const uiModel = candidates[0];
    const assigned = assignModels(ROSTER, candidates, false, Math.random, uiModel, MAIN_AGENT_ID);
    must(assigned[MAIN_AGENT_ID] === "", `${MAIN_AGENT_ID} must stay unpinned, got ${JSON.stringify(assigned[MAIN_AGENT_ID])}`);
    const workers = ROSTER.filter((agent) => agent.id !== MAIN_AGENT_ID);
    const refs = workers.map((agent) => assigned[agent.id]);
    must(refs.every((ref) => typeof ref === "string" && ref.length > 0), "every subagent must receive a model");
    must(new Set(refs).size === refs.length, "subagents must not share a model");
    must(!refs.includes(uiModel), "the UI model must stay with the main agent");
    must(refs.every((ref) => candidates.includes(ref)), "assignment must come from the catalog pool");
    const again = assignModels(ROSTER, candidates, false, Math.random, uiModel, MAIN_AGENT_ID);
    must(JSON.stringify(again) === JSON.stringify(assigned), "assignment must be deterministic");
    const wrapped = assignModels(ROSTER, ["probe/one", "probe/two"], false, Math.random, "probe/one");
    const wrappedRefs = ROSTER.filter((agent) => agent.id !== MAIN_AGENT_ID).map((agent) => wrapped[agent.id]);
    must(wrappedRefs.every((ref) => ref === "probe/two"), "a one-ref pool must wrap without reusing the UI model");
    const empty = assignModels(ROSTER, []);
    must(Object.values(empty).every((ref) => ref === ""), "no catalog ref means no pin at all");
    return `${workers.length} subagents, ${new Set(refs).size} distinct refs`;
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

  step("LIVE_CONFIG_OK", () => {
    const file = liveConfigFile();
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    const rosterIDs = new Set(ROSTER.map((agent) => agent.id));
    const requested = typeof config.default_agent === "string" ? config.default_agent : "";
    const mainAgent = rosterIDs.has(requested) ? requested : MAIN_AGENT_ID;
    const entry = config.agents?.[mainAgent];
    must(entry, `live config has no agent entry for ${mainAgent}`);
    must(entry.model === undefined, `${mainAgent} still carries a model pin (${entry.model})`);
    must(config.model === undefined, `live config still has a root model (${config.model})`);
    const subagents = ROSTER.filter((agent) => agent.id !== mainAgent);
    const refs = subagents.map((agent) => config.agents?.[agent.id]?.model);
    must(refs.every((ref) => typeof ref === "string" && ref.length > 0), "every subagent needs a live model");
    must(new Set(refs).size === refs.length, `subagent models are not distinct: ${refs.join(", ")}`);

    const catalog = run("opencode", ["models"]);
    must(catalog.code === 0, `opencode models exited ${catalog.code}`);
    const known = new Set(
      catalog.out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[\w.-]+\/[\w.:-]+$/.test(line)),
    );
    const unknown = refs.filter((ref) => !known.has(ref));
    must(unknown.length === 0, `pinned refs are not in the live catalog: ${unknown.join(", ")}`);
    return `${mainAgent} unpinned; ${refs.length} distinct subagent models from ${known.size} catalog refs (${path.relative(HOME, file)})`;
  });

  step("PINS_ON_OK", () => {
    const config = JSON.parse(fs.readFileSync(ZOMBIE_CONFIG, "utf8"));
    must(config.agentModelPins === true, `agentModelPins is ${JSON.stringify(config.agentModelPins)}, not true`);
    return "agentModelPins=true";
  });

  step("PLUGIN_OK", () => {
    must(fs.existsSync(path.join(LIVE, "plugin.ts")), `installed plugin missing at ${LIVE}`);
    const diffs = compareTree(path.join(ROOT, "src"), LIVE);
    must(diffs.length === 0, `installed plugin is stale: ${diffs.slice(0, 6).join(", ")}`);
    return `plugin.ts ${hash(path.join(ROOT, "src", "plugin.ts")).slice(0, 12)}`;
  });

  step("PUSH_OK", () => {
    const local = git("rev-parse", "HEAD");
    must(local.code === 0, "cannot resolve HEAD");
    const remote = run("git", [
      "-c",
      "credential.helper=!gh auth git-credential",
      "ls-remote",
      "--heads",
      REMOTE,
      BRANCH,
    ]);
    must(remote.code === 0, `git ls-remote failed: ${remote.out}`);
    const remoteHead = remote.out.split(/\s+/)[0] ?? "";
    must(
      remoteHead === local.out,
      `${REMOTE}/${BRANCH} is ${remoteHead.slice(0, 12) || "missing"}, local HEAD is ${local.out.slice(0, 12)}`,
    );
    return `${REMOTE}/${BRANCH} ${remoteHead.slice(0, 12)}`;
  });

  if (failures > 0) {
    console.error(`AGENT_MODEL_SYNC_GATE_FAILED (${failures} step(s))`);
    process.exit(1);
  }
  console.log("ZC_AGENT_MODEL_SYNC_OK");
}

await main();
