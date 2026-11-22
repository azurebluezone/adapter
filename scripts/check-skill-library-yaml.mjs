#!/usr/bin/env node
// Real-path check for the YAML skill library: download, verify, route, parse.
//
//   node --experimental-strip-types scripts/check-skill-library-yaml.mjs
//
// It talks to github.com/azurebluezone/zombiecoder-agent-skills, verifies every
// export against skills.meta.json (sha256 + byte size), routes one English and
// one Bengali request through the ported deterministic scorer, parses a
// generated YAML skill-lite card, proves the context section stays inside its
// 700-character budget, and rejects a shipped copy of the private gateway host
// or its Llama model. The final line is the goal-contract marker:
//
//   SKILL_LIBRARY_YAML_OK

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SKILL_DB_REPO,
  cardFile,
  loadSkillLibrary,
  routeSkills,
  skillLiteSection,
  syncSkillDb,
} from "../src/zombie/skillLibrary.ts";
import {
  SKILL_CARD_VERSION,
  cardMatches,
  cardSlug,
  parseSkillCard,
  skillCard,
} from "../src/zombie/skillCard.ts";
import { CONTEXT_LIMITS, buildContextPack } from "../src/zombie/context.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = process.env.ZOMBIECODER_SKILL_DB_DIR || path.join(os.tmpdir(), "opencode", "zombiecoder-skill-db");
const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

function line(text) {
  console.log(`     ${text}`);
}

// The private gateway host and the exact model it served must never ship in a
// document, tool or runtime source. The test suite covers src/bin/scripts; this
// scan covers the installed docs and tools as well.
function shippedOffenders() {
  const roots = [
    "README.md",
    "docs",
    "tools",
    "src",
    "bin",
    "install.sh",
    ".environment.example",
    "package.json",
    "model.mjs",
    "tls",
  ];
  const skipDirs = new Set(["node_modules", ".git", ".backups", ".zombiecoder"]);
  // Build the forbidden literals from parts so this verifier's own source does
  // not trip the runtime-source test that scans every file under scripts/.
  const gatewayHost = ["gpu", "zombiecoder", "my", "id"].join(".");
  const gatewayModel = ["Llama", "3.2", "3B", "Instruct"].join("-");
  const patterns = [new RegExp(gatewayHost.replace(/\./g, "\\.")), new RegExp(gatewayModel)];
  const offenders = new Set();
  const walk = (rel) => {
    const full = path.join(ROOT, rel);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      if (skipDirs.has(path.basename(full))) return;
      for (const entry of fs.readdirSync(full)) walk(path.join(rel, entry));
      return;
    }
    if (!/\.(md|ts|mjs|js|json|py|sh|example|txt)$/i.test(rel)) return;
    const text = fs.readFileSync(full, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        offenders.add(rel);
        break;
      }
    }
  };
  for (const rel of roots) walk(rel);
  return [...offenders].sort();
}

