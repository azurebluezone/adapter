// A bounded, evidence-only project map for the active request.
// It reports declared stack versions and installed compiler versions; it never
// executes project scripts or claims to know a model's private training data.

import { spawnSync } from "node:child_process";
import { classifyIntent } from "./intent.ts";
import { collectOnboardingEvidence } from "./onboarding.ts";
import { sha256, redact } from "./io.ts";
import { readSyllabus, appendSyllabus } from "./syllabus.ts";
import { discoverTechnologyProfiles } from "./projectProfile.ts";
import { scanProject } from "./scan.ts";

const COMPILERS: Record<string, [string, string[]]> = {
  node: ["node", ["--version"]], python: ["python3", ["--version"]], php: ["php", ["--version"]],
  go: ["go", ["version"]], rust: ["rustc", ["--version"]], jvm: ["javac", ["-version"]],
};

function compilerVersion(id: string, root: string): string {
  const spec = COMPILERS[id];
  if (!spec) return "NOT_PROBED";
  try {
    const result = spawnSync(spec[0], spec[1], { cwd: root, encoding: "utf8", timeout: 1500, maxBuffer: 4096, windowsHide: true });
    if (result.error || result.status !== 0) return "NOT_INSTALLED_OR_UNAVAILABLE";
    return String(result.stdout || result.stderr).trim().split(/\r?\n/)[0].slice(0, 160) || "NO_VERSION_OUTPUT";
  } catch {
    return "NOT_INSTALLED_OR_UNAVAILABLE";
  }
}

function recentHistory(root: string): string[] {
  try {
    const result = spawnSync("git", ["log", "-5", "--oneline", "--decorate=no"], {
      cwd: root, encoding: "utf8", timeout: 1500, maxBuffer: 8192, windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => redact(line).slice(0, 180)) : [];
  } catch { return []; }
}

export function buildProjectInvestigation(root: string, request: string, sessionID = "") {
  const fp = scanProject(root);
  const evidence = collectOnboardingEvidence(root, fp);
  const technologies = discoverTechnologyProfiles(root).map((profile) => ({
    ...profile,
    compilerVersion: compilerVersion(profile.id, root),
  }));
  const intent = classifyIntent(request, fp.files);
  const map = {
    root: fp.root,
    sessionID: sessionID || "unknown",
    userRequest: redact(request).slice(0, 1200),
    intent: { kind: intent.kind, reason: intent.reason, terms: intent.terms.slice(0, 16) },
    focus: intent.focus ? { primary: intent.focus.primary, related: intent.focus.related } : null,
    priorState: { project: evidence.project, git: evidence.git, recentHistory: recentHistory(root), topLevel: evidence.topLevel },
    technologies,
    documentation: evidence.docs,
    tests: evidence.tests,
    logs: evidence.logs,
    recentToolFailures: evidence.auditFailures,
    issues: evidence.gaps,
    modelTrainingData: "UNVERIFIED: OpenCode's provider/model catalog does not expose auditable training-corpus or cutoff metadata.",
    next: "Compare changed behavior with the cited official documentation; run only the relevant compiler/test command after the user-approved goal contract.",
  };

  const key = sha256(JSON.stringify({ request: map.userRequest, git: evidence.git, logs: evidence.logs, files: fp.files, bytes: fp.totalBytes })).slice(0, 16);
  const marker = `investigation:${key}`;
  const syllabus = readSyllabus(root) ?? "";
  if (!syllabus.includes(marker)) {
    const lines = [
      `\`${marker}\``,
      `- Session: ${sessionID || "unknown"}`,
      `- User request: ${map.userRequest.replace(/\r?\n/g, " ⏎ ")}`,
      `- Intent: ${intent.kind} (${intent.reason})`,
      `- Prior state: ${evidence.project.name} ${evidence.project.version}; ${evidence.git ? `${evidence.git.branch}@${evidence.git.head}` : "git state unavailable"}`,
      `- Focus: ${intent.focus?.primary.map((item) => item.path).join(", ") || "none resolved"}`,
      `- Current problems: ${evidence.gaps.join("; ") || "none observed"}`,
      `- Compiler/runtime: ${technologies.map((item) => `${item.label}: declared ${item.version}, installed ${item.compilerVersion}`).join("; ") || "not detected"}`,
      `- Logs: ${evidence.logs.map((item) => `${item.file}: ${item.errors.join(" | ") || "no recent error lines"}`).join("; ") || "no .log files found"}`,
      `- Model training metadata: UNVERIFIED`,
      `- Official documentation: ${technologies.flatMap((item) => item.documentation).join(", ") || "discover for the focused stack before version-sensitive claims"}`,
      `- Reuse this map until project evidence changes; do not repeat the same investigation.`,
    ];
    appendSyllabus(root, `Investigation ${key}`, lines.join("\n"));
  }
  return { ...map, syllabusMarker: marker };
}
