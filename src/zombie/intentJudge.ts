// Hardcoded intent-judge — the independent check that runs after a goal
// contract has been open for three minutes.
//
// The judge is not a second opinion the worker can skip. The trigger, the gate
// and the prompt are code, not prompt text:
//
//   judgeDue   — 180000 ms after the contract opened;
//   judgeGate  — a due worker answer needs a stored PASS verdict;
//   buildJudgePrompt — the judge sees the original request and the contract,
//                      never the worker's summary;
//   mutationInScope  — a contract's scope bounds every mutating tool call.
//
// A verdict is data (contract id + status + reason + time), so a worker cannot
// turn a FAIL into a PASS by rephrasing its answer.

export const JUDGE_DELAY_MS = 180_000;

/** A judge that interrogates forever is a second worker. Two questions is the cap. */
export const JUDGE_MAX_QUESTIONS = 2;

export type JudgeStatus = "PASS" | "FAIL";

export type JudgeVerdict = {
  /** Contract this verdict judges. A verdict for another contract is stale. */
  contractID: string;
  status: JudgeStatus;
  reason: string;
  at: string;
  /** The agent that produced the verdict. */
  judge?: string;
};

export type JudgeGateInput = {
  /** True when the contract has been open for at least JUDGE_DELAY_MS. */
  due: boolean;
  /** Stored verdict for this contract, or null when the judge has not run. */
  verdict?: JudgeVerdict | null;
  /** True when the current turn is the judge's own verdict turn. */
  judgeTurn?: boolean;
  /** Contract the worker is trying to release. */
  contractID?: string;
};

export type JudgeGateResult = {
  ok: boolean;
  blocked: boolean;
  reason: string;
};

export type JudgeQuestion = {
  at: string;
  question: string;
  answer?: string;
  answeredAt?: string;
};

/**
 * The visible exchange. The worker's claim and the judge's questions/answers
 * are stored together so the verdict card can show both sides, not only the
 * judge's conclusion.
 */
export type JudgeDebate = {
  contractID: string;
  sessionID: string;
  workerClaim: string;
  questions: JudgeQuestion[];
  verdict?: JudgeVerdict;
};

export type JudgeRuntimeState = {
  due: boolean;
  contractID: string;
  verdict: JudgeStatus | null;
  pendingQuestion: string | null;
  questions: number;
};

function toMillis(value: string | number | Date | null | undefined): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * The trigger is measured from the contract's `openedAt`, not from the first
 * answer or the last tool call. 179999 ms is not due; 180001 ms is due.
 */
export function judgeDue(
  openedAt: string | number | Date | null | undefined,
  now: number | Date = Date.now(),
): boolean {
  const opened = toMillis(openedAt);
  const current = toMillis(now);
  if (opened === null || current === null) return false;
  return current - opened >= JUDGE_DELAY_MS;
}

/**
 * The release rule. A judge turn is released without a verdict (that turn is
 * how the verdict is produced). Before the deadline a worker needs no verdict.
 * After the deadline a worker is released only by a PASS for this contract.
 */
export function judgeGate(input: JudgeGateInput): JudgeGateResult {
  if (input.judgeTurn) {
    return { ok: true, blocked: false, reason: "intent-judge turn: the verdict is the release" };
  }
  if (!input.due) {
    return { ok: true, blocked: false, reason: "intent-judge is not due yet" };
  }
  const verdict = input.verdict;
  if (!verdict) {
    return {
      ok: false,
      blocked: true,
      reason:
        "the goal contract has been open for 3 minutes and no intent-judge verdict exists; launch intent-judge before answering",
    };
  }
  if (input.contractID && verdict.contractID && verdict.contractID !== input.contractID) {
    return {
      ok: false,
      blocked: true,
      reason: `the stored verdict belongs to ${verdict.contractID}, not ${input.contractID}; judge this contract`,
    };
  }
  if (verdict.status !== "PASS") {
    return {
      ok: false,
      blocked: true,
      reason: `intent-judge returned ${verdict.status}: ${verdict.reason || "no reason recorded"}`,
    };
  }
  return { ok: true, blocked: false, reason: "intent-judge PASS" };
}

export type JudgeContractView = {
  id: string;
  goal: string;
  deliverable: string;
  result: string;
  scope: string;
  openedAt: string;
  expected: string;
  check: string;
};

export type JudgeEvidence = {
  tool: string;
  target?: string;
  output?: string;
};

export type JudgePromptInput = {
  /** The user's original session input, verbatim. */
  originalRequest: string;
  contract: JudgeContractView;
  /** Facts the worker recorded in the syllabus. */
  syllabusExcerpt?: string;
  /** Skill-lite cards the plugin routed from the original request. */
  skillLite?: string;
  /** Tool results observed by the plugin, not the worker's prose. */
  evidence?: readonly JudgeEvidence[];
};

/**
 * The judge prompt is built from the original request and the contract, never
 * from a worker summary. There is deliberately no `workerSummary` field: a
 * caller cannot pass one in, and an extra runtime property is ignored.
 */
