// Portable skill library: the ZombieCoder agent-skill database, downloaded once
// and routed locally.
//
// Upstream (github.com/azurebluezone/zombiecoder-agent-skills) publishes a
// SQLite database plus dependency-free JSONL exports and a Bengali intent
// bridge. This module keeps the data plane portable:
//
//   <install>/zombiecoder/skill-db/
//     skills.meta.json     counts + sha256/bytes for the exports (trust anchor)
//     skills.jsonl         one skill per line (slug, description, body, source)
//     terms.jsonl          { term, skill_id, weight } routing rows
//     bn-intents.json      Bengali -> English retrieval terms
//     cards/<slug>.yaml    skill-lite cards generated on first match
//
// The router is the same deterministic scorer as the upstream pack: tokenize,
// weight / document_frequency^0.4, co-occurrence bonus, exact name/slug bonus,
// min score 3.0, top 2, deduplicated by slug. Skill bodies are data, never
// instructions; the agent reads a small YAML card and asks for the full body
// only when the card is not enough.
//
// Nothing here is copied into a working directory. `syncSkillDb` writes only
// under the install root (or an explicit cache dir) and verifies every download
// against skills.meta.json before it is used.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { ensureDir, writeAtomic } from "./io.ts";
import { cardMatches, skillCard } from "./skillCard.ts";
import { nativeSkillLiteSection } from "./nativeSkills.ts";

export const DEFAULT_SKILL_DB_REPO =
  "https://github.com/azurebluezone/zombiecoder-agent-skills";
export const SKILL_DB_EXPORTS = ["skills.jsonl", "terms.jsonl"] as const;
export const SKILL_DB_INTENTS = "bn-intents.json";
export const SKILL_DB_META = "skills.meta.json";

const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const MAX_META_BYTES = 1024 * 1024;
const MAX_INTENTS_BYTES = 1024 * 1024;

export type SkillDbFileSpec = { sha256?: string; bytes?: number };

export type SkillDbMeta = {
  schema_version?: string;
  generated_at?: string;
  skills?: number;
  terms?: number;
  bytes?: number;
  files?: Record<string, SkillDbFileSpec>;
};

export type SkillDbSyncOptions = {
  /** Explicit cache directory. Takes precedence over installRoot. */
  dir?: string;
  /** Install root that owns `zombiecoder/`. */
  installRoot?: string;
  /** Repository URL; defaults to DEFAULT_SKILL_DB_REPO. */
  repo?: string;
  /** Set false to verify the local cache only. */
  download?: boolean;
  timeoutMs?: number;
};

export type SkillDbSyncResult = {
  ok: boolean;
  dir: string;
  repo: string;
  base: string;
  skills: number;
  terms: number;
  bodyBytes: number;
  downloaded: string[];
  verified: string[];
  failed: { file: string; error: string }[];
  meta: SkillDbMeta | null;
};

