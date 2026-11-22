#!/usr/bin/env node
// Visible-surface check: footprint health, automatic roadmap, the judge debate
// cards, the release gate, the UI payload shape and the context-pack sections.
//
//   node --experimental-strip-types scripts/check-ui-surface.mjs
//
// Every assertion below imports the real module or calls the real tool; a
// source scan is used only for the "no raw synthetic card" rule, where the
// point is the call site itself.
//
// Final line: UI_SURFACE_OK

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AGENT_CONTROLLERS } from "../src/agents/index.ts";
import { buildContextPack } from "../src/zombie/context.ts";
import { formatContractBlock } from "../src/zombie/goalContract.ts";
import { buildJudgePrompt, debateTranscript, judgeGate, JUDGE_MAX_QUESTIONS } from "../src/zombie/intentJudge.ts";
import { memoryCompactFile, ssotFile, syllabusFile } from "../src/zombie/paths.ts";
import { ROADMAP_MIN_FILES, roadmapFile, roadmapSummary } from "../src/zombie/roadmap.ts";
import { toolSpecs } from "../src/zombie/server.ts";
import { recordProjectFootprint } from "../src/zombie/syllabus.ts";
import { hasEmojiOrIcon, uiCard } from "../src/zombie/uiCard.ts";

const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

const tmpRoots = [];
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zc-ui-"));
  tmpRoots.push(root);
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  return root;
}

function fingerprint(root, files) {
  return {
    root,
    scannedAt: "2026-11-23T00:00:00.000Z",
    totalFiles: files.length,
    totalDirs: 8,
    totalBytes: files.length * 120,
    truncated: false,
    languages: [{ name: "TypeScript", files: files.length, bytes: files.length * 120 }],
    topLevel: [{ name: "src", kind: "dir" }],
    markers: ["package.json", ".git", "README.md"],
    manifests: { package: { name: "demo", version: "1.0.0" } },
    tree: [],
    files,
    indexedFiles: files.length,
    indexTruncated: false,
    ignored: [],
  };
}