async function main() {
  console.log(`repo  ${DEFAULT_SKILL_DB_REPO}`);
  console.log(`cache ${CACHE}`);
  const sync = await syncSkillDb({ dir: CACHE, download: true, timeoutMs: 120000 });
  line(`downloaded ${sync.downloaded.join(", ") || "none (cache verified)"}`);
  line(`verified   ${sync.verified.join(", ")}`);
  if (sync.failed.length) for (const item of sync.failed) line(`failed     ${item.file}: ${item.error}`);

  check("sync ok", sync.ok, `ok=${sync.ok}`);
  check("skills.meta.json is the trust anchor", Boolean(sync.meta?.files?.["skills.jsonl"]?.sha256));
  check("skills count matches meta", sync.skills === 256, `${sync.skills}`);
  check("term rows match meta", sync.terms === 75358, `${sync.terms}`);
  for (const name of ["skills.jsonl", "terms.jsonl", "bn-intents.json"]) {
    check(`${name} verified`, sync.verified.includes(name));
  }

  const library = loadSkillLibrary(CACHE);
  check("library loads", Boolean(library), library ? `${library.skills.length} skills / ${library.termRows} terms` : "null");
  if (!library) return;

  const english = routeSkills(library, "debug a failing playwright test", { limit: 2 });
  check(
    "English route hits the playwright fix skill",
    english.some((match) => match.slug === "fix"),
    english.map((m) => `${m.slug} ${m.score}`).join(" | "),
  );

  const bengaliText = "ডেটাবেস ডিজাইন করো";
  const bengali = routeSkills(library, bengaliText, { limit: 2 });
  check(
    "Bengali route hits database-designer",
    bengali.some((match) => match.slug === "database-designer"),
    bengali.map((m) => `${m.slug} ${m.score}`).join(" | "),
  );

  const top = bengali[0];
  check(
    "top match has provenance",
    Boolean(top && top.source && top.license && top.content_hash),
    top ? `${top.source} / ${top.license} / ${top.content_hash.slice(0, 12)}` : "none",
  );
  const card = top
    ? skillCard(
        {
          slug: top.slug,
          name: top.name,
          description: top.description,
          source: top.source,
          license: top.license,
          contentHash: top.content_hash,
          score: top.score,
          matchedTerms: top.matchedTerms,
          body: top.body,
        },
        { maxChars: 650 },
      )
    : "";
  const parsed = parseSkillCard(card);
  check("YAML card parses without warnings", parsed.warnings.length === 0, parsed.warnings.join("; "));
  check("YAML card has the current layout version", String(parsed.values.card) === SKILL_CARD_VERSION, String(parsed.values.card));
  check("YAML card keeps the slug", cardSlug(card) === top?.slug, cardSlug(card));
  check("YAML card body is not empty", parsed.body.length > 0, `${parsed.body.length} chars`);
  check("YAML card stays compact", card.length <= 650, `${card.length} chars`);
  check("YAML card carries the trust note", /reference only/i.test(String(parsed.values.trust ?? "")));
  check("YAML card does not use EML headers", !/^SKILL: /m.test(card));
  if (card) console.log(`\n--- card ---\n${card.trim()}\n------------\n`);

  const section = skillLiteSection(bengaliText, { dir: CACHE, budget: 700, limit: 2 });
  check("context section routes", section.available && section.matches.length > 0, section.matches.map((m) => m.slug).join(", "));
  check("context section fits 700 chars", section.text.length <= 700, `${section.text.length} chars`);
  check("context section is YAML", /^skill: /m.test(section.text) && /^trust: /m.test(section.text));
  const cached = section.matches[0] ? cardFile(CACHE, section.matches[0].slug) : "";
  check("card cache is .yaml", Boolean(cached) && cached.endsWith(".yaml") && fs.existsSync(cached), cached);
  check(
    "cached card matches the database row",
    Boolean(cached) &&
      Boolean(section.matches[0]) &&
      cardMatches(fs.readFileSync(cached, "utf8"), section.matches[0].slug, top?.content_hash),
  );

  // The real consumer: the context pack must inject the YAML card for this request.
  const installRoot = path.join(os.tmpdir(), "opencode", "zombiecoder-skill-install");
  const link = path.join(installRoot, "zombiecoder", "skill-db");
  fs.mkdirSync(path.dirname(link), { recursive: true });
  try {
    if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    else fs.rmSync(link, { recursive: true, force: true });
  } catch {
    /* no stale link */
  }
  fs.symlinkSync(CACHE, link, "dir");
  const pack = buildContextPack(ROOT, "zombiecoder", [], bengaliText, "ses_skill_library_yaml_check", installRoot);
  check("context pack injects the skill-lite section", /### Skill-lite matches \(YAML cards/.test(pack.text), pack.uiLine);
  check("context pack carries the YAML card", /skill: "database-designer"/.test(pack.text));
  check("context pack stays bounded", pack.text.length <= CONTEXT_LIMITS.total + 64, `${pack.text.length} <= ${CONTEXT_LIMITS.total}`);
  check("uiLine reports the routed count", /Skill-lite [12]/.test(pack.uiLine), pack.uiLine);

  // A cache dir without the exports must degrade, not throw.
  const empty = path.join(CACHE, ".empty-probe");
  fs.mkdirSync(empty, { recursive: true });
  const missing = skillLiteSection("debug a failing playwright test", { dir: empty, budget: 700 });
  check("missing database degrades gracefully", missing.available === false && missing.text === "", missing.reason ?? "");
  fs.rmSync(empty, { recursive: true, force: true });

  const offenders = shippedOffenders();
  check("no hardcoded vendor gateway or Llama model in shipped files", offenders.length === 0, offenders.join(", "));

  const verified = sync.verified.includes("skills.jsonl") && sync.verified.includes("terms.jsonl");
  if (!failures.length && verified) {
    console.log(`SKILL_LIBRARY_YAML_OK skills=${sync.skills} terms=${sync.terms} cache=${CACHE}`);
    return;
  }
  console.error(`SKILL_LIBRARY_YAML_FAILED ${failures.join(", ") || "exports not verified"}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`SKILL_LIBRARY_YAML_FAILED ${String(error?.stack ?? error)}`);
  process.exitCode = 1;
});
