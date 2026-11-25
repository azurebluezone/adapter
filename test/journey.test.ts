// The journey cards are the user's window into the agent's work. These tests
// pin the facts each stage must show, so a refactor cannot silently drop the
// intake sizes, the deliverable, the scope check, the guard debate or the
// close summary.

import assert from "node:assert/strict";
import test from "node:test";
import { CONTEXT_OWNERS, type ContextPack } from "../src/zombie/context.ts";
import type { AgentRun } from "../src/agents/types.ts";
import {
  journeyCloseText,
  journeyContractText,
  journeyGuardText,
  journeyIntakeText,
  journeyScopeText,
} from "../src/zombie/journey.ts";
import { hasEmojiOrIcon, uiCard } from "../src/zombie/uiCard.ts";

const pack: ContextPack = {
  text: "",
  bytes: 0,
  uiLine: "",
  allowedRoot: "/tmp/demo",
  ssot: { file: "SSOT.md", exists: true, bytes: 1234, lines: 40, sha256: "0", headings: [] },
  syllabus: { file: "syllabus.md", exists: true, bytes: 5678, lines: 90, sha256: "0", headings: [] },
  ssotExcerptBytes: 0,
  syllabusExcerptBytes: 0,
  focus: {
    query: "journey",
    terms: ["journey"],
    exts: [".ts"],
    primary: [{ path: "src/plugin.ts", score: 10, reason: "test" }],
    related: [{ path: "src/zombie/server.ts", score: 8, reason: "test" }],
    text: "",
    bytes: 0,
  },
  intent: {
    kind: "change",
    confidence: "deterministic",
    terms: ["journey"],
    extensionHints: [".ts"],
    focus: null,
    reason: "test",
  },
  skillLite: null,
  openContractIDs: ["gc-test"],
  memory: { indexFile: "index.json", sessions: 1, archives: 2, recent: 10 },
  owners: CONTEXT_OWNERS,
};

const run: AgentRun = {
  version: 1,
  sessionID: "ses_test",
  agentID: "zombiecoder",
  taskKind: "substantive",
  complexity: "complex",
  phase: "intake",
  routeKey: "zc/zombiecoder/substantive/intake",
  messageHash: "0",
  turnIndex: 1,
  focus: ["src/plugin.ts"],
  contract: null,
  proposalAt: null,
  freshSyllabus: false,
  steps: [],
  startedAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
};

test("intake card shows the real context sizes, validation and route", () => {
  const text = journeyIntakeText({
    pack,
    run,
    request: "Make the journey visible",
    sanitized: 2,
  });
  assert.match(text, /ধাপ ১/);
  assert.match(text, /Syllabus: 90 লাইন, 5678 বাইট/);
  assert.match(text, /SSOT: 40 লাইন, 1234 বাইট/);
  assert.match(text, /Focus: 1 primary, 1 related — src\/plugin\.ts/);
  assert.match(text, /ইনপুট যাচাই: 2টি message পরিষ্কার/);
  assert.match(text, /Route: substantive \/ intake \(complex\)/);
  assert.match(text, /খোলা contract: gc-test/);
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
});

test("contract card states what the agent understood and what it will deliver", () => {
  const text = journeyContractText({
    goal: "Make the journey visible",
    input: "user request",
    deliverable: "plain-text cards",
    check: "node check.mjs",
    expected: "JOURNEY_UI_OK",
    pass: "exit 0 and JOURNEY_UI_OK",
    mode: "contains",
    scope: "src, scripts",
  });
  assert.match(text, /আমি যা বুঝলাম/);
  assert.match(text, /আমি যা দেব: plain-text cards/);
  assert.match(text, /PASS-এর প্রমাণ: JOURNEY_UI_OK/);
  assert.match(text, /Allow once/);
  assert.match(text, /Allow always/);
  assert.match(text, /Reject/);
});

test("scope card marks inside and outside paths", () => {
  const text = journeyScopeText({
    contractID: "gc-test",
    projectRoot: "/tmp/demo",
    scope: "src, ../outside",
    verified: [
      { path: "src", inside: true },
      { path: "../outside", inside: false },
    ],
    openedAt: "2026-11-23T00:00:00.000Z",
  });
  assert.match(text, /src — প্রজেক্ট রুটের ভিতরে/);
  assert.match(text, /\.\.\/outside — প্রজেক্ট রুটের বাইরে, অনুমতি নেই/);
  assert.match(text, /গার্ড:/);
});

