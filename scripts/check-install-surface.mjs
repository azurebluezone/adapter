#!/usr/bin/env node
// Installed-surface check: the global install must match the repo plugin graph,
// expose the judge/roadmap/UI code, and load all ten agents in a fresh live
// server whose setup writes the footprint lesson with real problems. The
// shipped prune check must still keep user files and the skill-db.
//
//   node --experimental-strip-types scripts/check-install-surface.mjs
//
// The check reads the real install and starts a real `opencode serve` in an
// isolated data dir; it never trusts the installer log.
//
// Final line: INSTALL_SURFACE_OK

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROSTER } from "../src/roster.ts";
import { ROADMAP_MIN_FILES } from "../src/zombie/roadmap.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_DIR = process.env.ZC_CONFIG_DIR ?? path.join(os.homedir(), ".config", "opencode");
const PLUGIN_DIR = path.join(CONFIG_DIR, "plugins", "zombiecoder");
const OPENCODE = process.env.OPENCODE_BIN ?? "opencode";
const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function walk(base, prefix = "") {
  const files = new Map();
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const rel = prefix ? path.posix.join(prefix, entry.name) : entry.name;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of walk(full, rel)) files.set(key, value);
    } else if (entry.isFile()) {
      files.set(rel, full);
    }
  }
  return files;
}

function graphFiles(base, entries) {
  const files = new Map();
  for (const entry of entries) {
    const full = path.join(base, entry);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isDirectory()) {
      for (const [rel, abs] of walk(full)) files.set(path.posix.join(entry, rel), abs);
    } else {
      files.set(entry, full);
    }
  }
  return files;
}

const ENTRIES = ["plugin.ts", "roster.ts", "agents", "zombie"];

