import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cardMatches,
  cardSlug,
  parseSkillCard,
  skillCard,
  SKILL_CARD_VERSION,
} from "../src/zombie/skillCard.ts";
import {
  cardFile,
  clearSkillLibraryCache,
  loadSkillLibrary,
  routeSkills,
  skillLiteSection,
  syncSkillDb,
  tokenize,
} from "../src/zombie/skillLibrary.ts";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

function fixture(): string {
  const dir = tempDir("zombiecoder-skill-lib-");
  write(
    path.join(dir, "skills.jsonl"),
    jsonl([
      {
        id: "sk_a",
        slug: "database-designer",
        name: "Database Designer",
        description: "Design a database schema: tables, keys and indexes.",
        body: "# Database Designer\n\n## Tool Workflow\n\n### 1. List the entities\n### 2. Define keys and indexes\n\n## Verify\n\n- The migration applies and rolls back.\n",
        source: "test/source",
        license: "MIT",
        content_hash: "abc123def4567890",
        bytes: 160,
        active: 1,
        tags: ["database"],
        triggers: [],
      },
      {
        id: "sk_b",
        slug: "playwright-fix",
        name: "Playwright Fix",
        description: "Debug a failing playwright test.",
        body: "# Fix\n\n## Steps\n\n### 1. Reproduce the failure\n### 2. Capture the trace\n",
        source: "test/source",
        license: "MIT",
        content_hash: "def456abc1237890",
        bytes: 90,
        active: 1,
      },
      {
        id: "sk_c",
        slug: "database-designer",
        name: "Database Designer (duplicate slug)",
        description: "Second copy of the same slug.",
        body: "# Copy\n",
        source: "other/source",
        license: "MIT",
        content_hash: "ccc0000000000000",
        bytes: 8,
        active: 1,
      },
      {
        id: "sk_d",
        slug: "inactive-skill",
        name: "Inactive Skill",
        description: "Must never be routed.",
        body: "# Inactive\n",
        source: "test/source",
        license: "MIT",
        content_hash: "ddd0000000000000",
        bytes: 11,
        active: 0,
      },
    ]),
  );
  write(
    path.join(dir, "terms.jsonl"),
    jsonl([
      { term: "database", skill_id: "sk_a", weight: 8 },
      { term: "database", skill_id: "sk_c", weight: 1 },
      { term: "designer", skill_id: "sk_a", weight: 5 },
      { term: "schema", skill_id: "sk_a", weight: 3 },
      { term: "playwright", skill_id: "sk_b", weight: 8 },
      { term: "failing", skill_id: "sk_b", weight: 3 },
      { term: "inactive", skill_id: "sk_d", weight: 8 },
    ]),
  );
  write(
    path.join(dir, "bn-intents.json"),
    JSON.stringify({
      schema_version: "1.0.0",
      locale: "bn",
      max_terms: 24,
      entries: [{ bn: "ডেটাবেস", en: "database" }],
    }),
  );
  return dir;
}

test("tokenize drops stopwords, duplicates and one-character tokens", () => {
  assert.deepEqual(tokenize("The database, database schema and a 7 test"), [
    "database",
    "schema",
    "test",
  ]);
  assert.deepEqual(tokenize("ডেটাবেস ডিজাইন করো"), ["ডেটাবেস", "ডিজাইন", "করো"]);
});