export function skillDbDir(installRoot: string): string {
  return path.join(installRoot, "zombiecoder", "skill-db");
}

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** github.com/owner/repo -> raw.githubusercontent.com/owner/repo/main */
export function skillDbBase(repo: string): string {
  const clean = String(repo ?? "").trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  const github = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(clean);
  if (github) return `https://raw.githubusercontent.com/${github[1]}/${github[2]}/main`;
  if (/^https:\/\/raw\.githubusercontent\.com\//.test(clean)) return clean;
  return `${clean}/main`;
}

async function fetchBytes(url: string, limit: number, timeoutMs: number): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Error(`remote file is ${declared} bytes, cap is ${limit}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > limit) throw new Error(`remote file is ${buffer.length} bytes, cap is ${limit}`);
  return buffer;
}

function fileMatches(file: string, spec: SkillDbFileSpec | undefined): boolean {
  if (!spec?.sha256) return false;
  try {
    const buffer = fs.readFileSync(file);
    if (spec.bytes !== undefined && buffer.length !== spec.bytes) return false;
    return sha256(buffer) === spec.sha256.toLowerCase();
  } catch {
    return false;
  }
}

function countJsonl(file: string): number {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

/**
 * Download and verify the skill database exports. Network failure never throws:
 * the caller gets per-file errors and keeps whatever already verified.
 */
export async function syncSkillDb(options: SkillDbSyncOptions = {}): Promise<SkillDbSyncResult> {
  const dir = path.resolve(options.dir ?? skillDbDir(options.installRoot ?? process.cwd()));
  const repo = String(options.repo ?? process.env.ZOMBIECODER_SKILL_DB_REPO ?? DEFAULT_SKILL_DB_REPO).trim();
  const base = skillDbBase(repo);
  const timeoutMs = Math.max(Number(options.timeoutMs) || 60_000, 1_000);
  const download = options.download !== false;
  ensureDir(dir);

  const downloaded: string[] = [];
  const verified: string[] = [];
  const failed: { file: string; error: string }[] = [];
  let meta: SkillDbMeta | null = null;

  const metaFile = path.join(dir, SKILL_DB_META);
  try {
    const raw = download
      ? await fetchBytes(`${base}/${SKILL_DB_META}`, MAX_META_BYTES, timeoutMs)
      : fs.readFileSync(metaFile);
    meta = JSON.parse(raw.toString("utf8")) as SkillDbMeta;
    if (!meta || typeof meta !== "object") throw new Error("meta is not an object");
    writeAtomic(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  } catch (error: any) {
    // A stale local meta is still a trust anchor for the files it describes.
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as SkillDbMeta;
      failed.push({ file: SKILL_DB_META, error: `download failed, using local meta: ${String(error?.message ?? error)}` });
    } catch {
      meta = null;
      failed.push({ file: SKILL_DB_META, error: String(error?.message ?? error) });
    }
  }

  for (const name of SKILL_DB_EXPORTS) {
    const target = path.join(dir, name);
    const spec = meta?.files?.[name];
    if (fileMatches(target, spec)) {
      verified.push(name);
      continue;
    }
    if (!download) {
      failed.push({ file: name, error: "missing or hash mismatch locally, download disabled" });
      continue;
    }
    try {
      const buffer = await fetchBytes(`${base}/${name}`, MAX_EXPORT_BYTES, timeoutMs);
      if (spec?.sha256 && sha256(buffer) !== spec.sha256.toLowerCase()) {
        throw new Error("sha256 mismatch against skills.meta.json");
      }
      if (spec?.bytes !== undefined && buffer.length !== spec.bytes) {
        throw new Error(`byte size ${buffer.length} != ${spec.bytes} in skills.meta.json`);
      }
      writeAtomic(target, buffer.toString("utf8"));
      downloaded.push(name);
      verified.push(name);
    } catch (error: any) {
      failed.push({ file: name, error: String(error?.message ?? error) });
    }
  }

  const intentsFile = path.join(dir, SKILL_DB_INTENTS);
  if (fs.existsSync(intentsFile)) {
    verified.push(SKILL_DB_INTENTS);
  } else if (download) {
    try {
      const buffer = await fetchBytes(`${base}/data/${SKILL_DB_INTENTS}`, MAX_INTENTS_BYTES, timeoutMs);
      const parsed = JSON.parse(buffer.toString("utf8"));
      if (!Array.isArray(parsed?.entries)) throw new Error("intent bridge has no entries array");
      writeAtomic(intentsFile, buffer.toString("utf8"));
      downloaded.push(SKILL_DB_INTENTS);
      verified.push(SKILL_DB_INTENTS);
    } catch (error: any) {
      failed.push({ file: SKILL_DB_INTENTS, error: String(error?.message ?? error) });
    }
  }

  const skills = Number(meta?.skills ?? countJsonl(path.join(dir, "skills.jsonl")));
  const terms = Number(meta?.terms ?? countJsonl(path.join(dir, "terms.jsonl")));
  const bodyBytes = Number(meta?.bytes ?? 0);
  const ok =
    verified.includes("skills.jsonl") &&
    verified.includes("terms.jsonl") &&
    failed.length === 0;
  return { ok, dir, repo, base, skills, terms, bodyBytes, downloaded, verified, failed, meta };
}

// ---------------------------------------------------------------------------
// Loader

export type SkillRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  source: string;
  license: string;
  content_hash: string;
  bytes: number;
  active: boolean;
  tags: string[];
  triggers: string[];
};

export type IntentEntry = { bn: string; en: string };

export type IntentBridge = {
  locale: string;
  maxTerms: number;
  entries: IntentEntry[];
};

export type SkillLibrary = {
  dir: string;
  skills: SkillRecord[];
  byId: Map<string, SkillRecord>;
  bySlug: Map<string, SkillRecord>;
  termMap: Map<string, Array<[string, number]>>;
  df: Map<string, number>;
  termRows: number;
  intents: IntentBridge;
};

export type SkillMatch = SkillRecord & {
  score: number;
  /** Number of query terms that hit this skill. */
  hits: number;
  /** The query terms themselves, for the card's MATCH header. */
  matchedTerms: string[];
};

const LIBRARY_CACHE = new Map<string, { key: string; library: SkillLibrary }>();

function normalizeText(text: string): string {
  return String(text ?? "").normalize("NFC");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asString(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((item) => asString(item)).filter(Boolean);
    } catch {
      /* a plain comma list is still useful */
    }
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function readJsonl(file: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") out.push(parsed as Record<string, unknown>);
    } catch {
      /* one corrupt line must not discard the library */
    }
  }
  return out;
}

function loadIntents(file: string): IntentBridge {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const entries = (Array.isArray(raw?.entries) ? raw.entries : [])
      .filter((entry: any) => entry && entry.bn && entry.en)
      .map((entry: any) => ({ bn: normalizeText(String(entry.bn)), en: String(entry.en) }))
      .sort((a: IntentEntry, b: IntentEntry) => b.bn.length - a.bn.length || a.bn.localeCompare(b.bn));
    return {
      locale: asString(raw?.locale),
      maxTerms: Math.max(Number(raw?.max_terms) || 24, 1),
      entries,
    };
  } catch {
    return { locale: "", maxTerms: 24, entries: [] };
  }
}

function cacheKey(dir: string): string {
  const parts: string[] = [];
  for (const name of ["skills.jsonl", "terms.jsonl", SKILL_DB_INTENTS]) {
    try {
      const stat = fs.statSync(path.join(dir, name));
      parts.push(`${name}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      parts.push(`${name}:missing`);
    }
  }
  return parts.join("|");
}