export function buildJudgePrompt(input: JudgePromptInput): string {
  const evidence = input.evidence?.length
    ? input.evidence.map(
        (entry, index) =>
          `${index + 1}. ${entry.tool}${entry.target ? ` ${entry.target}` : ""}\n   ${String(entry.output ?? "").replace(/\r?\n/g, "\n   ").slice(0, 2000)}`,
      )
    : ["(no tool evidence was supplied; read the files and run the check yourself)"];
  return [
    "You are the independent intent judge. The worker's summary is not evidence.",
    "Your job is to decide whether the real result satisfies the user's original request.",
    "",
    "## Original user request (authoritative)",
    input.originalRequest,
    "",
    "## Goal contract",
    `id: ${input.contract.id}`,
    `goal: ${input.contract.goal}`,
    `deliverable: ${input.contract.deliverable}`,
    `result: ${input.contract.result}`,
    `scope: ${input.contract.scope}`,
    `openedAt: ${input.contract.openedAt}`,
    `check: ${input.contract.check}`,
    `expected: ${input.contract.expected}`,
    "",
    "## Syllabus facts",
    input.syllabusExcerpt?.trim() || "(none supplied; read the syllabus before judging)",
    "",
    "## Load the knowledge this request needs",
    "1. Call `skill_catalog` action=route with the original request, then `action=get mode=full` for the best match.",
    "2. Read `read_syllabus`; find the contract block and the lessons that mention the request.",
    "3. Use `websearch` only for a version-sensitive claim; cite the URL.",
    "4. Say in the verdict which skill and which syllabus lesson you actually used.",
    "",
    "## Routed skills (cards from the plugin; load the full body before judging)",
    input.skillLite?.trim() || "(no skill card matched; route the request yourself with skill_catalog)",
    "",
    "## Real tool evidence",
    ...evidence,
    "",
    "## What you must verify yourself",
    "1. Re-read the original request and list every requirement it actually states.",
    "2. Open each path the result claims; a path that does not exist is a FAIL.",
    "3. Run the contract check and read its real output and exit code.",
    "4. Check the syllabus for a fact the worker may have skipped.",
    "5. Treat a missing, stand-in or hand-written artifact as FAIL.",
    "6. If a fact is still missing, ask the worker with `intent_judge` action=ask; do not guess.",
    "7. Ask at most two questions. Answering is the worker's job, not yours.",
    "",
    "## Required output",
    "First line exactly one of:",
    "JUDGE_VERDICT: PASS",
    "JUDGE_VERDICT: FAIL",
    "Then a short reason with path:line, command output or exit code for every claim.",
  ].join("\n");
}

/**
 * Both sides of the exchange in one plain-text block. The verdict card uses
 * this so the user sees the question and the answer, not only the conclusion.
 */
export function debateTranscript(debate: JudgeDebate): string {
  const lines = [
    `Contract: ${debate.contractID}`,
    "",
    "Worker claim:",
    debate.workerClaim || "(no claim recorded)",
  ];
  debate.questions.forEach((entry, index) => {
    lines.push(
      "",
      `Judge question ${index + 1}:`,
      entry.question,
      "",
      `Worker answer ${index + 1}:`,
      entry.answer?.trim() || "(not answered yet)",
    );
  });
  if (debate.verdict) {
    lines.push(
      "",
      `Judge verdict: ${debate.verdict.status}`,
      `Reason: ${debate.verdict.reason}`,
    );
  }
  return lines.join("\n");
}

/** Parse the judge's own final answer. Only the first verdict line counts. */
export function parseJudgeVerdict(text: string): { status: JudgeStatus; reason: string } | null {
  const value = String(text ?? "");
  const match = /^[ \t]*JUDGE_VERDICT:[ \t]*(PASS|FAIL)[ \t]*$/m.exec(value);
  if (!match) return null;
  const status = match[1] as JudgeStatus;
  const rest = value.slice((match.index ?? 0) + match[0].length).trim();
  return { status, reason: rest.slice(0, 1000) };
}

const MUTATING_TOOL_NAMES = new Set([
  "edit",
  "write",
  "patch",
  "multiedit",
  "apply_patch",
  "shell",
  "bash",
  "command",
  "execute",
]);

function canonicalName(tool: string): string {
  return String(tool ?? "")
    .trim()
    .toLowerCase()
    .replace(/^zombiecoder[._:/-]/, "");
}

function normalizePath(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/** Split a contract scope into normalized path prefixes. `.` means no bound. */
export function parseScope(scope: string): string[] {
  return String(scope ?? "")
    .split(/[\s,;]+/)
    .map((entry) => normalizePath(entry))
    .filter((entry) => entry.length > 0 && entry !== ".");
}

/**
 * The per-tool scope monitor. A non-mutating tool is always in scope. A
 * mutating tool must name a target inside one of the contract's path prefixes;
 * an empty scope keeps the old behavior (no extra bound), while a shell write
 * with no resolvable target is out of scope once a bound exists.
 */
export function mutationInScope(scope: string, tool: string, target: string): boolean {
  if (!MUTATING_TOOL_NAMES.has(canonicalName(tool))) return true;
  const entries = parseScope(scope);
  if (entries.length === 0) return true;
  const normalized = normalizePath(target);
  if (!normalized) return false;
  return entries.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
}
