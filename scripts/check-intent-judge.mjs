#!/usr/bin/env node
// Intent-judge check: the trigger, the release gate, the prompt provenance,
// the contract block and the per-tool scope monitor.
//
//   node --experimental-strip-types scripts/check-intent-judge.mjs
//
// The check imports the real modules; it does not grep for strings. A broken
// trigger boundary, a gate that releases a FAIL, or a prompt that carries the
// worker's summary instead of the original request fails here.
//
// Final line: INTENT_JUDGE_OK

import { AGENT_IDS } from "../src/agents/types.ts";
import { AGENT_CONTROLLERS, getAgentController } from "../src/agents/index.ts";
import { DOMAIN_SKILLS } from "../src/agents/domainSkills.ts";
import {
  JUDGE_DELAY_MS,
  buildJudgePrompt,
  judgeDue,
  judgeGate,
  mutationInScope,
  parseJudgeVerdict,
} from "../src/zombie/intentJudge.ts";
import { formatContractBlock, parseContract } from "../src/zombie/goalContract.ts";

const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

// 1. The tenth agent exists, has a real persona and a domain knowledge base.
const judge = getAgentController("intent-judge");
check("intent-judge is in AGENT_IDS", AGENT_IDS.includes("intent-judge"));
check("intent-judge is in the roster", Boolean(judge));
const judgePrompt = judge?.prompt() ?? "";
check("intent-judge has a non-empty persona", judgePrompt.length > 500, `${judgePrompt.length} bytes`);
check(
  "intent-judge prompt carries its domain skills",
  /Domain Skills:/.test(judgePrompt) &&
    ["Original-intent reconstruction", "Path and symbol verification", "Independent PASS/FAIL adjudication"].every(
      (skill) => judgePrompt.includes(skill),
    ),
);
check(
  "intent-judge has at least 5 domain skills",
  (DOMAIN_SKILLS["intent-judge"] ?? []).length >= 5,
  `${(DOMAIN_SKILLS["intent-judge"] ?? []).length} skills`,
);

// 2. Every roster id is unique and has a domain entry.
const ids = [...AGENT_IDS];
check("all agent ids are unique", new Set(ids).size === ids.length, `${ids.length} ids`);
check(
  "every agent has a domain-skill entry with at least 5 skills",
  ids.every((id) => (DOMAIN_SKILLS[id] ?? []).length >= 5),
  ids.filter((id) => (DOMAIN_SKILLS[id] ?? []).length < 5).join(", ") || "all covered",
);
check(
  "the roster and AGENT_IDS agree",
  AGENT_CONTROLLERS.length === ids.length &&
    AGENT_CONTROLLERS.every((controller) => ids.includes(controller.id)),
);

// 3. The three-minute trigger boundary.
const openedAt = "2026-11-23T00:00:00.000Z";
const openedMs = Date.parse(openedAt);
check("judge is not due at 179999 ms", judgeDue(openedAt, openedMs + 179_999) === false);
check("judge is due at 180001 ms", judgeDue(openedAt, openedMs + 180_001) === true);
check("the delay is exactly three minutes", JUDGE_DELAY_MS === 180_000);

// 4. The release gate: missing and FAIL block; PASS and the judge's own turn pass.
const pass = {
  contractID: "gc-judge",
  status: "PASS",
  reason: "src/x.ts:12 matches; node check.mjs exited 0",
  at: openedAt,
};
const fail = { ...pass, status: "FAIL", reason: "src/x.ts is missing the requested export" };
check("a due worker answer without a verdict is blocked", judgeGate({ due: true, verdict: null }).ok === false);
check("a due worker answer with a FAIL is blocked", judgeGate({ due: true, verdict: fail }).ok === false);
check("a due worker answer with a PASS is released", judgeGate({ due: true, verdict: pass }).ok === true);
check(
  "the judge's own turn is released without a prior verdict",
  judgeGate({ due: true, verdict: null, judgeTurn: true }).ok === true,
);
check(
  "a verdict for another contract is stale",
  judgeGate({ due: true, verdict: pass, contractID: "gc-other" }).ok === false,
);
check(
  "before the deadline a worker needs no verdict",
  judgeGate({ due: false, verdict: null }).ok === true,
);

