// Spec §4 — syllabus.
//
// Rules, personas, model policy and project references live here. The file is
// APPEND-ONLY: nothing in this module ever truncates it. If it is missing the
// agent seeds it from the SSOT fingerprint rather than asking the user.

import { appendJsonl, docWithSignature, readJsonl, readText, sha256, writeAtomic } from "./io.ts";
import { auditFile, syllabusFile } from "./paths.ts";
import { ROADMAP_MIN_FILES, recordRoadmap } from "./roadmap.ts";
import type { Fingerprint } from "./scan.ts";
import { LEGACY_AGENT_IDS } from "../roster.ts";

export type SyllabusResult = {
  file: string;
  created: boolean;
  upgraded?: boolean;
  bytes: number;
};

export function readSyllabus(projectRoot: string): string | undefined {
  return readText(syllabusFile(projectRoot));
}

function renderProjectMap(fp: Fingerprint): string[] {
  const files = Array.isArray(fp.files) ? fp.files : [];
  if (files.length === 0) return ["_No files detected._"];
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const at = file.lastIndexOf("/");
    const dir = at >= 0 ? file.slice(0, at + 1) : "./";
    const name = at >= 0 ? file.slice(at + 1) : file;
    const list = byDir.get(dir) ?? [];
    list.push(name);
    byDir.set(dir, list);
  }
  const rows = [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b));
  const out: string[] = [];
  for (const [dir, names] of rows.slice(0, 30)) {
    const shown = names.slice(0, 10).map((n) => "`" + n + "`").join(", ");
    const more = names.length > 10 ? ` … +${names.length - 10}` : "";
    out.push(`| \`${dir}\` | ${shown}${more} |`);
  }
  if (rows.length > 30) out.push(`| _…_ | ${rows.length - 30} more directories; use \`project_fingerprint\` |`);
  return out;
}

