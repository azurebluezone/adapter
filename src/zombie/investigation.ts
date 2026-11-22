// A bounded, evidence-only project map for the active request.
// It reports declared stack versions and installed compiler versions; it never
// executes project scripts or claims to know a model's private training data.
//
// A request can be about the local tree or about external sources. The old map
// always scanned the tree and returned generic gaps ("no README"), which is
// useless for "check these three GitHub repos". The focus card below extracts
// the request's URLs, probes them once, and names what is known and what is
// still missing before the agent spends a single step.

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

const MAX_SOURCES = 5;
const SOURCE_TIMEOUT_MS = 5000;

export type InvestigationSource = {
  url: string;
  status: number | null;
  ok: boolean;
  contentType: string;
  title?: string;
  error?: string;
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

/** Distinct URLs named in the request, punctuation-trimmed and capped. */
export function extractRequestUrls(request: string): string[] {
  const matches = String(request ?? "").match(/https?:\/\/[^\s<>"'`]+/g) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[),.;!?]+$/g, "")))].slice(0, MAX_SOURCES);
}

async function probeSource(url: string): Promise<InvestigationSource> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      headers: { "user-agent": "ZombieCoder-investigation/1.0" },
    });
    const text = await response.text();
    const title = /<title[^>]*>([^<]{1,160})<\/title>/i.exec(text)?.[1]?.replace(/\s+/g, " ").trim();
    return {
      url,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type") ?? "",
      ...(title ? { title } : {}),
    };
  } catch (error) {
    return {
      url,
      status: null,
      ok: false,
      contentType: "",
      error: String((error as Error)?.message ?? error).slice(0, 160),
    };
  }
}

async function probeSources(urls: readonly string[]): Promise<InvestigationSource[]> {
  if (urls.length === 0) return [];
  return Promise.all(urls.map((url) => probeSource(url)));
}

export async function buildProjectInvestigation(root: string, request: string, sessionID = "") {
  const fp = scanProject(root);
  const evidence = collectOnboardingEvidence(root, fp);
  const technologies = discoverTechnologyProfiles(root).map((profile) => ({
    ...profile,
    compilerVersion: compilerVersion(profile.id, root),
  }));
  const intent = classifyIntent(request, fp.files);
  const urls = extractRequestUrls(request);
  const sources = await probeSources(urls);
  const externalResearch = urls.length > 0;

  // A local tree with no files cannot explain an external research request.
  // Keep the local gaps, but do not present them as the task's main problems.
  const localGaps = evidence.gaps;
  const issues = externalResearch
    ? [
        `External research: ${urls.length} URL(s) extracted; ${sources.filter((source) => source.ok).length} probed successfully.`,
        ...(fp.files.length === 0 ? ["Local project is empty; this request is about the external sources below."] : localGaps),
      ]
    : localGaps;

  const focusCard = {
    question: redact(request).slice(0, 240),
    scope: externalResearch ? "external" : "local",
    urls: sources.map((source) => ({
      url: source.url,
      status: source.status,
      ok: source.ok,
      ...(source.title ? { title: source.title } : {}),
      ...(source.error ? { error: source.error } : {}),
    })),
    localFiles: intent.focus?.primary.map((item) => item.path) ?? [],
    known: sources
      .filter((source) => source.ok)
      .map((source) => `${source.url} → HTTP ${source.status}${source.title ? ` (${source.title})` : ""}`),
    missing: sources
      .filter((source) => !source.ok)
      .map((source) => `${source.url} → ${source.error ?? `HTTP ${source.status ?? "no response"}`}`),
    next: externalResearch
      ? "Read each probed source, extract the claim it supports, and cite the URL next to it; never claim a source you did not probe."
      : "Resolve the focus files, read them, and name the smallest check that proves the current behavior.",
  };

  const map = {
    root: fp.root,
    sessionID: sessionID || "unknown",
    userRequest: redact(request).slice(0, 1200),
    intent: { kind: intent.kind, reason: intent.reason, terms: intent.terms.slice(0, 16) },
    focus: intent.focus ? { primary: intent.focus.primary, related: intent.focus.related } : null,
    focusCard,
    sources,
    priorState: { project: evidence.project, git: evidence.git, recentHistory: recentHistory(root), topLevel: evidence.topLevel },
    technologies,
    documentation: evidence.docs,
    tests: evidence.tests,
    logs: evidence.logs,
    recentToolFailures: evidence.auditFailures,
    issues,
    modelTrainingData: "UNVERIFIED: OpenCode's provider/model catalog does not expose auditable training-corpus or cutoff metadata.",
    next: focusCard.next,
  };

  const key = sha256(JSON.stringify({
    request: map.userRequest,
    urls,
    sourceStatus: sources.map((source) => [source.url, source.status, source.ok]),
    git: evidence.git,
    logs: evidence.logs,
    files: fp.files,
    bytes: fp.totalBytes,
  })).slice(0, 16);
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
      `- Sources: ${sources.map((source) => `${source.url} (${source.status ?? source.error ?? "no response"})`).join("; ") || "none named"}`,
      `- Current problems: ${issues.join("; ") || "none observed"}`,
      `- Compiler/runtime: ${technologies.map((item) => `${item.label}: declared ${item.version}, installed ${item.compilerVersion}`).join("; ") || "not detected"}`,
      `- Logs: ${evidence.logs.map((item) => `${item.file}: ${item.errors.join(" | ") || "no recent error lines"}`).join("; ") || "no .log files found"}`,
      `- Model training metadata: UNVERIFIED`,
      `- Official documentation: ${technologies.flatMap((item) => item.documentation).join(", ") || "discover for the focused stack before version-sensitive claims"}`,
      `- Next: ${focusCard.next}`,
      `- Reuse this map until project evidence changes; do not repeat the same investigation.`,
    ];
    appendSyllabus(root, `Investigation ${key}`, lines.join("\n"));
  }
  return { ...map, syllabusMarker: marker };
}
