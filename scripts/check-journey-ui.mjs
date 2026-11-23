#!/usr/bin/env node
// Journey UI check: every stage of the agent's work renders one plain-text
// card with real context data, and the plugin actually emits it.
//
//   node --experimental-strip-types scripts/check-journey-ui.mjs
//
// The intake card is built from the real SSOT and syllabus of this repository,
// not from a hand-written fixture. The remaining cards use the same renderers
// the plugin calls at open, scope, guard, close-preview and close-result time.
//
// Final line: JOURNEY_UI_OK

import * as fs from "node:fs";
import * as path from "node:path";
import { buildContextPack } from "../src/zombie/context.ts";
import {
  journeyCloseText,
  journeyContractText,
  journeyGuardText,
  journeyIntakeText,
  journeyScopeText,
} from "../src/zombie/journey.ts";
import { hasEmojiOrIcon, uiCard } from "../src/zombie/uiCard.ts";

const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "fail"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

function has(text, needle) {
  return String(text).includes(needle);
}

function noEmoji(text) {
  return !hasEmojiOrIcon(text);
}

const root = process.cwd();
const pack = buildContextPack(
  root,
  "zombiecoder",
  [],
  "Make the agent journey visible in the UI",
  "ses_journey",
  root,
);
const run = {
  version: 1,
  sessionID: "ses_journey",
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

const intake = journeyIntakeText({
  pack,
  run,
  request: "Make the agent journey visible in the UI",
  sanitized: 0,
});
check("intake card names the stage", has(intake, "ধাপ ১"));
check(
  "intake card shows the real syllabus size",
  has(intake, `Syllabus: ${pack.syllabus.lines} লাইন, ${pack.syllabus.bytes} বাইট`),
  `${pack.syllabus.lines} lines / ${pack.syllabus.bytes} bytes`,
);
check(
  "intake card shows the real SSOT size",
  has(intake, `SSOT: ${pack.ssot.lines} লাইন, ${pack.ssot.bytes} বাইট`),
  `${pack.ssot.lines} lines / ${pack.ssot.bytes} bytes`,
);
check("intake card shows the input validation count", has(intake, "ইনপুট যাচাই: 0টি message পরিষ্কার"));
check("intake card shows the route", has(intake, "Route: substantive / intake (complex)"));
check("intake card shows the focus files", has(intake, "Focus:"));
check("intake card has no emoji or icon", noEmoji(intake));

const contract = journeyContractText({
  goal: "Make the agent journey visible",
  input: "user request",
  deliverable: "plain-text journey cards",
  check: "node --experimental-strip-types scripts/check-journey-ui.mjs",
  expected: "JOURNEY_UI_OK",
  pass: "exit 0 and JOURNEY_UI_OK",
  mode: "contains",
  scope: "src, scripts",
});
check("contract card states what the agent understood", has(contract, "আমি যা বুঝলাম"));
check("contract card states what the agent will deliver", has(contract, "আমি যা দেব: plain-text journey cards"));
check(
  "contract card shows the check and the marker",
  has(contract, "check-journey-ui.mjs") && has(contract, "JOURNEY_UI_OK"),
);
check(
  "contract card keeps the permission labels",
  has(contract, "Allow once") && has(contract, "Allow always") && has(contract, "Reject"),
);
check("contract card has no emoji or icon", noEmoji(contract));

const scope = journeyScopeText({
  contractID: "gc-check",
  projectRoot: root,
  scope: "src, scripts, ../outside",
  verified: [
    { path: "src", inside: true },
    { path: "scripts", inside: true },
    { path: "../outside", inside: false },
  ],
  openedAt: "2026-11-23T00:00:00.000Z",
});
check("scope card names the stage", has(scope, "পাথ যাচাই"));
check("scope card shows an inside path", has(scope, "src — প্রজেক্ট রুটের ভিতরে"));
check("scope card shows an outside path", has(scope, "../outside — প্রজেক্ট রুটের বাইরে"));
check("scope card names the guard clock", has(scope, "গার্ড:"));
check("scope card has no emoji or icon", noEmoji(scope));

const guardStart = journeyGuardText({
  contractID: "gc-check",
  stage: "start",
  goal: "visible journey",
  check: "node check.mjs",
  expected: "JOURNEY_UI_OK",
  maxQuestions: 2,
});
check("guard start card names the guard", has(guardStart, "গার্ড চেক শুরু"));
check("guard start card shows the check", has(guardStart, "node check.mjs"));
check("guard start card shows the question budget", has(guardStart, "সর্বোচ্চ 2"));

const guardQuestion = journeyGuardText({
  contractID: "gc-check",
  stage: "question",
  question: "Which file proves the card is emitted?",
  questionNumber: 1,
  maxQuestions: 2,
});
check("guard question card shows the question", has(guardQuestion, "Which file proves the card is emitted?"));
check("guard question card numbers the question", has(guardQuestion, "1/2"));

const guardAnswer = journeyGuardText({
  contractID: "gc-check",
  stage: "answer",
  question: "Which file proves the card is emitted?",
  answer: "src/plugin.ts emits the intake card through deps.synthetic.",
});
check(
  "guard answer card shows both sides",
  has(guardAnswer, "Which file proves") && has(guardAnswer, "src/plugin.ts emits"),
);

const guardPass = journeyGuardText({
  contractID: "gc-check",
  stage: "verdict",
  verdict: "PASS",
  reason: "src/plugin.ts emits the card; check exit 0.",
  transcript: "Q: Which file?\nA: src/plugin.ts.",
});
check("guard verdict card says PASS", has(guardPass, "গার্ড পাস"));
check("guard verdict card keeps the verdict line", has(guardPass, "Intent judge verdict: PASS"));
check("guard verdict card shows the reason", has(guardPass, "src/plugin.ts"));
check("guard verdict card has no emoji or icon", noEmoji(guardPass));

const closePreview = journeyCloseText({
  phase: "preview",
  contractID: "gc-check",
  goal: "visible journey",
  deliverable: "cards",
  check: "node check.mjs",
  expected: "JOURNEY_UI_OK",
  mode: "contains",
});
check("close preview names the stage", has(closePreview, "শেষ ধাপ"));
check("close preview says what was done", has(closePreview, "আমি যা করেছি"));
check("close preview says what will be delivered", has(closePreview, "আমি যা দেব"));
check(
  "close preview explains PASS and FAIL",
  has(closePreview, "PASS হলে") && has(closePreview, "FAIL হলে"),
);
check(
  "close preview keeps the permission labels",
  has(closePreview, "Allow once") && has(closePreview, "Reject"),
);

const closePass = journeyCloseText({
  phase: "result",
  contractID: "gc-check",
  goal: "visible journey",
  deliverable: "cards",
  check: "node check.mjs",
  expected: "JOURNEY_UI_OK",
  mode: "contains",
  status: "PASS",
  exitCode: 0,
  observed: "JOURNEY_UI_OK",
});
check("close result says PASS", has(closePass, "গোল বন্ধ: PASS"));
check("close result says what was done", has(closePass, "আমি যা করেছি"));
check("close result says what was received", has(closePass, "আমি যা পেয়েছি: exit 0, JOURNEY_UI_OK"));
check("close result says why it closed", has(closePass, "কেন বন্ধ করছি"));
check("close result has no emoji or icon", noEmoji(closePass));

const closeFail = journeyCloseText({
  phase: "result",
  contractID: "gc-check",
  goal: "visible journey",
  deliverable: "cards",
  check: "node check.mjs",
  expected: "JOURNEY_UI_OK",
  mode: "contains",
  status: "FAIL",
  exitCode: 1,
  observed: "boom",
  reason: "check exited with 1",
});
check("close result says FAIL", has(closeFail, "গোল বন্ধ: FAIL"));
check("close result says why it did not close", has(closeFail, "কেন বন্ধ হয়নি: check exited with 1"));

const cards = {
  intake,
  contract,
  scope,
  guardStart,
  guardQuestion,
  guardAnswer,
  guardPass,
  closePreview,
  closePass,
  closeFail,
};
for (const [name, text] of Object.entries(cards)) {
  const payload = uiCard({ sessionID: "ses_journey", kind: `journey-${name}`, text });
  check(`${name} card uses the native full-message surface`, payload.metadata.source === "goal");
  check(`${name} card puts the full text in description`, payload.description.includes("ধাপ") || payload.description.includes("শেষ ধাপ"));
  check(`${name} card has no emoji or icon after uiCard`, noEmoji(payload.text));
}

const plugin = fs.readFileSync(path.join(root, "src/plugin.ts"), "utf8");
const server = fs.readFileSync(path.join(root, "src/zombie/server.ts"), "utf8");
check(
  "plugin emits the intake card",
  plugin.includes("journeyIntakeText") && plugin.includes('kind: "journey-intake"'),
);
check(
  "server emits the scope card",
  server.includes("journeyScopeText") && server.includes('kind: "journey-scope"'),
);
check("server emits the contract preview", server.includes("journeyContractText"));
check(
  "server emits the guard cards",
  server.includes("journeyGuardText") && server.includes('"journey-guard-start"'),
);
check(
  "server emits the close cards",
  server.includes("journeyCloseText") && server.includes('kind: "goal-contract-result"'),
);

if (failures.length > 0) {
  console.log(`\nJOURNEY_UI_FAILED ${failures.length}: ${failures.join(" | ")}`);
  process.exit(1);
}
console.log("\nJOURNEY_UI_OK");