export function renderSyllabusSeed(fp: Fingerprint, agentIds: string[]): string {
  const langs = fp.languages.slice(0, 8).map((l) => l.name).join(", ") || "unknown";
  const top =
    fp.topLevel
      .slice(0, 12)
      .map((t) => "`" + t.name + (t.kind === "dir" ? "/" : "") + "`")
      .join(", ") || "_none_";
  const manifests = Object.keys(fp.manifests).map((m) => "`" + m + "`").join(", ") || "_none_";
  const markers = fp.markers.map((m) => "`" + m + "`").join(", ") || "_none_";
  const body = [
    `# Syllabus — agent knowledge for this project`,
    ``,
    `> Seeded automatically from the project fingerprint. Append-only: new lessons are`,
    `> added at the bottom, nothing is ever removed.`,
    ``,
    `## 1. Scope`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| Working directory | \`${fp.root}\` |`,
    `| Languages | ${langs} |`,
    `| Files scanned | ${fp.totalFiles} |`,
    `| Seeded at | ${fp.scannedAt} |`,
    ``,
    `## 2. Footprint (auto-discovered)`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| Top-level entries | ${top} |`,
    `| Manifests | ${manifests} |`,
    `| Markers | ${markers} |`,
    `| Files / dirs / bytes | ${fp.totalFiles} / ${fp.totalDirs} / ${fp.totalBytes} |`,
    `| File index | ${fp.indexedFiles} / ${fp.totalFiles} ${fp.truncated || fp.indexTruncated ? "(truncated — use `project_fingerprint`)" : "(complete)"} |`,
    ``,
    `### Project map (directory → key files)`,
    ``,
    `| Directory | Files |`,
    `| --- | --- |`,
    ...renderProjectMap(fp),
    ``,
    `_This map is the footprint. Do not create a separate footprint file. If it is`,
    `missing or stale, explore the project and update this section in place; add`,
    `durable lessons to §5._`,
    ``,
    `## 3. Agents bound to this project`,
    ``,
    agentIds.map((a) => "- `" + a + "`").join("\n"),
    ``,
    `## 4. Standing rules`,
    ``,
    `1. SSOT first, then logic, then code.`,
    `2. Evidence before confidence. No evidence means no verified answer.`,
    `3. Never state a guess as a fact. Say "not verified" instead.`,
    `4. Every claim carries a label: SOURCE_VERIFIED, CONFIG_VALIDATED, LIVE_PROBE_PASSED, END_TO_END_TESTED, NOT_TESTED, UNVERIFIED.`,
    `5. Regression mindset: after a fix, re-run the checks that could have broken.`,
    `6. Two record-keeping duties only: back up before irreversible work, and log every action.`,
    `7. Every response starts with "ভাইয়া"; chat in Bengali, code/shortcuts in English.`,
    `8. Never lie. Admit a mistake; an honest "I don't know" beats a confident guess.`,
    `9. Read the directory and this syllabus before writing; do not rely on memory.`,
    `10. Shortest evidence-backed answer wins. Send only the necessary context to the provider.`,
    `11. The selected agent remains task owner and reporter. Delegation is bounded by the roster permission matrix: chair/Manu may launch up to 4 work specialists, role agents may launch only their named reviewers, and Majnu cannot delegate. Reviewers return findings to the owner; nested or roster-wide swarms are forbidden.`,
    `12. Before work, read the input intake (§5) and the SSOT: locate the files bound to the request, then start. Planning stays at the goal-contract level; no long planning loops between syllabus and conversation.`,
    ``,
    `## 5. Input intake`,
    ``,
    `How work starts, for both a new project and an existing one:`,
    ``,
    `- **New project** — record the user's current intent and its expected output here once, at intake, before any code. Do not invent scope beyond that intent.`,
    `- **Existing project** — keep the previous proof/footprint (§2), standing rules (§4) and lessons (§6). An intake update adds the new intent; it never erases prior evidence.`,
    `- **Every later input** — read the SSOT and this syllabus first, map the request to the exact files from the project map/SSOT, and start there. Filename inventory is not proof of logic; open the files tied to the request.`,
    `- **Planning cap** — planning is the goal contract plus the few steps needed to hit the point. No hour-long planning between syllabus and conversation, no exploratory loops for a simple task, and no flattery/brokerage: keep only what the task needs.`,
    ``,
    `## 6. Lessons (append-only)`,
    ``,
    `_Nothing recorded yet. Each new lesson lands below, newest last._`,
    ``,
  ].join("\n");
  return docWithSignature(body, "Syllabus", { files: fp.totalFiles });
}

const LESSONS_PLACEHOLDER = "_Nothing recorded yet. Each new lesson lands below, newest last._";