// 1. A complete big project: the roadmap file is generated with real
//    checkboxes, and the syllabus lesson carries the health block.
const bigRoot = makeProject();
const bigFiles = [
  "package.json",
  "README.md",
  "docs/guide.md",
  "test/unit.test.ts",
  "scripts/check-demo.mjs",
  ".github/workflows/ci.yml",
  ...Array.from({ length: ROADMAP_MIN_FILES + 30 }, (_, index) => `src/mod${index % 7}/file${index}.ts`),
];
const big = recordProjectFootprint(bigRoot, fingerprint(bigRoot, bigFiles));
const bigSyllabus = fs.readFileSync(syllabusFile(bigRoot), "utf8");
const roadmapText = fs.readFileSync(roadmapFile(bigRoot), "utf8");
check("a big project writes the roadmap file", big.roadmap.big === true && big.roadmap.written === true);
check("the roadmap file carries real checkboxes", /^- \[[ x]\] /m.test(roadmapText));
check("the roadmap file names the next open item", /^## Next$/m.test(roadmapText));
check("the roadmap digest is stable and non-empty", roadmapText.includes("auto-generated"));
check(
  "the syllabus lesson carries the health block",
  bigSyllabus.includes("**Problems found**") && bigSyllabus.includes("**Roadmap**"),
);
check("a healthy big project reports no scan problem", big.problems.length === 0, big.problems.join(" | "));
const again = recordProjectFootprint(bigRoot, fingerprint(bigRoot, bigFiles));
check("the same fingerprint does not append twice", again.appended === false);

// 2. A sparse project: the real gaps are written into the syllabus.
const sparseRoot = makeProject();
const sparse = recordProjectFootprint(sparseRoot, fingerprint(sparseRoot, ["src/index.ts", "src/util.ts"]));
const sparseSyllabus = fs.readFileSync(syllabusFile(sparseRoot), "utf8");
check("a sparse project reports missing tests", sparse.problems.some((item) => /test/i.test(item)));
check("a sparse project reports the missing README", sparse.problems.some((item) => /README/i.test(item)));
check(
  "every reported problem is written to the syllabus",
  sparse.problems.every((item) => sparseSyllabus.includes(item)),
  `${sparse.problems.length} problems`,
);
check("a small project does not get a roadmap", sparse.roadmap.big === false && !fs.existsSync(roadmapFile(sparseRoot)));
check(
  "the small-project lesson says why the roadmap is absent",
  sparseSyllabus.includes(`below the ${ROADMAP_MIN_FILES}-file big-project threshold`),
);

// 3. The judge prompt is built from the original request and the syllabus, and
//    it routes real skill loading; the worker's claim has no field to hide in.
const contractBlock = formatContractBlock({
  id: "gc-ui",
  status: "open",
  goal: "Ship the visible surface",
  input: "original user request",
  deliverable: "cards and roadmap",
  result: "pending",
  scope: "src, scripts",
  openedAt: "2026-11-23T00:00:00.000Z",
  expected: "UI_SURFACE_OK",
  check: "node scripts/check-ui-surface.mjs",
  pass: "exit 0 and UI_SURFACE_OK",
  match: "contains",
  guard: "path:line evidence",
});
const judgePrompt = buildJudgePrompt({
  originalRequest: "USER_REQUEST_SENTINEL: footprint health, roadmap, judge debate and tone",
  contract: {
    id: "gc-ui",
    goal: "Ship the visible surface",
    deliverable: "cards and roadmap",
    result: "pending",
    scope: "src, scripts",
    openedAt: "2026-11-23T00:00:00.000Z",
    expected: "UI_SURFACE_OK",
    check: "node scripts/check-ui-surface.mjs",
  },
  syllabusExcerpt: `Contract gc-ui\n\n${contractBlock}`,
  evidence: [{ tool: "shell", target: "node scripts/check-ui-surface.mjs", output: "UI_SURFACE_OK" }],
});
check("the judge prompt carries the original request", judgePrompt.includes("USER_REQUEST_SENTINEL"));
check("the judge prompt carries the syllabus facts", judgePrompt.includes("### Goal Contract gc-ui"));
check(
  "the judge prompt routes skill loading",
  judgePrompt.includes("skill_catalog") && judgePrompt.includes("action=route") && judgePrompt.includes("action=get"),
);
check(
  "the judge prompt reads the syllabus and the web when version-sensitive",
  judgePrompt.includes("read_syllabus") && judgePrompt.includes("websearch"),
);
check("the judge prompt carries the routed-skill section", judgePrompt.includes("## Routed skills"));
check("the judge prompt has no worker-summary field", !/worker summary/i.test(judgePrompt));
check("the judge may ask, but the answer stays the worker's job", judgePrompt.includes("action=ask"));
check("the judge question budget is two", JUDGE_MAX_QUESTIONS === 2);

// 4. The real tool: ask, answer and record produce visible cards that show both
//    sides, and the worker cannot approve itself.
const judgeRoot = makeProject();
const contractID = "gc-ui";
fs.writeFileSync(
  syllabusFile(judgeRoot),
  `# Syllabus\n\n${contractBlock}\n\n### Investigation notes\n\n- The preview bug came from a truncated description.\n`,
);
const store = new Map();
const storage = {
  get: async (key) => (store.has(key) ? store.get(key) : null),
  set: async (key, value) => {
    store.set(key, value);
  },
  remove: async (key) => {
    store.delete(key);
  },
};
const cards = [];
const deps = {
  projectRoot: () => judgeRoot,
  installRoot: () => judgeRoot,
  storage,
  refreshSsot: () => ({ sha256: "0", file: ssotFile(judgeRoot), bytes: 0 }),
  modelPlan: () => ({}),
  synthetic: async (input) => {
    cards.push(input);
  },
};
const specs = toolSpecs(deps);
const intentJudge = specs.find((spec) => spec.name === "intent_judge");
check("the intent_judge tool is registered", Boolean(intentJudge));

await storage.set(`judge/contract/${contractID}`, {
  contractID,
  sessionID: "ses_worker",
  openedAt: new Date(Date.now() - 200_000).toISOString(),
  check: "node scripts/check-ui-surface.mjs",
  expected: "UI_SURFACE_OK",
});
await storage.set(`judge/intent/${contractID}`, {
  contractID,
  sessionID: "ses_worker",
  request: "USER_REQUEST_SENTINEL: footprint health, roadmap, judge debate and tone",
});
await storage.set("judge/agent/ses_judge", { agent: "intent-judge" });

const promptResult = await intentJudge.run({ action: "prompt", contractID }, { sessionID: "ses_worker" });
check("the tool returns the built judge prompt", String(promptResult.prompt).includes("USER_REQUEST_SENTINEL"));
check("the prompt action marks the judge due state", promptResult.due === true);

const firstAsk = await intentJudge.run(
  { action: "ask", contractID, question: "Which real file proves the roadmap is written?" },
  { sessionID: "ses_judge" },
);
check("the judge can ask one question", firstAsk.asked === 1 && firstAsk.remaining === 1);
const askCard = cards.find((card) => card.metadata?.kind === "intent-judge-question");
check("the question is visible as a card", Boolean(askCard));
check("the question card shows the judge side", Boolean(askCard) && askCard.text.includes("Which real file"));
check("the question card uses the native full-message surface", askCard?.metadata?.source === "goal");
check("the question card has no emoji or icon", askCard ? !hasEmojiOrIcon(askCard.text) : false);

const answer = await intentJudge.run(
  { action: "answer", contractID, answer: "src/zombie/roadmap.ts:233 writes the file; check output UI_SURFACE_OK." },
  { sessionID: "ses_worker" },
);
const answerCard = cards.find((card) => card.metadata?.kind === "intent-judge-answer");
check("the worker can answer the question", answer.answered === 1);
check("the answer card shows both sides", Boolean(answerCard) && answerCard.text.includes("Which real file") && answerCard.text.includes("roadmap.ts:233"));
check("the answer card has no emoji or icon", answerCard ? !hasEmojiOrIcon(answerCard.text) : false);

const secondAsk = await intentJudge.run(
  { action: "ask", contractID, question: "Which command produced the PASS evidence?" },
  { sessionID: "ses_judge" },
);
check("the judge may ask a second question", secondAsk.asked === 2);
let thirdAskFailed = false;
try {
  await intentJudge.run({ action: "ask", contractID, question: "A third question that should be refused." }, { sessionID: "ses_judge" });
} catch {
  thirdAskFailed = true;
}
check("a third question is refused", thirdAskFailed);
await intentJudge.run(
  { action: "answer", contractID, answer: "node --experimental-strip-types scripts/check-ui-surface.mjs exited 0." },
  { sessionID: "ses_worker" },
);

let selfApprovalFailed = false;
try {
  await intentJudge.run({ action: "record", contractID, status: "PASS", reason: "the worker tries to approve itself" }, { sessionID: "ses_worker" });
} catch {
  selfApprovalFailed = true;
}
check("the worker cannot record its own verdict", selfApprovalFailed);

const verdict = await intentJudge.run(
  { action: "record", contractID, status: "PASS", reason: "src/zombie/roadmap.ts:233 exists; check exited 0 with UI_SURFACE_OK" },
  { sessionID: "ses_judge" },
);
const verdictCard = cards.find((card) => card.metadata?.kind === "intent-judge-verdict");
check("the judge can record PASS", verdict.status === "PASS");
check("the verdict card shows the debate", Boolean(verdictCard) && verdictCard.text.includes("Which real file") && verdictCard.text.includes("roadmap.ts:233"));
check("the verdict card states the verdict", Boolean(verdictCard) && verdictCard.text.includes("Intent judge verdict: PASS"));
check("the verdict card has no emoji or icon", verdictCard ? !hasEmojiOrIcon(verdictCard.text) : false);

const transcript = debateTranscript({
  contractID,
  sessionID: "ses_worker",
  workerClaim: "worker claim",
  questions: [{ at: "2026-11-23T00:01:00.000Z", question: "q1", answer: "a1" }],
  verdict: { contractID, status: "FAIL", reason: "missing file", at: "2026-11-23T00:02:00.000Z", judge: "intent-judge" },
});
check(
  "the transcript keeps both sides and the verdict",
  transcript.includes("worker claim") && transcript.includes("q1") && transcript.includes("a1") && transcript.includes("FAIL"),
);

// 5. The gate: due with no verdict blocks, PASS releases, FAIL blocks, and the
//    judge's own turn is never blocked by its own gate.
const dueNow = Date.now();
const openedAt = new Date(dueNow - 200_000).toISOString();
check("due with no verdict blocks the worker", judgeGate({ due: true, verdict: null, contractID }).blocked === true);
check(
  "a PASS verdict releases the worker",
  judgeGate({
    due: true,
    verdict: { contractID, status: "PASS", reason: "evidence", at: openedAt, judge: "intent-judge" },
    contractID,
  }).blocked === false,
);
check(
  "a FAIL verdict keeps the worker blocked",
  judgeGate({
    due: true,
    verdict: { contractID, status: "FAIL", reason: "evidence", at: openedAt, judge: "intent-judge" },
    contractID,
  }).blocked === true,
);
check(
  "the judge turn itself is not blocked",
  judgeGate({
    due: true,
    verdict: null,
    contractID,
    judgeTurn: true,
  }).blocked === false,
);
check("before the delay nothing blocks", judgeGate({ due: false, verdict: null, contractID }).blocked === false);

// 6. One UI payload shape: full text in `description`, source `goal`, no
//    emoji/icon, and every synthetic call site goes through the helper.
const card = uiCard({ sessionID: "ses_ui", kind: "demo", text: "Footprint check\n\nProblems found: 2" });
check("the card keeps the full text", card.description === "Footprint check\n\nProblems found: 2");
check("the card uses the full-message source", card.metadata.source === "goal");
check("the card carries its semantic kind", card.metadata.kind === "demo");
const emojiCard = uiCard({ sessionID: "ses_ui", kind: "demo", text: "🧭 check 👋 done" });
check("emoji and icons are stripped from cards", emojiCard.text === "check  done" || emojiCard.text === "check done");
check("the emoji detector sees a real emoji", hasEmojiOrIcon("🧭 check") === true);
check("the emoji detector passes plain Bengali text", hasEmojiOrIcon("ফুটপ্রিন্ট দেখে নিলাম") === false);

for (const file of ["src/zombie/server.ts", "src/plugin.ts"]) {
  const source = fs.readFileSync(file, "utf8");
  const calls = [...source.matchAll(/deps\.synthetic\(\s*([\s\S]{0,20})/g)];
  check(
    `${file}: every synthetic call builds a uiCard`,
    calls.every((match) => match[1].trimStart().startsWith("uiCard(")),
    `${calls.length} call(s)`,
  );
  check(`${file}: no raw short description card remains`, !/description:\s*"zombiecoder/.test(source));
}

// 7. Every agent prompt carries the tone, narration, no-symbol and
//    one-question rules through the shared block.
const prompts = AGENT_CONTROLLERS.map((agent) => [agent.id, agent.prompt()]);
const requiredRules = [
  "Barishal",
  "one short Bengali line",
  "No emoji, icon, arrow, check mark or decorative symbol",
  "at most one precise question",
  "Reasoning budget",
];
check("the roster still has ten agents", prompts.length === 10, `${prompts.length}`);
for (const rule of requiredRules) {
  const missing = prompts.filter(([, prompt]) => !prompt.includes(rule)).map(([id]) => id);
  check(`every prompt carries the rule: ${rule}`, missing.length === 0, missing.join(", "));
}

// 8. The context pack shows the original intent, judge state, latest
//    investigation, roadmap and the archive pointer.
const contextRoot = bigRoot;
fs.writeFileSync(
  syllabusFile(contextRoot),
  [
    "# Syllabus",
    "",
    "### Investigation — preview bug",
    "",
    "- Root cause: the synthetic description was truncated to one line.",
    "",
    "### Goal Contract gc-ui",
    "",
    "- status: open",
    "- goal: Ship the visible surface",
    "",
  ].join("\n"),
);
fs.writeFileSync(ssotFile(contextRoot), "# SSOT\n\n## 1. Project\n\n- Name: demo\n");
fs.mkdirSync(path.dirname(memoryCompactFile(contextRoot)), { recursive: true });
fs.writeFileSync(
  memoryCompactFile(contextRoot),
  JSON.stringify({ sessions: { ses_ctx: { request: "ORIGINAL_INTENT_SENTINEL: footprint and roadmap" } } }),
);
const pack = buildContextPack(
  contextRoot,
  "zombiecoder",
  [],
  "current turn request",
  "ses_ctx",
  "",
  {
    judge: {
      due: true,
      contractID: "gc-ui",
      verdict: null,
      pendingQuestion: "Which file proves the roadmap?",
      questions: 1,
    },
  },
);
check("the pack shows the stored original intent", pack.text.includes("ORIGINAL_INTENT_SENTINEL"));
check("the pack shows the judge state", pack.text.includes("### Judge state") && pack.text.includes("Pending question"));
check("the pack shows the latest investigation lesson", pack.text.includes("### Latest investigation (syllabus)"));
check("the pack shows the roadmap", pack.text.includes("### Roadmap (auto)") && pack.text.includes(roadmapFile(contextRoot)));
check("the pack points at the append-only archive", pack.text.includes("append-only at"));
check("the pack still keeps the current request authoritative", pack.text.includes("### Current user request (source of truth)"));
const summary = roadmapSummary(contextRoot);
check("the roadmap summary exposes the next open item", Boolean(summary) && typeof summary.next === "string");

for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\nui-surface check failed: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("\nUI_SURFACE_OK");
}
