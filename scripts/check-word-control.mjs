#!/usr/bin/env node
// Word-control check: the contract gate's contains mode must match the expected
// marker as a whole word, never inside a longer identifier. The same word rule
// is proved for the visible card, the judge gate and the shipped markers.
//
//   node --experimental-strip-types scripts/check-word-control.mjs
//
// Final line: WORD_CONTROL_OK

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { containsMarker, matches } from "../src/zombie/goalContract.ts";
import { buildJudgePrompt, judgeGate, parseJudgeVerdict } from "../src/zombie/intentJudge.ts";
import { hasEmojiOrIcon, uiCard } from "../src/zombie/uiCard.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

function tail(result, lines = 3) {
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return text.split("\n").filter(Boolean).slice(-lines).join(" | ");
}

// 1. The marker is a whole word.
const MARKER = "UI_SURFACE_OK";
check("exact marker passes", matches(MARKER, MARKER, "contains"));
check("marker in a sentence passes", matches(`result: ${MARKER}\n`, MARKER, "contains"));
check("marker before punctuation passes", matches(`${MARKER}.`, MARKER, "contains"));
check("marker with a suffix fails", !matches(`${MARKER}AY`, MARKER, "contains"));
check("marker with a prefix fails", !matches(`NOT_${MARKER}`, MARKER, "contains"));
check("marker with an underscore suffix fails", !matches(`${MARKER}_2`, MARKER, "contains"));
check("plain word suffix fails", !matches("worldwide", "world", "contains"));
check("plain word prefix fails", !matches("underworld", "world", "contains"));
check("unicode word suffix fails", !matches("মার্কারগুলো", "মার্কার", "contains"));
check("unicode exact marker passes", matches("মার্কার", "মার্কার", "contains"));
check("blank expected never matches", !matches("anything", "   ", "contains"));
check(
  "containsMarker agrees with matches",
  containsMarker(`a ${MARKER} b`, MARKER) && !containsMarker(`${MARKER}_x`, MARKER),
);

// 2. The other match modes keep their word rules.
check("equals stays exact", matches("ok", "ok", "equals") && !matches("okay", "ok", "equals"));
check(
  "regex stays anchored when asked",
  matches("id=7", "^id=\\d+$", "regex") && !matches("xid=7", "^id=\\d+$", "regex"),
);
check(
  "json stays exact",
  matches('{"a":1}', '{"a":1}', "json") && !matches('{"a":1,"b":2}', '{"a":1}', "json"),
);

// 3. The visible card keeps the full words and drops symbols.
const longText = `কাজের ফল ${"ধাপ ".repeat(200)}শেষ`;
const card = uiCard({ sessionID: "ses_word", kind: "word-control", text: longText });
check("card keeps the full text", card.description === longText.trim(), `${card.description.length} chars`);
check("card has no emoji or icon", !hasEmojiOrIcon(card.description));
check(
  "card uses the goal surface",
  card.metadata.source === "goal" && card.metadata.kind === "word-control",
);
const decorated = uiCard({
  sessionID: "ses_word",
  kind: "word-control",
  text: "hello 🚀 world → done ✅",
});
check(
  "card strips decorative symbols but keeps the words",
  !hasEmojiOrIcon(decorated.description) &&
    decorated.description.includes("hello") &&
    decorated.description.includes("world") &&
    decorated.description.includes("done"),
  decorated.description,
);

// 4. The judge gate releases only on the exact PASS word.
const verdictBase = {
  contractID: "gc-word",
  reason: "real check",
  at: "2026-11-23T00:00:00.000Z",
};
check(
  "exact PASS releases",
  judgeGate({ due: true, contractID: "gc-word", verdict: { ...verdictBase, status: "PASS" } }).ok,
);
check(
  "PASSED does not release",
  !judgeGate({ due: true, contractID: "gc-word", verdict: { ...verdictBase, status: "PASSED" } }).ok,
);
check(
  "lowercase pass does not release",
  !judgeGate({ due: true, contractID: "gc-word", verdict: { ...verdictBase, status: "pass" } }).ok,
);
check(
  "FAIL blocks",
  !judgeGate({ due: true, contractID: "gc-word", verdict: { ...verdictBase, status: "FAIL" } }).ok,
);
check(
  "another contract blocks",
  !judgeGate({ due: true, contractID: "gc-other", verdict: { ...verdictBase, status: "PASS" } }).ok,
);
check(
  "verdict words are exact",
  parseJudgeVerdict("JUDGE_VERDICT: PASS")?.status === "PASS" &&
    parseJudgeVerdict("JUDGE_VERDICT: FAIL")?.status === "FAIL" &&
    parseJudgeVerdict("JUDGE_VERDICT: PASSED") === null &&
    parseJudgeVerdict("JUDGE_VERDICT: pass") === null,
);

