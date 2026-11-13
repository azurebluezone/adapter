// Project watchdog: keep plugin-owned context artifacts present and coherent.
// It performs bounded, local, idempotent maintenance only. It never executes a
// project command, contacts the network, or rewrites user source files.

import * as fs from "node:fs";
import * as path from "node:path";
import { bootstrapDirs, memoryCompactFile, memoryIndexFile, ssotFile, syllabusFile } from "./paths.ts";
import { readJson, redact, sha256, writeJson } from "./io.ts";
import { DEFAULT_IGNORE, scanProject, type Fingerprint } from "./scan.ts";
import { writeSsot } from "./ssot.ts";
import { ensureSyllabus, recordProjectFootprint } from "./syllabus.ts";
import { ensureOnboarding } from "./onboarding.ts";
import { readIndex, writeIndex } from "./memory.ts";
import { discoverTechnologyProfiles } from "./projectProfile.ts";
import type { Intent } from "./intent.ts";

export type WatchdogReport = {
  root: string;
  at: string;
  changed: boolean;
  changes: Array<{ path: string; action: "added" | "modified" | "removed" }>;
  health: { ssot: boolean; syllabus: boolean; memoryIndex: boolean; compact: boolean };
  fingerprint: Pick<Fingerprint, "totalFiles" | "totalDirs" | "totalBytes" | "truncated" | "indexedFiles" | "indexTruncated">;
  state: string;
};

type Previous = { state?: string; files?: Record<string, { size: number; mtimeMs: number }> };