/**
 * Load the JSONL exports into memory, once per process (and again only when the
 * files change). Returns null when the database has not been downloaded.
 */
export function loadSkillLibrary(dir: string): SkillLibrary | null {
  const root = path.resolve(dir);
  const skillsFile = path.join(root, "skills.jsonl");
  const termsFile = path.join(root, "terms.jsonl");
  if (!fs.existsSync(skillsFile) || !fs.existsSync(termsFile)) return null;
  const key = cacheKey(root);
  const cached = LIBRARY_CACHE.get(root);
  if (cached && cached.key === key) return cached.library;

  const skills: SkillRecord[] = [];
  const byId = new Map<string, SkillRecord>();
  const bySlug = new Map<string, SkillRecord>();
  for (const row of readJsonl(skillsFile)) {
    const id = asString(row.id);
    const slug = asString(row.slug);
    if (!id || !slug) continue;
    const active = row.active === undefined ? true : Number(row.active) !== 0;
    if (!active) continue;
    const record: SkillRecord = {
      id,
      slug,
      name: asString(row.name) || slug,
      description: asString(row.description),
      body: asString(row.body),
      source: asString(row.source),
      license: asString(row.license),
      content_hash: asString(row.content_hash),
      bytes: Number(row.bytes) || 0,
      active,
      tags: asStringArray(row.tags),
      triggers: asStringArray(row.triggers),
    };
    skills.push(record);
    byId.set(record.id, record);
    const previous = bySlug.get(record.slug);
    if (!previous || record.bytes > previous.bytes) bySlug.set(record.slug, record);
  }

  const termMap = new Map<string, Array<[string, number]>>();
  const df = new Map<string, number>();
  let termRows = 0;
  for (const row of readJsonl(termsFile)) {
    const term = asString(row.term);
    const skillId = asString(row.skill_id);
    if (!term || !skillId || !byId.has(skillId)) continue;
    const weight = Number(row.weight) || 1;
    const postings = termMap.get(term);
    if (postings) postings.push([skillId, weight]);
    else termMap.set(term, [[skillId, weight]]);
    df.set(term, (df.get(term) ?? 0) + 1);
    termRows += 1;
  }

  const library: SkillLibrary = {
    dir: root,
    skills,
    byId,
    bySlug,
    termMap,
    df,
    termRows,
    intents: loadIntents(path.join(root, SKILL_DB_INTENTS)),
  };
  LIBRARY_CACHE.set(root, { key, library });
  return library;
}