// 5. The judge prompt carries the original request and the contract, never the
//    worker's summary. The extra property is ignored at runtime.
const originalRequest = "ORIGINAL_USER_INTENT: add a judge that reads path:line evidence";
const workerSummary = "WORKER_SUMMARY_SECRET: everything is done, trust me";
const prompt = buildJudgePrompt({
  originalRequest,
  contract: {
    id: "gc-judge",
    goal: "add the intent judge",
    deliverable: "intent-judge agent plus the release gate",
    result: "src/zombie/intentJudge.ts exists and the check passes",
    scope: "src/agents, src/zombie, scripts",
    openedAt,
    check: "node --experimental-strip-types scripts/check-intent-judge.mjs",
    expected: "INTENT_JUDGE_OK",
  },
  syllabusExcerpt: "SYLLABUS_FACT: the user asked for path verification",
  evidence: [{ tool: "read", target: "src/zombie/intentJudge.ts", output: "export function judgeGate" }],
  workerSummary,
});
check("the judge prompt carries the original user request", prompt.includes(originalRequest));
check("the judge prompt carries the contract deliverable", prompt.includes("intent-judge agent plus the release gate"));
check("the judge prompt carries the contract result", prompt.includes("src/zombie/intentJudge.ts exists"));
check("the judge prompt carries the syllabus fact", prompt.includes("SYLLABUS_FACT"));
check("the judge prompt does not carry the worker summary", !prompt.includes("WORKER_SUMMARY_SECRET"));
check(
  "the judge prompt asks for path and compiler verification",
  /path/i.test(prompt) && /compiler|exit code/i.test(prompt),
);
check(
  "the judge's verdict line parses",
  parseJudgeVerdict("JUDGE_VERDICT: FAIL\nsrc/x.ts:1 is missing")?.status === "FAIL",
);

// 6. The contract block round-trips deliverable/result/scope/openedAt.
const block = formatContractBlock({
  id: "gc-roundtrip",
  status: "open",
  goal: "round-trip the contract",
  input: "the original user input",
  deliverable: "a judge verdict",
  result: "pending",
  scope: "src/agents, src/zombie",
  openedAt,
  expected: "INTENT_JUDGE_OK",
  check: "node check.mjs",
  pass: "exit 0 and the marker",
  match: "contains",
  guard: "v3",
});
const parsed = parseContract(block, "gc-roundtrip");
check("contract deliverable round-trips", parsed?.deliverable === "a judge verdict");
check("contract result round-trips", parsed?.result === "pending");
check("contract scope round-trips", parsed?.scope === "src/agents, src/zombie");
check("contract openedAt round-trips", parsed?.openedAt === openedAt);
check("contract check round-trips without backticks", parsed?.check === "node check.mjs");

// 7. The scope monitor blocks an out-of-scope mutation and allows an in-scope one.
check(
  "an in-scope edit is allowed",
  mutationInScope("src/agents, src/zombie", "edit", "src/agents/index.ts") === true,
);
check(
  "an out-of-scope edit is blocked",
  mutationInScope("src/agents, src/zombie", "edit", "test/plugin.test.ts") === false,
);
check(
  "a read outside the scope is still allowed",
  mutationInScope("src/agents", "read", "test/plugin.test.ts") === true,
);
check(
  "a shell write with no target is blocked when a scope exists",
  mutationInScope("src/agents", "shell", "") === false,
);
check(
  "an empty scope keeps the old behavior",
  mutationInScope(".", "edit", "test/plugin.test.ts") === true,
);

if (failures.length > 0) {
  console.error(`\nintent-judge check failed: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("\nINTENT_JUDGE_OK");
}
