// Automatic roadmap for a big project.
//
// A large tree has more work than one answer can hold. The roadmap turns the
// bounded fingerprint into a short, reviewable plan: which areas exist, which
// verification doors are missing, and what the next open item is. It is
// generated from real paths, never from a model guess, and it is written to
// `.zombiecoder/roadmap.md` so the next session starts from the same plan.

import * as fs from "node:fs";
import * as path from "node:path";
import { readText, sha256, writeAtomic } from "./io.ts";
import { zombieRoot } from "./paths.ts";
import type { Fingerprint } from "./scan.ts";

/** A project below this size does not need a separate roadmap file. */
export const ROADMAP_MIN_FILES = 120;

export type RoadmapItem = {
  text: string;
  done: boolean;
  owner: string;
};

export type RoadmapPhase = {
  name: string;
  items: RoadmapItem[];
};

export type Roadmap = {
  big: boolean;
  digest: string;
  file: string;
  phases: RoadmapPhase[];
  risks: string[];
  next: string | null;
  text: string;
};

const SOURCE_DIRS = new Set([
  "src",
  "lib",
  "app",
  "packages",
  "bin",
  "tools",
  "mcp",
  "scripts",
  "test",
  "tests",
  "docs",
  "doc",
]);

const OWNER_BY_AREA: Readonly<Record<string, string>> = {
  src: "manu",
  lib: "manu",
  app: "nila",
  packages: "manu",
  bin: "jarin",
  tools: "jarin",
  mcp: "tuhin",
  scripts: "jarin",
  test: "majnu",
  tests: "majnu",
  docs: "halim",
  doc: "halim",
};

export function roadmapFile(projectRoot: string): string {
  return path.join(zombieRoot(projectRoot), "roadmap.md");
}

function countByTop(files: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const top = file.includes("/") ? file.slice(0, file.indexOf("/")) : ".";
    if (top === "." || !SOURCE_DIRS.has(top)) continue;
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return counts;
}

function hasFile(files: readonly string[], pattern: RegExp): boolean {
  return files.some((file) => pattern.test(file));
}

function manifestNames(fp: Fingerprint): string[] {
  const known = [
    "package.json",
    "composer.json",
    "pyproject.toml",
    "requirements.txt",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "Gemfile",
    "Makefile",
  ];
  const present = new Set(fp.files.filter((file) => !file.includes("/")));
  return known.filter((name) => present.has(name));
}

function entryFiles(files: readonly string[]): string[] {
  return files.filter((file) =>
    /^(?:src\/)?(?:index|main|plugin|app|cli)\.[a-z0-9]+$/i.test(file) ||
    /^bin\/[^/]+\.(?:mjs|cjs|js|ts)$/i.test(file),
  );
}

/**
 * Build a roadmap from the bounded scan. The same fingerprint always produces
 * the same roadmap, so a restart does not churn the file.
 */
