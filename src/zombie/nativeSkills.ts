// Native skill fallback routing.
//
// The 256-skill YAML database is optional. The installer already ships a small
// set of native SKILL.md files; when the database is missing (or routes zero
// matches), the project's own stack must still select the skill that is
// installed. This module reads those files, scores them against the request
// and the detected stack, and renders the same compact card shape as the DB
// router. Skill text is untrusted reference, never permission to run a
// command.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parseFrontmatter } from "./frontmatter.ts";
import { installSkillsDir, nativeSkillsDir } from "./paths.ts";
import { detectProjectSkills } from "./skillCatalog.ts";
import { skillCard } from "./skillCard.ts";

export type NativeSkillMatch = {
  slug: string;
  name: string;
  score: number;
  source: string;
  license: string;
};

export type NativeSkillLite = {
  available: boolean;
  dir: string;
  matches: NativeSkillMatch[];
  text: string;
  bytes: number;
  reason?: string;
};

type NativeSkill = {
  slug: string;
  name: string;
  description: string;
  body: string;
  file: string;
};

const STACK_PRIORITY: Record<string, number> = {
  laravel: 4,
  "laravel-market": 5,
  next: 4,
  python: 3,
  fastapi: 4,
  node: 2,
  typescript: 2,
  cpanel: 3,
  tailwind: 2,
  server: 1,
};

const CORE_SKILLS = new Set([
  "first-principles",
  "evidence-before-confidence",
  "resource-optimization",
  "server",
]);

function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u0980-\u09ff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function candidates(installRoot: string): NativeSkill[] {
  const out: NativeSkill[] = [];
  const seen = new Set<string>();
  const add = (file: string, fallbackSlug: string): void => {
    let raw = "";
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    const parsed = parseFrontmatter(raw);
    const slug = String(parsed.data.name ?? fallbackSlug).trim().toLowerCase();
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    out.push({
      slug,
      name: String(parsed.data.name ?? slug),
      description: String(parsed.data.description ?? ""),
      body: parsed.body,
      file,
    });
  };
  try {
    for (const entry of fs.readdirSync(nativeSkillsDir(installRoot), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      add(path.join(nativeSkillsDir(installRoot), entry.name, "SKILL.md"), entry.name);
    }
  } catch {
    // no native directory
  }
  try {
    for (const entry of fs.readdirSync(installSkillsDir(installRoot), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      add(path.join(installSkillsDir(installRoot), entry.name), entry.name.replace(/\.md$/i, ""));
    }
  } catch {
    // no flat directory
  }
  return out;
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export function nativeSkillLiteSection(input: {
  text: string;
  installRoot: string;
  projectRoot: string;
  budget?: number;
  limit?: number;
}): NativeSkillLite | null {
  const installRoot = String(input.installRoot ?? "").trim();
  const projectRoot = String(input.projectRoot ?? "").trim();
  const request = String(input.text ?? "").trim();
  if (!installRoot || !projectRoot || !request) return null;
  const found = candidates(installRoot);
  if (found.length === 0) return null;
  const detected = new Set(detectProjectSkills(projectRoot));
  const tokens = new Set(tokenize(request).slice(0, 40));
  const lower = request.toLowerCase();
  const scored: Array<NativeSkill & { score: number; matchedTerms: string[] }> = [];
  for (const candidate of found) {
    const matchedTerms: string[] = [];
    let score = 0;
    if (detected.has(candidate.slug)) score += 8;
    score += STACK_PRIORITY[candidate.slug] ?? 0;
    if (lower.includes(candidate.slug) || lower.includes(candidate.name.toLowerCase())) {
      score += 10;
      matchedTerms.push(candidate.slug);
    }
    const haystack = (candidate.name + " " + candidate.description).toLowerCase();
    for (const token of tokens) {
      if (!haystack.includes(token)) continue;
      score += 2;
      if (matchedTerms.length < 6) matchedTerms.push(token);
    }
    if (CORE_SKILLS.has(candidate.slug)) score -= 3;
    if (score <= 0) continue;
    scored.push({ ...candidate, score, matchedTerms });
  }
  scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  const limit = Math.min(Math.max(Number(input.limit) || 2, 1), 2);
  const budget = Math.max(Number(input.budget) || 700, 200);
  const header = scored[0]
    ? "- Native skill fallback: load with skill(name=\"" +
      scored[0].slug +
      "\") before the baseline; a card is a trigger, not proof of use."
    : "";
  // The header is part of the section budget; do not let it push the card past
  // the caller's limit (the context pack measures the whole section).
  const cardCap = Math.max(240, budget - Buffer.byteLength(header, "utf8") - 2);
  const cards: string[] = [];
  const matches: NativeSkillMatch[] = [];
  let used = 0;
  for (const candidate of scored.slice(0, limit)) {
    const remaining = budget - used;
    if (remaining < 240) break;
    const card = skillCard(
      {
        slug: candidate.slug,
        name: candidate.name,
        description: candidate.description,
        source: "native:" + candidate.file,
        license: "local install",
        contentHash: digest(candidate.body),
        score: candidate.score,
        matchedTerms: candidate.matchedTerms,
        body: candidate.body,
      },
      { maxChars: Math.min(remaining, cardCap) },
    ).trim();
    if (!card) continue;
    cards.push(card);
    matches.push({
      slug: candidate.slug,
      name: candidate.name,
      score: candidate.score,
      source: "native:" + candidate.file,
      license: "local install",
    });
    used += card.length + (cards.length > 1 ? 2 : 0);
  }
  if (matches.length === 0) return null;
  const text = header + "\n\n" + cards.join("\n\n");
  return {
    available: true,
    dir: nativeSkillsDir(installRoot),
    matches,
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    reason: "skill database not downloaded; routed from installed native skills and project stack",
  };
}