function exists(file: string): boolean {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function fileState(root: string, files: string[]): Record<string, { size: number; mtimeMs: number }> {
  const out: Record<string, { size: number; mtimeMs: number }> = {};
  for (const rel of files) {
    try {
      const stat = fs.statSync(path.join(root, rel));
      out[rel] = { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      // A file may disappear during the scan; the next pass will reconcile it.
    }
  }
  return out;
}

function changedFiles(
  before: Previous["files"],
  after: Record<string, { size: number; mtimeMs: number }>,
): WatchdogReport["changes"] {
  const prior = before ?? {};
  const changes: WatchdogReport["changes"] = [];
  for (const [file, value] of Object.entries(after)) {
    const old = prior[file];
    if (!old) changes.push({ path: file, action: "added" });
    else if (old.size !== value.size || old.mtimeMs !== value.mtimeMs) changes.push({ path: file, action: "modified" });
  }
  for (const file of Object.keys(prior)) if (!after[file]) changes.push({ path: file, action: "removed" });
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

function stateOf(fp: Fingerprint, files: Record<string, { size: number; mtimeMs: number }>): string {
  // The named index, counts, manifests and language census are all project
  // inputs. Ignored dependency/output directories never participate.
  return sha256(JSON.stringify({
    files: fp.files,
    fileState: files,
    totals: [fp.totalFiles, fp.totalDirs, fp.totalBytes, fp.truncated, fp.indexTruncated],
    languages: fp.languages,
    manifests: fp.manifests,
  }));
}

export function watchProject(root: string, agentIDs: string[], installRoot?: string, observedPaths?: string | string[]): WatchdogReport {
  for (const dir of bootstrapDirs(root)) fs.mkdirSync(dir, { recursive: true });
  const fp = scanProject(root);
  const compactFile = memoryCompactFile(root);
  const previous = readJson<Previous>(compactFile);
  const files = fileState(root, fp.files);
  const changes = changedFiles(previous?.files, files);
  const hints = (Array.isArray(observedPaths) ? observedPaths : [observedPaths])
    .map((value) => String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter(Boolean);
  for (const hint of hints) {
    if (!changes.some((entry) => entry.path === hint)) {
    const before = previous?.files?.[hint];
    const after = files[hint];
    const action = !after && !fs.existsSync(path.join(root, hint))
      ? "removed"
      : !before && after
        ? "added"
        : "modified";
    changes.push({ path: hint, action });
    }
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));
  const state = stateOf(fp, files);
  const missing = !exists(ssotFile(root)) || !exists(syllabusFile(root)) || !exists(memoryIndexFile(root));
  const changed = missing || previous?.state !== state || changes.length > 0;

  // Repair always happens; expensive generated documents only change if the
  // bounded project state changed or an artifact was absent.
  writeIndex(root, readIndex(root));
  if (changed) {
    writeSsot(root, fp);
    ensureSyllabus(root, fp, agentIDs);
    recordProjectFootprint(root, fp);
    ensureOnboarding(root, fp, { installRoot });
  }

  const health = {
    ssot: exists(ssotFile(root)),
    syllabus: exists(syllabusFile(root)),
    memoryIndex: exists(memoryIndexFile(root)),
    compact: false,
  };
  writeJson(compactFile, {
    version: 2,
    generatedAt: new Date().toISOString(),
    root,
    state,
    files,
    fingerprint: {
      files: fp.totalFiles, dirs: fp.totalDirs, bytes: fp.totalBytes,
      indexedFiles: fp.indexedFiles, indexTruncated: fp.indexTruncated, truncated: fp.truncated,
    },
    artifacts: { ssot: ssotFile(root), syllabus: syllabusFile(root), memoryIndex: memoryIndexFile(root) },
    runtimes: discoverTechnologyProfiles(root),
    policy: {
      commandExecution: "pending goal contract and permission",
      modelTrainingKnowledge: "UNVERIFIED unless a provider exposes auditable cutoff metadata",
      ignored: fp.ignored,
    },
  });
  health.compact = exists(compactFile);
  return {
    root, at: new Date().toISOString(), changed, changes, health, state,
    fingerprint: {
      totalFiles: fp.totalFiles, totalDirs: fp.totalDirs, totalBytes: fp.totalBytes,
      truncated: fp.truncated, indexedFiles: fp.indexedFiles, indexTruncated: fp.indexTruncated,
    },
  };
}

/** Watch source-tree events and coalesce bursts into one bounded reconciliation. */
export function startProjectWatchdog(
  root: string,
  agentIDs: string[],
  installRoot: string | undefined,
  onReport: (report: WatchdogReport) => void,
): { close: () => void; supported: boolean } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      const relative = String(filename ?? "").replace(/\\/g, "/");
      if (!relative) return;
      if (relative.split("/").some((part) => DEFAULT_IGNORE.includes(part))) return;
      pending.add(relative);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const observed = [...pending];
        pending.clear();
        try { onReport(watchProject(root, agentIDs, installRoot, observed)); } catch { /* next event or periodic refresh retries */ }
      }, 400);
      if (typeof timer.unref === "function") timer.unref();
    });
    // A monitoring handle must not keep a one-shot CLI or test process alive.
    watcher.unref();
    watcher.on("error", () => watcher.close());
    return {
      supported: true,
      close: () => { if (timer) clearTimeout(timer); watcher.close(); },
    };
  } catch {
    return { supported: false, close: () => { if (timer) clearTimeout(timer); } };
  }
}

/** Update only the current session's bounded routing cache after prompt intake. */
export function recordCompactTask(
  root: string,
  sessionID: string,
  request: string,
  intent: Intent,
  recentMessages: number,
): void {
  if (!sessionID || sessionID === "unknown") return;
  const file = memoryCompactFile(root);
  const current = readJson<Record<string, any>>(file) ?? {};
  const sessions = current.sessions && typeof current.sessions === "object" ? current.sessions : {};
  sessions[sessionID] = {
    updatedAt: new Date().toISOString(),
    request: redact(String(request).slice(0, 1200)),
    intent: { kind: intent.kind, reason: intent.reason, terms: intent.terms.slice(0, 12) },
    focus: intent.focus
      ? { primary: intent.focus.primary.map((item) => item.path), related: intent.focus.related.map((item) => item.path) }
      : { primary: [], related: [] },
    recentMessages: Math.max(0, recentMessages),
  };
  // Compact state is a routing cache, not a transcript archive. Bound old
  // sessions so a busy workspace cannot grow it forever.
  const kept = Object.entries(sessions)
    .sort((a, b) => String((b[1] as any)?.updatedAt ?? "").localeCompare(String((a[1] as any)?.updatedAt ?? "")))
    .slice(0, 24);
  writeJson(file, { ...current, sessions: Object.fromEntries(kept) });
}
