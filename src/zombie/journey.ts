// The agent journey must be visible, not inferred. Each stage renders one
// plain-text card: what the agent read, what it understood, what it will do,
// what the guard asked, and what the check proved. Bengali prose with English
// technical terms; paths and commands stay English. No emoji or icon: the
// card helper strips them, and the text itself never needs them.

import type { AgentRun } from "../agents/types.ts";
import type { ContextPack } from "./context.ts";
import type { MatchMode } from "./goalContract.ts";

function oneLine(value: string, max = 240): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function fileLine(
  label: string,
  status: { exists: boolean; lines: number; bytes: number },
): string {
  return status.exists
    ? `${label}: ${status.lines} লাইন, ${status.bytes} বাইট`
    : `${label}: পাওয়া যায়নি`;
}

function nextPhase(phase: AgentRun["phase"] | null): string {
  switch (phase) {
    case "intake":
      return "footprint বা investigate";
    case "footprint":
      return "investigate";
    case "investigate":
      return "contract খোলা বা সরাসরি উত্তর";
    case "contract":
      return "work";
    case "work":
      return "verify";
    case "verify":
      return "respond";
    case "respond":
      return "চূড়ান্ত উত্তর";
    default:
      return "route ঠিক হবে";
  }
}

export type JourneyIntakeInput = {
  pack: ContextPack;
  run: AgentRun | null;
  request: string;
  sanitized: number;
};

/** Stage 1: the context the agent actually loaded and validated. */
export function journeyIntakeText(input: JourneyIntakeInput): string {
  const { pack, run, request, sanitized } = input;
  const primary = pack.focus?.primary.map((item) => item.path) ?? [];
  const related = pack.focus?.related.map((item) => item.path) ?? [];
  const route = run
    ? `${run.taskKind} / ${run.phase}${
        run.complexity && run.complexity !== "trivial" ? ` (${run.complexity})` : ""
      }`
    : "এখনো ঠিক হয়নি";
  return [
    "ধাপ ১ — ইনপুট আর কনটেক্সট যাচাই",
    "",
    `তুমি চাইছ: ${oneLine(request, 90) || "(খালি)"}`,
    fileLine("Syllabus", pack.syllabus),
    fileLine("SSOT", pack.ssot),
    primary.length > 0
      ? `Focus: ${primary.length} primary, ${related.length} related${primary[0] ? ` — ${primary[0]}` : ""}`
      : "Focus: এই টার্নে নির্দিষ্ট ফাইল পাওয়া যায়নি",
    `Memory: ${pack.memory.recent} recent, ${pack.memory.archives} archive`,
    `ইনপুট যাচাই: ${sanitized}টি message পরিষ্কার, বাকি অপরিবর্তিত`,
    `Route: ${route}`,
    `খোলা contract: ${pack.openContractIDs.length > 0 ? pack.openContractIDs.join(", ") : "নেই"}`,
    "",
    `এরপর: ${nextPhase(run?.phase ?? null)}।`,
  ].join("\n");
}

export type JourneyContractInput = {
  id?: string;
  goal: string;
  input: string;
  deliverable: string;
  check: string;
  expected: string;
  pass: string;
  mode: MatchMode;
  scope: string;
};

/** Stage 2: what the agent understood and what it will deliver. */
export function journeyContractText(input: JourneyContractInput): string {
  return [
    "ধাপ ২ — আমি যা বুঝলাম",
    "",
    ...(input.id ? [`Contract: ${input.id}`] : []),
    `তুমি চাইছ: ${oneLine(input.goal, 260)}`,
    `আসল ইনপুট: ${oneLine(input.input, 260)}`,
    `আমি যা দেব: ${oneLine(input.deliverable, 260)}`,
    `আমি যেসব path ছুব: ${input.scope}`,
    `আমি কীভাবে যাচাই করব: \`${input.check}\``,
    `PASS-এর প্রমাণ: ${input.expected}`,
    `মিলানোর নিয়ম: ${input.mode}`,
    `PASS মানে: ${oneLine(input.pass, 260)}`,
    "",
    "খোলার আগে একবার baseline চালাব। ওটা pass করে ফেললে contract খুলব না — আগেই pass করা check কোনো কাজের প্রমাণ নয়।",
    "permission dialog: Allow once = শুধু এইবার; Allow always = এই প্রজেক্টে পরেরবার আর জিজ্ঞেস করব না; Reject = কিছুই লেখা হবে না।",
    "ভুল মনে হলে Reject দাও; কোনো ফাইল লেখা হবে না, নতুন করে বলব।",
  ].join("\n");
}

export type JourneyScopeInput = {
  contractID: string;
  projectRoot: string;
  scope: string;
  verified: Array<{ path: string; inside: boolean }>;
  openedAt?: string;
};

/** Stage 3: the scope paths are checked against the project boundary. */
export function journeyScopeText(input: JourneyScopeInput): string {
  const lines = input.verified.map((item) =>
    item.inside
      ? `- ${item.path} — প্রজেক্ট রুটের ভিতরে`
      : `- ${item.path} — প্রজেক্ট রুটের বাইরে, অনুমতি নেই`,
  );
  return [
    "ধাপ ৩ — পাথ যাচাই",
    "",
    `Contract: ${input.contractID}`,
    `প্রজেক্ট রুট: ${input.projectRoot}`,
    `লেখার অনুমতি: ${input.scope}`,
    "যাচাই হয়েছে:",
    ...(lines.length > 0 ? lines : ["- কোনো path দেওয়া হয়নি"]),
    "",
    "গার্ড: আলাদা সময়সীমার অপেক্ষা নেই — close-এ আসল check-ই রায় দেবে; PASS/FAIL ওখানেই রেকর্ড হবে।",
  ].join("\n");
}