// 5. The judge prompt is word-driven, not provider-driven.
const prompt = buildJudgePrompt({
  originalRequest: "control the words",
  contract: {
    id: "gc-word",
    goal: "word control",
    deliverable: "a whole-word gate",
    result: "the gate",
    scope: ".",
    openedAt: "2026-11-23T00:00:00.000Z",
    expected: "WORD_CONTROL_OK",
    check: "node --experimental-strip-types scripts/check-word-control.mjs",
  },
  syllabusExcerpt: "lesson: word boundaries matter",
  skillLite: "skill: test-planning",
  evidence: [],
});
check(
  "judge prompt has no provider or model name",
  !/(?:gpt|claude|gemini|deepseek|openai|anthropic|llama|qwen)/i.test(prompt),
);
check(
  "judge prompt requires the exact verdict words",
  prompt.includes("JUDGE_VERDICT: PASS") && prompt.includes("JUDGE_VERDICT: FAIL"),
);

// 6. Every shipped check prints its marker as a whole word.
const markerScripts = {
  "scripts/check-claim-gate.mjs": "CLAIM_GATE_OK",
  "scripts/check-release.mjs": "RELEASE_GATE_OK",
  "scripts/check-clone-install.mjs": "CLONE_INSTALL_OK",
  "scripts/check-install-assets.mjs": "INSTALL_ASSETS_PRUNE_OK",
  "scripts/check-skill-library-yaml.mjs": "SKILL_LIBRARY_YAML_OK",
  "scripts/check-ui-surface.mjs": "UI_SURFACE_OK",
  "scripts/check-intent-judge.mjs": "INTENT_JUDGE_OK",
  "scripts/check-install-surface.mjs": "INSTALL_SURFACE_OK",
  "scripts/check-word-control.mjs": "WORD_CONTROL_OK",
};
for (const [file, marker] of Object.entries(markerScripts)) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  const whole = containsMarker(text, marker);
  const printed = /console\.(?:log|error)\(/.test(text);
  check(`${file} prints ${marker} as a whole word`, whole && printed);
}

// 7. The installed roster still has all ten agents, including intent-judge.
try {
  const installedRoster = path.join(
    os.homedir(),
    ".config",
    "opencode",
    "plugins",
    "zombiecoder",
    "roster.ts",
  );
  const installed = await import(pathToFileURL(installedRoster).href);
  const ids = (installed.ROSTER ?? []).map((agent) => agent.id);
  check(
    "installed roster exposes ten agents",
    ids.length === 10 && ids.includes("intent-judge"),
    ids.join(", "),
  );
} catch (error) {
  check("installed roster exposes ten agents", false, String(error?.message ?? error));
}

// 8. Regression: the full suite and the existing word surfaces still pass.
const typecheck = spawnSync("npm", ["run", "typecheck"], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 60000,
});
check("typecheck passes", typecheck.status === 0, tail(typecheck));

const tests = spawnSync("npm", ["test"], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 90000,
});
const testText = `${tests.stdout ?? ""}\n${tests.stderr ?? ""}`;
check(
  "full test suite passes",
  tests.status === 0 && /ℹ fail 0\b/.test(testText),
  (testText.match(/ℹ (?:tests|pass|fail) \d+/g) ?? []).join(", ") || tail(tests),
);

for (const [file, marker] of [
  ["scripts/check-ui-surface.mjs", "UI_SURFACE_OK"],
  ["scripts/check-intent-judge.mjs", "INTENT_JUDGE_OK"],
]) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(ROOT, file)],
    { cwd: ROOT, encoding: "utf8", timeout: 60000 },
  );
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  check(
    `${file} still prints ${marker}`,
    result.status === 0 && containsMarker(text, marker),
    tail(result),
  );
}

if (failures.length === 0) {
  console.log("WORD_CONTROL_OK");
} else {
  console.error(`WORD_CONTROL_FAILED ${failures.join(", ")}`);
  process.exitCode = 1;
}