export function buildRoadmap(fp: Fingerprint): Roadmap {
  const file = roadmapFile(fp.root);
  const big = fp.totalFiles >= ROADMAP_MIN_FILES;
  if (!big) {
    return { big: false, digest: "", file, phases: [], risks: [], next: null, text: "" };
  }

  const counts = countByTop(fp.files);
  const manifests = manifestNames(fp);
  const entries = entryFiles(fp.files);
  const tests = hasFile(fp.files, /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[a-z0-9]+$/i);
  const docs = hasFile(fp.files, /^docs?\//i) || hasFile(fp.files, /^README(?:\.[a-z0-9]+)?$/i);
  const checkScripts = hasFile(fp.files, /^scripts\/check[-.]/i);
  const ci = hasFile(fp.files, /^\.github\/workflows\//i);
  const sourceAreas = [...counts.entries()]
    .filter(([name]) => name !== "test" && name !== "tests" && name !== "docs" && name !== "doc")
    .sort((a, b) => b[1] - a[1]);

  const foundation: RoadmapItem[] = [
    {
      text: manifests.length > 0 ? `Manifest present: ${manifests.join(", ")}` : "Add a root manifest",
      done: manifests.length > 0,
      owner: "manu",
    },
    {
      text: entries.length > 0 ? `Entry point present: ${entries.slice(0, 3).join(", ")}` : "Add a documented entry point",
      done: entries.length > 0,
      owner: "manu",
    },
    {
      text: docs ? "README/docs present" : "Add README and docs/",
      done: docs,
      owner: "halim",
    },
  ];

  const core: RoadmapItem[] = sourceAreas.slice(0, 8).map(([name, count]) => ({
    text: `${name}/ present (${count} file${count === 1 ? "" : "s"})`,
    done: true,
    owner: OWNER_BY_AREA[name] ?? "manu",
  }));
  if (core.length === 0) {
    core.push({ text: "No source area detected; add the first module", done: false, owner: "manu" });
  }

  const verification: RoadmapItem[] = [
    {
      text: tests ? "Tests present" : "Add a test directory and one real check",
      done: tests,
      owner: "majnu",
    },
    {
      text: checkScripts ? "Runnable check script present" : "Add scripts/check-*.mjs",
      done: checkScripts,
      owner: "majnu",
    },
    {
      text: ci ? "CI workflow present" : "Add .github/workflows",
      done: ci,
      owner: "jarin",
    },
  ];

  const phases: RoadmapPhase[] = [
    { name: "Foundation", items: foundation },
    { name: "Core modules", items: core },
    { name: "Verification", items: verification },
  ];

  const risks: string[] = [];
  if (manifests.length === 0) risks.push("No supported root manifest; dependency and build facts are unknown.");
  if (!tests) risks.push("No test files; behaviour cannot be re-proved from the repo alone.");
  if (!docs) risks.push("No README/docs; the project's stated purpose is not written down.");
  if (!checkScripts) risks.push("No scripts/check-* command; a release gate has no runnable proof.");
  if (!ci) risks.push("No CI workflow; checks are not enforced on change.");
  if (fp.indexTruncated) {
    risks.push(`File index truncated: ${fp.indexedFiles}/${fp.totalFiles}; use project_fingerprint for the rest.`);
  }

  const next = phases.flatMap((phase) => phase.items).find((item) => !item.done)?.text ?? null;
  const lines = [
    "# Roadmap (auto-generated)",
    "",
    `Generated from ${fp.totalFiles} files at ${fp.scannedAt}.`,
    "This file is generated from the bounded scan; edit the work, not the counts.",
    "",
    ...phases.flatMap((phase) => [
      `## ${phase.name}`,
      "",
      ...phase.items.map((item) => `- [${item.done ? "x" : " "}] ${item.text} (owner: ${item.owner})`),
      "",
    ]),
    "## Risks",
    "",
    ...(risks.length > 0 ? risks.map((risk) => `- ${risk}`) : ["- none detected by the bounded scan"]),
    "",
    "## Next",
    "",
    `- ${next ?? "No open item; re-scan after the next change."}`,
    "",
  ];
  const text = lines.join("\n");
  return {
    big: true,
    digest: sha256(text).slice(0, 16),
    file,
    phases,
    risks,
    next,
    text,
  };
}

/**
 * Write the roadmap when the project is big. A project that shrinks below the
 * threshold loses a stale generated file instead of keeping a plan for a tree
 * that no longer exists.
 */
export function recordRoadmap(
  projectRoot: string,
  fp: Fingerprint,
): { roadmap: Roadmap; written: boolean; removed: boolean; file: string } {
  const roadmap = buildRoadmap({ ...fp, root: projectRoot });
  if (!roadmap.big) {
    const stale = readText(roadmap.file);
    const removed = stale !== undefined && /^# Roadmap \(auto-generated\)/m.test(stale);
    if (removed) {
      try {
        fs.rmSync(roadmap.file, { force: true });
      } catch {
        /* the next scan retries */
      }
    }
    return { roadmap, written: false, removed, file: roadmap.file };
  }
  const existing = readText(roadmap.file);
  if (existing === roadmap.text) return { roadmap, written: false, removed: false, file: roadmap.file };
  writeAtomic(roadmap.file, roadmap.text);
  return { roadmap, written: true, removed: false, file: roadmap.file };
}

/** Compact roadmap view for the context pack. */
export function roadmapSummary(projectRoot: string): { file: string; next: string | null; phases: string[] } | null {
  const file = roadmapFile(projectRoot);
  const text = readText(file);
  if (!text) return null;
  const phases = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]).filter((name) => name !== "Risks" && name !== "Next");
  const next = /^## Next\n\n- (.+)$/m.exec(text)?.[1]?.trim() ?? null;
  return { file, next, phases };
}