export type JourneyGuardStage = "start" | "question" | "answer" | "verdict";

export type JourneyGuardInput = {
  contractID: string;
  stage: JourneyGuardStage;
  goal?: string;
  check?: string;
  expected?: string;
  question?: string;
  answer?: string;
  verdict?: "PASS" | "FAIL";
  reason?: string;
  transcript?: string;
  questionNumber?: number;
  maxQuestions?: number;
};

/** Stage 4/5: the guard starts, asks, receives the answer, and records a verdict. */
export function journeyGuardText(input: JourneyGuardInput): string {
  const contract = `Contract: ${input.contractID}`;
  if (input.stage === "start") {
    return [
      "ধাপ ৪ — গার্ড চেক শুরু",
      "",
      contract,
      ...(input.goal ? [`গার্ড দেখবে: ${oneLine(input.goal, 260)}`] : []),
      ...(input.check ? [`যাচাই: \`${input.check}\``] : []),
      ...(input.expected ? [`প্রমাণ: ${input.expected}`] : []),
      "",
      `গার্ড প্রশ্ন করতে পারে (সর্বোচ্চ ${input.maxQuestions ?? 2}), আমার উত্তর দিতে হবে; তারপর PASS/FAIL।`,
    ].join("\n");
  }
  if (input.stage === "question") {
    return [
      `ধাপ ৪ — গার্ডের প্রশ্ন (${input.questionNumber ?? 1}/${input.maxQuestions ?? 2})`,
      "",
      contract,
      `গার্ড জিজ্ঞেস করছে: ${oneLine(input.question ?? "(খালি)", 500)}`,
      "",
      "আমি `intent_judge` action=answer দিয়ে উত্তর দেব।",
    ].join("\n");
  }
  if (input.stage === "answer") {
    return [
      "ধাপ ৪ — আমার উত্তর",
      "",
      contract,
      `গার্ড: ${oneLine(input.question ?? "(খালি)", 400)}`,
      `আমি: ${oneLine(input.answer ?? "(খালি)", 600)}`,
      "",
      "এরপর গার্ড PASS/FAIL দেবে।",
    ].join("\n");
  }
  const status = input.verdict ?? "FAIL";
  return [
    `ধাপ ৫ — গার্ডের রায়: ${status}`,
    "",
    contract,
    `Intent judge verdict: ${status}`,
    status === "PASS" ? "গার্ড পাস" : "গার্ড FAIL",
    ...(input.reason ? [`কারণ: ${oneLine(input.reason, 500)}`] : []),
    ...(input.transcript ? ["", input.transcript] : []),
  ].join("\n");
}

export type JourneyCloseInput = {
  phase: "preview" | "result";
  contractID: string;
  goal: string;
  deliverable: string;
  check: string;
  expected: string;
  mode: MatchMode;
  status?: "PASS" | "FAIL";
  exitCode?: number | null;
  observed?: string;
  reason?: string;
};

/** Stage 6/7: what will run, then what actually happened and why it closed. */
export function journeyCloseText(input: JourneyCloseInput): string {
  if (input.phase === "preview") {
    return [
      "ধাপ ৬ — শেষ ধাপ: গোল বন্ধ করার আগে",
      "",
      `Contract: ${input.contractID}`,
      `আমি যা করেছি: ${oneLine(input.goal, 260)}`,
      `আমি যা দেব: ${oneLine(input.deliverable, 260)}`,
      `যাচাই চলবে: \`${input.check}\``,
      `PASS-এর প্রমাণ: ${input.expected} (${input.mode})`,
      "",
      "PASS হলে: ফল syllabus-এ লেখা হবে, contract বন্ধ হবে।",
      "FAIL হলে: contract খোলা থাকবে, আমি আসল আচরণ ঠিক করব।",
      "",
      "permission dialog: Allow once (Allow = চেক চালাও); Reject = চেক চলবে না; কিছুই সেভ হয় না, পরের close-এ আবার জিজ্ঞেস করব।",
      "Reject দিলে contract খোলাই থাকবে, ফল লেখা হবে না।",
    ].join("\n");
  }
  const status = input.status ?? "FAIL";
  const observed = oneLine(input.observed ?? "", 400) || "(কোনো output নেই)";
  const why =
    status === "PASS"
      ? input.reason || "check exit 0 এবং expected মিলেছে"
      : input.reason || "check fail করেছে, তাই contract খোলা থাকবে";
  return [
    `ধাপ ৭ — গোল বন্ধ: ${status}`,
    "",
    `Contract: ${input.contractID}`,
    `আমি যা করেছি: ${oneLine(input.goal, 260)}`,
    `আমি যা পেয়েছি: exit ${input.exitCode === null || input.exitCode === undefined ? "none" : input.exitCode}, ${observed}`,
    `PASS-এর প্রমাণ: ${input.expected} (${input.mode})`,
    `কেন ${status === "PASS" ? "বন্ধ করছি" : "বন্ধ হয়নি"}: ${why}`,
    "",
    status === "PASS"
      ? "প্রমাণ syllabus-এ লেখা হয়েছে। এখন আমি তোমাকে ফলাফল বলব।"
      : "এটা PASS নয় — আসল আচরণ ঠিক করব, তারপর একই contract id, check ও expected রেখে আবার close করব।",
  ].join("\n");
}