test("router scores, expands Bengali and deduplicates by slug", () => {
  const dir = fixture();
  try {
    const library = loadSkillLibrary(dir);
    assert.ok(library);
    assert.equal(library.skills.length, 3, "inactive rows must be skipped");
    // The inactive skill's term row is dropped from the index as well.
    assert.equal(library.termRows, 6);

    const english = routeSkills(library, "design a database schema", { limit: 2 });
    assert.equal(english[0]?.slug, "database-designer");
    assert.ok((english[0]?.score ?? 0) >= 3, "score must cross the default threshold");
    assert.equal(
      english.filter((match) => match.slug === "database-designer").length,
      1,
      "duplicate slugs collapse to one result",
    );

    const bengali = routeSkills(library, "ডেটাবেস ডিজাইন করো", { limit: 2 });
    assert.ok(bengali.some((match) => match.slug === "database-designer"), "Bengali intent expands to database");

    assert.deepEqual(routeSkills(library, "playwright", { limit: 2 }).map((m) => m.slug), ["playwright-fix"]);
    assert.deepEqual(routeSkills(library, "schema", { minScore: 100 }), []);
    assert.deepEqual(routeSkills(library, "inactive", { limit: 2 }), []);
  } finally {
    clearSkillLibraryCache(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("YAML card round-trips fields, lists and a block-scalar body", () => {
  const card = skillCard({
    slug: "database-designer",
    name: "Database Designer",
    description: "Use when a schema changes",
    source: "test/source",
    license: "MIT",
    contentHash: "abc123def4567890",
    score: 4.5,
    matchedTerms: ["database", "schema"],
    body: "# Database Designer\n\n## Tool Workflow\n\n### 1. List the entities\n### 2. Define keys and indexes\n\n## Verify\n\n- The migration applies.\n",
  });
  const parsed = parseSkillCard(card);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.values.skill, "database-designer");
  assert.equal(String(parsed.values.card), SKILL_CARD_VERSION);
  assert.equal(parsed.values.source, "test/source");
  assert.equal(parsed.values.license, "MIT");
  assert.equal(parsed.values.hash, "abc123def456");
  assert.equal(parsed.values.score, 4.5);
  assert.deepEqual(parsed.values.match, ["database", "schema"]);
  assert.match(String(parsed.values.trust), /reference only/);
  assert.match(parsed.body, /1\. List the entities/);
  assert.match(parsed.body, /2\. Define keys and indexes/);
  assert.equal(cardSlug(card), "database-designer");
  assert.equal(cardMatches(card, "database-designer", "abc123def4567890"), true);
  assert.equal(cardMatches(card, "database-designer", "other-hash"), false);
  assert.equal(cardMatches(card, "playwright-fix", "abc123def4567890"), false);
});

test("invalid YAML becomes a warning instead of a throw", () => {
  const duplicate = parseSkillCard("skill: a\nskill: b\n\nbody: nope\n");
  assert.ok(duplicate.warnings.length > 0);
  assert.equal(duplicate.values.skill, undefined);
  assert.equal(cardSlug("skill: a\nskill: b\n"), "");

  const missing = parseSkillCard("card: 3\n\nbody: x\n");
  assert.ok(missing.warnings.some((warning) => /missing skill/.test(warning)));

  const tabbed = parseSkillCard("\tskill: a\n");
  assert.ok(tabbed.warnings.some((warning) => /tab indentation/.test(warning)));

  const empty = parseSkillCard("");
  assert.ok(empty.warnings.some((warning) => /missing skill/.test(warning)));
});

test("skill card stays compact, keeps provenance and names the real steps", () => {
  const dir = fixture();
  try {
    const library = loadSkillLibrary(dir);
    assert.ok(library);
    const [match] = routeSkills(library, "database schema", { limit: 1 });
    const card = skillCard(
      {
        slug: match.slug,
        name: match.name,
        description: match.description,
        source: match.source,
        license: match.license,
        contentHash: match.content_hash,
        score: match.score,
        matchedTerms: match.matchedTerms,
        body: match.body,
      },
      { maxChars: 650 },
    );
    const parsed = parseSkillCard(card);
    assert.equal(parsed.values.skill, "database-designer");
    assert.equal(parsed.values.source, "test/source");
    assert.equal(parsed.values.license, "MIT");
    assert.equal(parsed.values.hash, "abc123def456");
    assert.match(String(parsed.values.trust), /reference only/);
    assert.match(parsed.body, /1\. List the entities/);
    assert.match(parsed.body, /2\. Define keys and indexes/);
    assert.ok(card.length <= 650, `card is ${card.length} chars`);
    assert.match(cardFile(dir, "database-designer"), /database-designer\.yaml$/);
  } finally {
    clearSkillLibraryCache(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("skill-lite section respects the budget and degrades without a database", () => {
  const dir = fixture();
  try {
    const section = skillLiteSection("ডেটাবেস ডিজাইন করো", { dir, budget: 700, limit: 2 });
    assert.equal(section.available, true);
    assert.ok(section.matches.length >= 1);
    assert.equal(section.matches[0].slug, "database-designer");
    assert.ok(section.text.length <= 700, `section is ${section.text.length} chars`);
    assert.match(section.text, /^skill: /m);
    assert.match(section.text, /^trust: /m);
    assert.match(section.text, /body: \|/);
    const cached = cardFile(dir, section.matches[0].slug);
    assert.ok(fs.existsSync(cached), "the routed card is cached as YAML");
    assert.ok(cardMatches(fs.readFileSync(cached, "utf8"), section.matches[0].slug, "abc123def4567890"));

    const empty = tempDir("zombiecoder-skill-empty-");
    try {
      const missing = skillLiteSection("database", { dir: empty, budget: 700 });
      assert.equal(missing.available, false);
      assert.equal(missing.text, "");
      assert.match(missing.reason ?? "", /not downloaded/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    clearSkillLibraryCache(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sync with download disabled reports missing files instead of throwing", async () => {
  const dir = tempDir("zombiecoder-skill-sync-");
  try {
    const result = await syncSkillDb({ dir, download: false });
    assert.equal(result.ok, false);
    assert.ok(result.failed.some((item) => item.file === "skills.jsonl"));
    assert.ok(result.failed.some((item) => item.file === "terms.jsonl"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