test("guard cards show the question, the answer and the verdict", () => {
  const start = journeyGuardText({
    contractID: "gc-test",
    stage: "start",
    goal: "visible journey",
    check: "node check.mjs",
    expected: "JOURNEY_UI_OK",
    maxQuestions: 2,
  });
  assert.match(start, /গার্ড চেক শুরু/);
  assert.match(start, /সর্বোচ্চ 2/);

  const question = journeyGuardText({
    contractID: "gc-test",
    stage: "question",
    question: "Which file emits the card?",
    questionNumber: 1,
    maxQuestions: 2,
  });
  assert.match(question, /Which file emits the card\?/);
  assert.match(question, /1\/2/);

  const answer = journeyGuardText({
    contractID: "gc-test",
    stage: "answer",
    question: "Which file emits the card?",
    answer: "src/plugin.ts emits it.",
  });
  assert.match(answer, /Which file emits the card\?/);
  assert.match(answer, /src\/plugin\.ts emits it\./);

  const verdict = journeyGuardText({
    contractID: "gc-test",
    stage: "verdict",
    verdict: "PASS",
    reason: "src/plugin.ts:1514 emits the card; check exit 0.",
  });
  assert.match(verdict, /গার্ড পাস/);
  assert.match(verdict, /Intent judge verdict: PASS/);
  assert.match(verdict, /src\/plugin\.ts:1514/);
});

test("close cards explain what was done, what was received and why", () => {
  const preview = journeyCloseText({
    phase: "preview",
    contractID: "gc-test",
    goal: "visible journey",
    deliverable: "plain-text cards",
    check: "node check.mjs",
    expected: "JOURNEY_UI_OK",
    mode: "contains",
  });
  assert.match(preview, /শেষ ধাপ/);
  assert.match(preview, /আমি যা করেছি/);
  assert.match(preview, /আমি যা দেব/);
  assert.match(preview, /PASS হলে/);
  assert.match(preview, /FAIL হলে/);

  const pass = journeyCloseText({
    phase: "result",
    contractID: "gc-test",
    goal: "visible journey",
    deliverable: "plain-text cards",
    check: "node check.mjs",
    expected: "JOURNEY_UI_OK",
    mode: "contains",
    status: "PASS",
    exitCode: 0,
    observed: "JOURNEY_UI_OK",
  });
  assert.match(pass, /গোল বন্ধ: PASS/);
  assert.match(pass, /আমি যা করেছি/);
  assert.match(pass, /আমি যা পেয়েছি: exit 0, JOURNEY_UI_OK/);
  assert.match(pass, /কেন বন্ধ করছি/);

  const fail = journeyCloseText({
    phase: "result",
    contractID: "gc-test",
    goal: "visible journey",
    deliverable: "plain-text cards",
    check: "node check.mjs",
    expected: "JOURNEY_UI_OK",
    mode: "contains",
    status: "FAIL",
    exitCode: 1,
    observed: "boom",
    reason: "check exited with 1",
  });
  assert.match(fail, /গোল বন্ধ: FAIL/);
  assert.match(fail, /কেন বন্ধ হয়নি: check exited with 1/);
});

test("every journey card uses the native full-message surface and has no emoji", () => {
  const texts = [
    journeyIntakeText({ pack, run, request: "visible journey", sanitized: 0 }),
    journeyContractText({
      goal: "visible journey",
      input: "request",
      deliverable: "cards",
      check: "node check.mjs",
      expected: "JOURNEY_UI_OK",
      pass: "exit 0",
      mode: "contains",
      scope: "src",
    }),
    journeyScopeText({
      contractID: "gc-test",
      projectRoot: "/tmp/demo",
      scope: "src",
      verified: [{ path: "src", inside: true }],
    }),
    journeyGuardText({ contractID: "gc-test", stage: "start" }),
    journeyGuardText({ contractID: "gc-test", stage: "question", question: "Which file?" }),
    journeyGuardText({ contractID: "gc-test", stage: "answer", question: "Which file?", answer: "src/plugin.ts" }),
    journeyGuardText({ contractID: "gc-test", stage: "verdict", verdict: "PASS", reason: "src/plugin.ts:1514" }),
    journeyCloseText({
      phase: "preview",
      contractID: "gc-test",
      goal: "visible journey",
      deliverable: "cards",
      check: "node check.mjs",
      expected: "JOURNEY_UI_OK",
      mode: "contains",
    }),
    journeyCloseText({
      phase: "result",
      contractID: "gc-test",
      goal: "visible journey",
      deliverable: "cards",
      check: "node check.mjs",
      expected: "JOURNEY_UI_OK",
      mode: "contains",
      status: "PASS",
      exitCode: 0,
      observed: "JOURNEY_UI_OK",
    }),
  ];
  for (const [index, text] of texts.entries()) {
    const card = uiCard({ sessionID: "ses_test", kind: `journey-${index}`, text });
    assert.equal(card.metadata.source, "goal", `card ${index} must use the goal surface`);
    assert.equal(card.description, text.trim(), `card ${index} must carry the full text in description`);
    assert.equal(hasEmojiOrIcon(card.text), false, `card ${index} must not carry an emoji or icon`);
  }
});