export function clearSkillLibraryCache(dir?: string): void {
  if (dir) LIBRARY_CACHE.delete(path.resolve(dir));
  else LIBRARY_CACHE.clear();
}

// ---------------------------------------------------------------------------
// Router (ported from the upstream Node/Python implementation)

const TOKEN_RE = /[A-Za-z][A-Za-z0-9_+.-]{1,40}|[\u0980-\u09FF]{2,20}/g;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "your", "you", "are",
  "was", "were", "not", "use", "uses", "used", "using", "when", "what", "how",
  "why", "who", "all", "any", "can", "will", "would", "should", "could", "must",
  "into", "onto", "out", "its", "has", "have", "had", "but", "our", "their",
  "them", "they", "then", "than", "also", "just", "only", "more", "most", "some",
  "such", "each", "other", "which", "while", "about", "after", "before", "over",
  "under", "between", "via", "per", "etc", "skill", "skills", "agent", "agents",
  "task", "tasks", "work", "working", "step", "steps",
]);

export function tokenize(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const matches = String(text ?? "").toLowerCase().match(TOKEN_RE) ?? [];
  for (const raw of matches) {
    const token = raw.replace(/^[._+-]+|[._+-]+$/g, "");
    if (token.length < 2 || STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/** Expand Bengali intent into English retrieval terms, longest phrase first. */
export function expandQuery(text: string, intents: IntentBridge): string {
  const source = normalizeText(text);
  if (intents.entries.length === 0) return source;
  let output = source;
  let added = 0;
  let applied = 0;
  for (const entry of intents.entries) {
    if (!output.includes(entry.bn)) continue;
    const occurrences = output.split(entry.bn).length - 1;
    const englishTerms = entry.en.split(/\s+/).filter(Boolean).length * occurrences;
    if (added + englishTerms > intents.maxTerms) continue;
    output = output.split(entry.bn).join(` ${entry.en} `);
    added += englishTerms;
    applied += occurrences;
    if (applied >= intents.maxTerms) break;
  }
  return output
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export type RouteOptions = {
  limit?: number;
  minScore?: number;
  /** Set false to route the raw text without the Bengali bridge. */
  expand?: boolean;
};

/** Deterministic scorer: weight / df^0.4, plus exact name and slug bonuses. */
export function routeSkills(
  library: SkillLibrary,
  text: string,
  options: RouteOptions = {},
): SkillMatch[] {
  const limit = Math.min(Math.max(Number(options.limit) || 2, 1), 20);
  const minScore = Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : 3.0;
  const query = options.expand === false ? normalizeText(text) : expandQuery(text, library.intents);
  const tokens = tokenize(query).slice(0, 40);
  if (tokens.length === 0) return [];

  const scores = new Map<string, number>();
  const matched = new Map<string, string[]>();
  for (const token of tokens) {
    const postings = library.termMap.get(token);
    if (!postings) continue;
    const frequency = Math.max(library.df.get(token) ?? 1, 1);
    for (const [skillId, weight] of postings) {
      const contribution = Math.max(0.15, weight / Math.pow(frequency, 0.4));
      scores.set(skillId, (scores.get(skillId) ?? 0) + contribution);
      const terms = matched.get(skillId);
      if (terms) terms.push(token);
      else matched.set(skillId, [token]);
    }
  }
  if (scores.size === 0) return [];

  const haystack = query.toLowerCase();
  const matches: SkillMatch[] = [];
  for (const [skillId, base] of scores.entries()) {
    const skill = library.byId.get(skillId);
    if (!skill) continue;
    const terms = matched.get(skillId) ?? [];
    let score = base + 0.35 * Math.max(terms.length - 1, 0);
    if (haystack.includes(skill.name.toLowerCase())) score += 10;
    const slugWords = skill.slug.replace(/-/g, " ");
    if (slugWords && haystack.includes(slugWords)) score += 6;
    if (score < minScore) continue;
    matches.push({
      ...skill,
      score: Math.round(score * 100) / 100,
      hits: terms.length,
      matchedTerms: terms.slice(0, 8),
    });
  }
  matches.sort((a, b) => b.score - a.score);
  const top: SkillMatch[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    if (seen.has(match.slug)) continue;
    seen.add(match.slug);
    top.push(match);
    if (top.length >= limit) break;
  }
  return top;
}

// ---------------------------------------------------------------------------
// Skill-lite cards

export function cardFile(dir: string, slug: string): string {
  return path.join(dir, "cards", `${String(slug).replace(/[^a-z0-9-]/gi, "_")}.yaml`);
}

/** Return the cached YAML card, or build and cache one from the database row. */
export function skillCardFor(library: SkillLibrary, match: SkillMatch, maxChars?: number): string {
  const file = cardFile(library.dir, match.slug);
  try {
    const cached = fs.readFileSync(file, "utf8");
    if (cardMatches(cached, match.slug, match.content_hash)) return cached;
  } catch {
    /* no usable card yet */
  }
  const card = skillCard(
    {
      slug: match.slug,
      name: match.name,
      description: match.description,
      source: match.source,
      license: match.license,
      contentHash: match.content_hash,
      score: match.score > 0 ? match.score : undefined,
      matchedTerms: match.matchedTerms,
      body: match.body,
    },
    { maxChars },
  );
  try {
    writeAtomic(file, card);
  } catch {
    /* a read-only install still routes; the card just is not cached */
  }
  return card;
}

export type SkillLiteMatch = {
  slug: string;
  name: string;
  score: number;
  source: string;
  license: string;
};

export type SkillLiteSection = {
  available: boolean;
  dir: string;
  matches: SkillLiteMatch[];
  text: string;
  bytes: number;
  reason?: string;
};

export type SkillLiteOptions = {
  dir?: string;
  installRoot?: string;
  /** Project root used to detect the stack when the YAML database is absent. */
  projectRoot?: string;
  /** Total character budget for the cards in the context pack. */
  budget?: number;
  limit?: number;
  minScore?: number;
};

/**
 * Route one user message and return up to two compact YAML cards. Never throws:
 * a missing database falls back to the installed native stack skill; if that
 * also has no match, it returns `available: false` and the pack stays exactly
 * as it was.
 */
export function skillLiteSection(text: string, options: SkillLiteOptions = {}): SkillLiteSection {
  const dir = path.resolve(options.dir ?? skillDbDir(options.installRoot ?? process.cwd()));
  const request = String(text ?? "").trim();
  if (!request) return { available: false, dir, matches: [], text: "", bytes: 0, reason: "empty request" };
  const library = loadSkillLibrary(dir);
  const native = () =>
    nativeSkillLiteSection({
      text: request,
      installRoot: options.installRoot ?? "",
      projectRoot: options.projectRoot ?? "",
      budget: options.budget,
      limit: options.limit,
    });
  const nativeWithReason = (reason: string) => {
    const section = native();
    return section ? { ...section, reason } : null;
  };
  if (!library) {
    // A missing 256-skill database must not mean "no skill": the installer's
    // native SKILL.md files are still on disk and the stack already names the
    // one this project needs.
    return (
      nativeWithReason("skill database not downloaded; routed from installed native skills and project stack") ?? {
        available: false,
        dir,
        matches: [],
        text: "",
        bytes: 0,
        reason: "skill database not downloaded",
      }
    );
  }
  const limit = Math.min(Math.max(Number(options.limit) || 2, 1), 2);
  const budget = Math.max(Number(options.budget) || 700, 200);
  const matches = routeSkills(library, request, {
    limit,
    minScore: options.minScore ?? 3.0,
  });
  if (matches.length === 0) {
    // The DB can be present and still route zero matches for a short Bengali
    // input (the reported "বিসমাল্লাহ" case). Fall back to the installed stack
    // skill instead of sending an empty Skill-lite section.
    return (
      nativeWithReason("skill database has no match for this request; routed from installed native skills and project stack") ?? {
        available: true,
        dir,
        matches: [],
        text: "",
        bytes: 0,
      }
    );
  }
  // Greedy: the best skill gets a full card; a second card is added only when it
  // still fits the budget. A thin second card is worse than one useful card.
  const cards: string[] = [];
  const included: SkillLiteMatch[] = [];
  let used = 0;
  for (const match of matches) {
    const remaining = budget - used;
    if (remaining < 240) break;
    const card = skillCardFor(library, match, Math.min(remaining, 650)).trim();
    if (!card) continue;
    const cost = card.length + (cards.length > 0 ? 2 : 0);
    if (cost > remaining) break;
    cards.push(card);
    included.push({
      slug: match.slug,
      name: match.name,
      score: match.score,
      source: match.source,
      license: match.license,
    });
    used += cost;
  }
  let output = cards.join("\n\n");
  if (output.length > budget) {
    const cut = output.lastIndexOf("\n", budget);
    output = output.slice(0, cut > 0 ? cut : budget).trimEnd();
  }
  return {
    available: true,
    dir,
    matches: included,
    text: output,
    bytes: Buffer.byteLength(output, "utf8"),
  };
}

export type SkillRouteResult = {
  available: boolean;
  dir: string;
  query: string;
  expanded: string;
  matches: SkillLiteMatch[];
  cards: string;
  reason?: string;
};

/** Tool-facing route: the same scorer, with the expanded query for evidence. */
export function routeSkillText(text: string, options: SkillLiteOptions = {}): SkillRouteResult {
  const dir = path.resolve(options.dir ?? skillDbDir(options.installRoot ?? process.cwd()));
  const library = loadSkillLibrary(dir);
  if (!library) {
    return { available: false, dir, query: String(text ?? ""), expanded: "", matches: [], cards: "", reason: "skill database not downloaded" };
  }
  const expanded = expandQuery(String(text ?? ""), library.intents);
  const matches = routeSkills(library, text, {
    limit: options.limit ?? 5,
    minScore: options.minScore ?? 3.0,
  });
  return {
    available: true,
    dir,
    query: String(text ?? ""),
    expanded,
    matches: matches.map((match) => ({
      slug: match.slug,
      name: match.name,
      score: match.score,
      source: match.source,
      license: match.license,
    })),
    cards: matches.map((match) => skillCardFor(library, match).trim()).join("\n\n"),
  };
}

export function findSkillBySlug(dir: string, slug: string): SkillRecord | null {
  const library = loadSkillLibrary(dir);
  if (!library) return null;
  return library.bySlug.get(String(slug ?? "").trim()) ?? null;
}

/** Tool-facing get: a compact YAML card (or the full body on explicit request). */
export function skillBySlug(
  dir: string,
  slug: string,
  options: { maxChars?: number } = {},
): { record: SkillRecord; card: string } | null {
  const library = loadSkillLibrary(dir);
  if (!library) return null;
  const record = library.bySlug.get(String(slug ?? "").trim());
  if (!record) return null;
  const card = skillCardFor(
    library,
    { ...record, score: 0, hits: 0, matchedTerms: [] },
    options.maxChars,
  );
  return { record, card };
}