// 1. The installed plugin graph is the repo graph, byte for byte.
const repoGraph = graphFiles(path.join(ROOT, "src"), ENTRIES);
const installedGraph = graphFiles(PLUGIN_DIR, ENTRIES);
const missing = [...repoGraph.keys()].filter((key) => !installedGraph.has(key));
const extra = [...installedGraph.keys()].filter((key) => !repoGraph.has(key));
const changed = [...repoGraph.keys()].filter(
  (key) => installedGraph.has(key) && sha256(repoGraph.get(key)) !== sha256(installedGraph.get(key)),
);
check(
  "installed plugin byte-matches the repo graph",
  missing.length === 0 && extra.length === 0 && changed.length === 0,
  [
    missing.length ? `missing ${missing.slice(0, 3).join(", ")}` : "",
    extra.length ? `extra ${extra.slice(0, 3).join(", ")}` : "",
    changed.length ? `changed ${changed.slice(0, 3).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; "),
);

// 2. The installed runtime carries the new surfaces and no stale label.
const installedServer = fs.readFileSync(path.join(PLUGIN_DIR, "zombie", "server.ts"), "utf8");
const installedPlugin = fs.readFileSync(path.join(PLUGIN_DIR, "plugin.ts"), "utf8");
check(
  "installed server carries the judge, uiCard and roadmap",
  installedServer.includes("intent_judge") &&
    installedServer.includes("uiCard(") &&
    fs.existsSync(path.join(PLUGIN_DIR, "zombie", "roadmap.ts")),
);
check(
  "installed server has no stale preview label",
  !installedServer.includes("goal contract preview"),
);
check(
  "installed setup records footprint health",
  installedPlugin.includes("recordProjectFootprint"),
);

// 3. Every roster agent has its installed markdown file.
const agentDir = path.join(CONFIG_DIR, "agents");
const agentFiles = fs.existsSync(agentDir)
  ? fs.readdirSync(agentDir).filter((name) => name.endsWith(".md"))
  : [];
const missingAgents = ROSTER.map((agent) => agent.id).filter(
  (id) => !agentFiles.includes(`${id}.md`),
);
check(
  "every roster agent has installed markdown",
  missingAgents.length === 0,
  missingAgents.join(", "),
);

// 4. A fresh live server loads the installed plugin and ten agents, then its
//    setup writes the footprint lesson with the real scan problems.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zc-install-surface-"));
const work = path.join(tmp, "work");
const data = path.join(tmp, "data");
fs.mkdirSync(work);
fs.mkdirSync(data);
const password = crypto.randomBytes(16).toString("hex");
const logPath = path.join(tmp, "server.log");
const logFd = fs.openSync(logPath, "a");
let child = null;
let logClosed = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function parseJson(text) {
  const trimmed = String(text ?? "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const line = trimmed
      .split("\n")
      .reverse()
      .find((entry) => entry.trim().startsWith("{"));
    if (!line) return null;
    try {
      return JSON.parse(line.trim());
    } catch {
      return null;
    }
  }
}

function rpc(base, method) {
  const result = spawnSync(
    OPENCODE,
    ["api", "--server", base, "POST", `/api/rpc/zombiecoder/${method}`, "-d", '{"input":{}}'],
    {
      env: { ...process.env, OPENCODE_PASSWORD: password },
      encoding: "utf8",
      timeout: 30000,
    },
  );
  const json = parseJson(result.stdout);
  if (result.status !== 0 || !json) {
    return {
      error: String(result.stderr || result.stdout || "no output").trim().slice(0, 300),
    };
  }
  return { json };
}

try {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  child = spawn(OPENCODE, ["serve", "--port", String(port), "--print-logs"], {
    cwd: work,
    env: { ...process.env, XDG_DATA_HOME: data, OPENCODE_PASSWORD: password },
    stdio: ["ignore", logFd, logFd],
  });
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  let ready = false;
  const readyBy = Date.now() + 45000;
  while (Date.now() < readyBy && !exited) {
    try {
      const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }
  check("fresh live server starts", ready, ready ? base : `see ${logPath}`);

  if (ready) {
    const status = rpc(base, "status");
    const statusOut = status.json?.output ?? {};
    check("fresh server answers the plugin RPC", Boolean(status.json), status.error ?? "");
    check(
      "fresh server reports ten agents",
      statusOut.agents === 10,
      String(statusOut.agents ?? "missing"),
    );
    check(
      "fresh server root is the temp project",
      Boolean(statusOut.root) && fs.realpathSync(statusOut.root) === fs.realpathSync(work),
      String(statusOut.root ?? "missing"),
    );

    const agents = rpc(base, "agents");
    const ids = (agents.json?.output?.agents ?? []).map((agent) => agent.id);
    check(
      "fresh server lists ten agent ids",
      ids.length === 10 && ids.includes("intent-judge"),
      ids.join(", ") || agents.error || "missing",
    );

    const syllabusPath = path.join(work, ".zombiecoder", "syllabus.md");
    let lesson = "";
    const lessonBy = Date.now() + 20000;
    while (Date.now() < lessonBy) {
      lesson = fs.existsSync(syllabusPath) ? fs.readFileSync(syllabusPath, "utf8") : "";
      if (lesson.includes("Project footprint (auto)")) break;
      await sleep(500);
    }
    check("fresh setup writes the footprint lesson", lesson.includes("Project footprint (auto)"));
    check(
      "footprint lesson names a real problem",
      lesson.includes("- No README at the root;"),
    );
    check(
      "small project lesson explains the missing roadmap",
      lesson.includes(`below the ${ROADMAP_MIN_FILES}-file big-project threshold`),
    );
  }
} finally {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    const stopBy = Date.now() + 5000;
    while (!child.killed && Date.now() < stopBy) {
      await sleep(100);
      if (child.exitCode !== null) break;
    }
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (!logClosed) {
    fs.closeSync(logFd);
    logClosed = true;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 5. The shipped prune check still keeps user files and the skill-db.
const assets = spawnSync(
  process.execPath,
  ["--experimental-strip-types", path.join(ROOT, "scripts", "check-install-assets.mjs")],
  { cwd: ROOT, encoding: "utf8", timeout: 110000 },
);
const assetsOut = `${assets.stdout ?? ""}\n${assets.stderr ?? ""}`;
check(
  "shipped install-assets check keeps user files",
  assets.status === 0 && assetsOut.includes("INSTALL_ASSETS_PRUNE_OK"),
  assetsOut.trim().split("\n").filter(Boolean).pop() ?? "no output",
);

// 6. The verified tree is committed and main is in sync with origin.
function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

const branch = git(["branch", "--show-current"]).stdout.trim();
check("branch is main", branch === "main", branch);
const dirty = git(["status", "--porcelain"]).stdout.trim();
check("working tree is clean", dirty === "", dirty.split("\n").slice(0, 3).join(" | "));
const head = git(["rev-parse", "HEAD"]).stdout.trim();
const origin = git(["rev-parse", "origin/main"]).stdout.trim();
check(
  "main is pushed to origin",
  head.length > 0 && head === origin,
  `${head.slice(0, 8)} vs ${origin.slice(0, 8)}`,
);

if (failures.length === 0) {
  console.log("INSTALL_SURFACE_OK");
} else {
  console.error(`INSTALL_SURFACE_FAILED ${failures.join(", ")}`);
  process.exitCode = 1;
}