// Upgrade an older seed without losing a single lesson. The header is allowed to
// change (new footprint section, renamed agent); the lesson body is append-only.
function upgradeSyllabus(existing: string, fp: Fingerprint, agentIds: string[]): string {
  const seed = renderSyllabusSeed(fp, agentIds);
  const seedMarker = "## 6. Lessons (append-only)";
  const seedAt = seed.indexOf(seedMarker);
  if (seedAt < 0) return seed;

  const oldAt = existing.search(/^## \d+\. Lessons[^\n]*$/m);
  let lessons = "";
  if (oldAt >= 0) {
    lessons = existing
      .slice(oldAt)
      .replace(/^## \d+\. Lessons[^\n]*\n+/, "")
      .replace(/\n---\n\n_— ZombieCoder Syllabus[^\n]*\n?$/, "")
      .trim();
  } else {
    // `append_syllabus` can create the file before the watchdog seeds it: a
    // contract or onboarding lesson on a brand-new project lands first. An
    // unseeded file is all lesson content, so keep it instead of replacing it
    // with the placeholder. An older seed without the lessons heading is
    // recognized by its own headings and is replaced normally.
    const looksLikeSeed = /^# Syllabus\b/m.test(existing) || /^## 1\. Scope\b/m.test(existing);
    if (!looksLikeSeed) lessons = existing.trim();
  }
  if (!lessons || lessons === LESSONS_PLACEHOLDER) lessons = LESSONS_PLACEHOLDER;

  const header = seed.slice(0, seedAt);
  const sigAt = seed.indexOf("---", seedAt);
  const signature = sigAt >= 0 ? seed.slice(sigAt) : "";
  return `${header}${seedMarker}\n\n${lessons}\n\n${signature}`;
}

export function ensureSyllabus(projectRoot: string, fp: Fingerprint, agentIds: string[]): SyllabusResult {
  const file = syllabusFile(projectRoot);
  const existing = readText(file);
  if (existing !== undefined && existing.trim().length > 0) {
    const hasLegacyAgent = LEGACY_AGENT_IDS.some((id) => existing.includes("- `" + id + "`"));
    const needsUpgrade =
      !existing.includes("## 2. Footprint") ||
      !existing.includes("### Project map") ||
      !/^## 5\. Input intake$/m.test(existing) ||
      hasLegacyAgent;
    if (!needsUpgrade) {
      return { file, created: false, bytes: Buffer.byteLength(existing, "utf8") };
    }
    const upgraded = upgradeSyllabus(existing, fp, agentIds);
    writeAtomic(file, upgraded);
    return {
      file,
      created: false,
      upgraded: true,
      bytes: Buffer.byteLength(upgraded, "utf8"),
    };
  }
  const seeded = renderSyllabusSeed(fp, agentIds);
  writeAtomic(file, seeded);
  return { file, created: true, bytes: Buffer.byteLength(seeded, "utf8") };
}

// Append-only lesson. Mirrored into footprint so the change is auditable.
export function appendSyllabus(  projectRoot: string,
  topic: string,
  summary: string,
  footprint?: string,
): { file: string; bytes: number } {
  const file = syllabusFile(projectRoot);
  const existing = readText(file) ?? "";
  const block = [
    "",
    `### ${topic}`,
    ``,
    summary.trim(),
    ``,
    `_recorded ${new Date().toISOString()}_`,
    ``,
  ].join("\n");
  const next = existing.replace(/\s*$/, "") + "\n" + block;
  writeAtomic(file, next);
  if (footprint) {
    appendJsonl(footprint, {
      ts: new Date().toISOString(),
      kind: "syllabus.append",
      agent: "plugin",
      topic,
      bytes: Buffer.byteLength(block, "utf8"),
    });
  }
  return { file, bytes: Buffer.byteLength(next, "utf8") };
}

// A new working directory must leave a trace, but a restart must not append the
// same lesson again. The marker line is the dedupe key: it is derived from the
// live fingerprint, so a changed tree produces a new lesson and an unchanged tree
// stays silent.
export type FootprintRecord = {
  appended: boolean;
  file: string;
  marker: string;
  /** Real gaps found in the bounded scan; the lesson writes them for the next session. */
  problems: string[];
  roadmap: { big: boolean; file: string; next: string | null; written: boolean };
};

/**
 * Problems a bounded scan can prove without reading every file. The onboarding
 * pass adds deeper evidence (TODO markers, log errors, git drift); this list is
 * the cheap footprint health that every setup and watchdog pass can afford.
 */
export function footprintProblems(fp: Fingerprint): string[] {
  const files = fp.files;
  const has = (pattern: RegExp): boolean => files.some((file) => pattern.test(file));
  const problems: string[] = [];
  if (Object.keys(fp.manifests).length === 0) {
    problems.push("No supported manifest at the root; dependency and build facts are unknown.");
  }
  if (!has(/(?:^|\/)(?:test|tests|__tests__)\//) && !has(/\.(?:test|spec)\.[a-z0-9]+$/i)) {
    problems.push("No test files detected; behaviour cannot be re-proved from the repo alone.");
  }
  if (!has(/^README(?:\.[a-z0-9]+)?$/i)) {
    problems.push("No README at the root; the project's stated purpose is not written down.");
  }
  if (!has(/^docs?\//i)) {
    problems.push("No docs/ directory; documentation drift is invisible.");
  }
  if (!has(/^scripts\/check[-.]/i)) {
    problems.push("No scripts/check-* verification script; a release gate has no runnable command.");
  }
  if (!has(/^\.github\/workflows\//i)) {
    problems.push("No CI workflow; checks are not enforced on change.");
  }
  if (fp.indexTruncated) {
    problems.push(`File index truncated: ${fp.indexedFiles}/${fp.totalFiles}; use project_fingerprint for the rest.`);
  }
  return problems;
}

function auditSummary(projectRoot: string): string[] {
  const rows = readJsonl<any>(auditFile(projectRoot), 500);
  if (rows.length === 0) return ["- No previous audit trail in `.zombiecoder/.state/audit.jsonl`."];
  const failures = new Map<string, number>();
  let escalations = 0;
  let gateBlocks = 0;
  for (const row of rows) {
    if (row?.kind === "tool" && row?.status === "error") {
      const tool = String(row?.tool ?? "unknown");
      failures.set(tool, (failures.get(tool) ?? 0) + 1);
    }
    if (row?.kind === "agent.escalation") escalations += 1;
    if (row?.kind === "gate") gateBlocks += 1;
  }
  const top = [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return [
    `- Audit rows read: ${rows.length}`,
    top.length > 0 ? `- Tool failures: ${top.map(([tool, n]) => `${tool}×${n}`).join(", ")}` : "- Tool failures: none recorded",
    `- Agent escalations: ${escalations}`,
    `- Gate blocks: ${gateBlocks}`,
  ];
}

export function recordProjectFootprint(projectRoot: string, fp: Fingerprint): FootprintRecord {
  const file = syllabusFile(projectRoot);
  const roadmap = recordRoadmap(projectRoot, fp);
  const problems = footprintProblems(fp);
  // The problems digest is part of the marker: fixing a missing test/README
  // changes the lesson even when the file count and byte count stay the same.
  const problemDigest = sha256(problems.join("\n")).slice(0, 8);
  const marker = `fp:${fp.totalFiles}/${fp.totalBytes}/${fp.languages.slice(0, 3).map((l) => l.name).join("+") || "unknown"}/${problemDigest}`;
  const existing = readText(file) ?? "";
  const result = {
    appended: false,
    file,
    marker,
    problems,
    roadmap: {
      big: roadmap.roadmap.big,
      file: roadmap.file,
      next: roadmap.roadmap.next,
      written: roadmap.written,
    },
  };
  if (existing.includes(marker)) return result;
  const langs = fp.languages.slice(0, 6).map((l) => `${l.name}(${l.files})`).join(", ") || "unknown";
  const dirs = fp.topLevel.slice(0, 8).map((t) => "`" + t.name + (t.kind === "dir" ? "/" : "") + "`").join(", ") || "none";
  const summary = [
    `\`${marker}\``,
    "",
    `- Files / dirs / bytes: ${fp.totalFiles} / ${fp.totalDirs} / ${fp.totalBytes}`,
    `- Languages: ${langs}`,
    `- Top level: ${dirs}`,
    `- Markers: ${fp.markers.join(", ") || "none"}`,
    "",
    "**Problems found**",
    "",
    ...(problems.length > 0 ? problems.map((problem) => `- ${problem}`) : ["- none detected by the bounded scan"]),
    "",
    "**Roadmap**",
    "",
    roadmap.roadmap.big
      ? `- File: \`${roadmap.file}\`; phases: ${roadmap.roadmap.phases.map((phase) => phase.name).join(", ")}`
      : `- Not generated: ${fp.totalFiles} files is below the ${ROADMAP_MIN_FILES}-file big-project threshold.`,
    roadmap.roadmap.next ? `- Next open item: ${roadmap.roadmap.next}` : "- No open roadmap item.",
    "",
    "Carried from the previous audit trail:",
    "",
    ...auditSummary(projectRoot),
    "",
    "Next action: read SSOT section 3 before opening files; do not re-scan the tree unless the fingerprint is stale.",
  ].join("\n");
  appendSyllabus(projectRoot, "Project footprint (auto)", summary, auditFile(projectRoot));
  return { ...result, appended: true };
}
