// Parameterized route: every answer belongs to one agent, one task kind and one
// phase. Phase changes go through a fixed edge table, and a substantive answer
// cannot enter `respond` without a PASS contract. The route key is the visible
// parameter set (agent / kind / phase), not a prompt suggestion.

import { createHash } from "node:crypto";
import { classifyIntentKind, stripQuotedText } from "../zombie/intentRules.ts";
import { classifyComplexity, isTrivialMessage } from "../zombie/taskClass.ts";
import type {
  AgentID,
  AgentRun,
  ContractSnapshot,
  ReleaseCheck,
  RoutePhase,
  RunStep,
  TaskKind,
} from "./types.ts";

export class RouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteError";
  }
}

const EDGES: Readonly<Record<TaskKind, Readonly<Record<RoutePhase, readonly RoutePhase[]>>>> = {
  trivial: {
    intake: ["respond"],
    footprint: [],
    investigate: [],
    propose: [],
    contract: [],
    work: [],
    verify: [],
    respond: [],
  },
  readonly: {
    intake: ["footprint", "respond"],
    footprint: ["investigate"],
    investigate: ["propose"],
    propose: ["respond"],
    contract: [],
    work: [],
    verify: [],
    respond: [],
  },
  substantive: {
    intake: ["footprint"],
    footprint: ["investigate"],
    investigate: ["contract", "respond"],
    propose: ["contract", "respond"],
    contract: ["work", "respond"],
    work: ["verify", "contract"],
    verify: ["respond", "work"],
    respond: [],
  },
};

export function legalNext(kind: TaskKind, phase: RoutePhase): readonly RoutePhase[] {
  return EDGES[kind][phase] ?? [];
}

export function routeKey(agentID: AgentID, kind: TaskKind, phase: RoutePhase): string {
  return `zc/${agentID}/${kind}/${phase}`;
}

export function hashMessage(message: string): string {
  return createHash("sha256").update(String(message ?? ""), "utf8").digest("hex").slice(0, 16);
}

const CONSENT =
  /^(?:yes|yep|ok(?:ay)?|go(?: ahead)?|proceed|approved?|do it|start|continue|হ্যাঁ|হা|ওকে|ঠিক আছে|করো|করে\s*ফেলো|শুরু\s*করো|এগিয়ে\s*যাও|সম্মতি)[\s!।.,?]*$/i;

export function hasWriteIntent(message: string): boolean {
  return classifyIntentKind(String(message ?? "")) === "change";
}

export function classifyTask(message: string): TaskKind {
  const text = String(message ?? "").trim();
  if (isTrivialMessage(text)) return "trivial";
  // `stripQuotedText` runs inside `classifyIntentKind`; the route only maps the
  // shared verdict. `verify` stays read-only: a check never earns write tools.
  if (classifyIntentKind(text) === "change") return "substantive";
  // Questions and conversation are read-only: they must never be forced through
  // a contract, but they also never earn write tools.
  return "readonly";
}

export { stripQuotedText };

export function isConsent(message: string): boolean {
  const text = String(message ?? "").trim();
  return text.length > 0 && text.length <= 64 && CONSENT.test(text);
}

export function startRun(input: {
  sessionID: string;
  agentID: AgentID;
  message: string;
  focus?: string[];
  kind?: TaskKind;
  freshSyllabus?: boolean;
  turnIndex?: number;
  now?: Date;
}): AgentRun {
  const at = (input.now ?? new Date()).toISOString();
  const kind = input.kind ?? classifyTask(input.message);
  const complexity = classifyComplexity({
    message: input.message,
    writeIntent: hasWriteIntent(input.message),
    fileCount: input.focus?.length ?? 0,
  });
  // The first user turn is the "show me this project" turn. Do not let a short
  // question take the read-only fast path before the footprint/investigation
  // walk; the reported failure was a greeting-sized input that produced zero
  // tool calls and two generic answers.
  const firstTurn = input.turnIndex === 1;
  const run: AgentRun = {
    version: 1,
    sessionID: input.sessionID,
    agentID: input.agentID,
    taskKind: kind,
    complexity: complexity.level,
    fastPath: complexity.fastPath && !firstTurn,
    phase: "intake",
    routeKey: routeKey(input.agentID, kind, "intake"),
    messageHash: hashMessage(input.message),
    turnIndex: Math.max(0, Number(input.turnIndex) || 0),
    focus: [...(input.focus ?? [])],
    contract: null,
    proposalAt: null,
    freshSyllabus: Boolean(input.freshSyllabus),
    steps: [],
    startedAt: at,
    updatedAt: at,
  };
  return freezeRun(run);
}

function freezeRun(run: AgentRun): AgentRun {
  Object.freeze(run.focus);
  Object.freeze(run.steps);
  if (run.contract) Object.freeze(run.contract);
  return Object.freeze(run);
}

function step(run: AgentRun, phase: RoutePhase, kind: string, at: string, detail?: string): RunStep {
  return { at, phase, kind, ok: true, ...(detail ? { detail } : {}) };
}

export function advance(run: AgentRun, next: RoutePhase, now?: Date): AgentRun {
  const at = (now ?? new Date()).toISOString();
  const allowed = legalNext(run.taskKind, run.phase);
  if (!allowed.includes(next)) {
    throw new RouteError(
      `illegal route step for ${run.agentID}: ${run.taskKind}/${run.phase} -> ${next} ` +
        `(allowed: ${allowed.length ? allowed.join(", ") : "none"})`,
    );
  }
  if (
    next === "respond" &&
    run.taskKind === "substantive" &&
    run.contract?.status !== "PASS" &&
    run.contract?.status !== "REJECTED"
  ) {
    throw new RouteError(
      `contract gate: ${run.agentID} cannot enter respond without goal_contract PASS ` +
        `(contract=${run.contract?.id ?? "none"}, status=${run.contract?.status ?? "none"})`,
    );
  }
  const steps = [...run.steps, step(run, next, "phase", at)].slice(-40);
  const nextRun: AgentRun = {
    ...run,
    phase: next,
    routeKey: routeKey(run.agentID, run.taskKind, next),
    steps,
    updatedAt: at,
  };
  return freezeRun(nextRun);
}

/** Walk a chain of legal edges; every hop is validated independently. */
export function walk(run: AgentRun, phases: readonly RoutePhase[], now?: Date): AgentRun {
  return phases.reduce((current, phase) => advance(current, phase, now), run);
}

// A read-only run has no work edge: its route is intake → footprint →
// investigate → propose → respond. That is correct for a question, but a goal
// contract is an explicit statement that the user wants a deliverable. Opening
// one promotes the run to substantive and walks it to work, so the approved
// contract can actually be executed instead of leaving the agent at a dead end
// that only says "allowed next phase: propose".
const SUBSTANTIVE_FROM: Partial<Record<RoutePhase, readonly RoutePhase[]>> = {
  intake: ["footprint", "investigate", "contract", "work"],
  footprint: ["investigate", "contract", "work"],
  investigate: ["contract", "work"],
  propose: ["contract", "work"],
  contract: ["work"],
};

function promoteReadonly(run: AgentRun, now?: Date): AgentRun {
  if (run.taskKind !== "readonly") return run;
  const path = SUBSTANTIVE_FROM[run.phase] ?? [];
  let next: AgentRun = {
    ...run,
    taskKind: "substantive",
    routeKey: routeKey(run.agentID, "substantive", run.phase),
  };
  for (const phase of path) next = advance(next, phase, now);
  return next;
}

export function noteContract(run: AgentRun, contract: ContractSnapshot, now?: Date): AgentRun {
  const at = (now ?? new Date()).toISOString();
  let next: AgentRun = {
    ...run,
    contract: { ...contract, at },
    steps: [
      ...run.steps,
      {
        at,
        phase: run.phase,
        kind: "goal_contract",
        ok: contract.status === "PASS",
        detail: `${contract.id}:${contract.status}`,
      },
    ].slice(-40),
    updatedAt: at,
  };

  if (contract.status === "open") {
    // The user approved real work; a read-only classification no longer holds.
    next = promoteReadonly(next, now);
    if (next.phase === "investigate") next = advance(next, "contract", now);
    if (next.phase === "propose") next = advance(next, "contract", now);
    if (next.phase === "contract") next = advance(next, "work", now);
    return next;
  }

  if (contract.status === "PASS") {
    next = promoteReadonly(next, now);
    if (next.phase === "investigate") next = advance(next, "contract", now);
    if (next.phase === "propose") next = advance(next, "contract", now);
    if (next.phase === "contract") next = advance(next, "work", now);
    if (next.phase === "work") next = advance(next, "verify", now);
    if (next.phase === "verify") next = advance(next, "respond", now);
    return next;
  }

  if (contract.status === "REJECTED") {
    if (next.phase === "investigate" || next.phase === "propose" || next.phase === "contract") {
      next = advance(next, "respond", now);
    }
    return next;
  }

  // FAIL / BLOCKED: the agent stays accountable and returns to work; a new
  // contract open is the only way back to a releasable answer.
  next = promoteReadonly(next, now);
  if (next.phase === "investigate") next = advance(next, "contract", now);
  if (next.phase === "propose") next = advance(next, "contract", now);
  if (next.phase === "contract") next = advance(next, "work", now);
  if (next.phase === "verify" || next.phase === "respond") next = advance(next, "work", now);
  return freezeRun(next);
}

export function noteOnboarding(run: AgentRun, ok: boolean, now?: Date): AgentRun {
  if (!ok || run.phase !== "footprint") return run;
  let next = advance(run, "investigate", now);
  // An attached open contract still needs write tools; onboarding is the last
  // gate, not a detour back to read-only.
  if (next.contract?.status === "open") next = walk(next, ["contract", "work"], now);
  const at = (now ?? new Date()).toISOString();
  return freezeRun({
    ...next,
    steps: [
      ...next.steps,
      { at, phase: next.phase, kind: "evidence", tool: "project_onboarding", ok: true },
    ].slice(-40),
    updatedAt: at,
  });
}

export function noteAnswer(run: AgentRun, hasToolCalls: boolean, now?: Date): AgentRun {
  if (hasToolCalls) return run;
  if (run.taskKind === "trivial" && run.phase === "intake") return advance(run, "respond", now);
  // Fast path: a small read-only turn may answer without the footprint walk.
  if (run.taskKind === "readonly" && run.fastPath && run.phase === "intake") {
    return advance(run, "respond", now);
  }
  if (run.taskKind === "readonly" && run.phase === "investigate") return advance(run, "propose", now);
  return run;
}

const EVIDENCE_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "project_fingerprint",
  "project_investigation",
  "project_onboarding",
  "skill",
  "skill_catalog",
  "websearch",
  "webfetch",
]);

function hasProjectEvidence(run: AgentRun): boolean {
  return run.steps.some(
    (entry) => entry.kind === "evidence" || (entry.tool ? EVIDENCE_TOOLS.has(entry.tool) : false),
  );
}

export function releaseCheck(run: AgentRun | null): ReleaseCheck {
  if (!run) {
    return {
      ok: true,
      managed: false,
      phase: null,
      routeKey: null,
      reason: "no managed route state for this session",
    };
  }
  const base = { managed: true, phase: run.phase, routeKey: run.routeKey };
  if (run.taskKind === "trivial") {
    return { ...base, ok: true, reason: "trivial turn: no work contract needed" };
  }
  if (run.taskKind === "readonly") {
    // A small/medium read-only turn skips the footprint/investigate walk; it
    // still cannot write, and a substantive request never takes this path.
    if (run.fastPath && run.phase === "intake") {
      return { ...base, ok: true, reason: "fast path: small read-only turn, no contract needed" };
    }
    if (run.turnIndex === 1 && !hasProjectEvidence(run)) {
      return {
        ...base,
        ok: false,
        reason: "first turn has no project evidence; call project_investigation (fingerprint/read alone are inputs, not the release) before answering",
      };
    }
    if (run.phase === "propose" || run.phase === "respond") {
      return { ...base, ok: true, reason: "read-only turn: investigation only, no write claimed" };
    }
    return {
      ...base,
      ok: false,
      reason: `read-only turn still at ${run.phase}; finish footprint/investigation before answering`,
    };
  }
  if (run.phase === "propose" && !run.contract) {
    return {
      ...base,
      ok: true,
      reason: "proposal turn: asking the user for consent before any work",
    };
  }
  if (run.phase === "respond" && run.contract?.status === "REJECTED") {
    return {
      ...base,
      ok: true,
      reason: `contract ${run.contract.id} was rejected; handoff only, no work or success may be claimed`,
    };
  }
  if (
    (run.phase === "verify" || run.phase === "respond") &&
    run.contract?.status === "PASS"
  ) {
    return {
      ...base,
      ok: true,
      reason: `contract ${run.contract.id} PASS: real output matched the pre-registered expectation`,
    };
  }
  return {
    ...base,
    ok: false,
    reason: run.contract
      ? `contract ${run.contract.id} is ${run.contract.status}; a substantive answer cannot be released`
      : `substantive ${run.phase} without a goal contract; open one and get user consent`,
  };
}

/** True when the answer is the proposal the user must approve. */
export function isProposalTurn(run: AgentRun | null): boolean {
  return run?.taskKind === "substantive" && run.phase === "propose" && !run.contract;
}

/** A short "yes" continues the pending proposal instead of starting over. */
export function isConsentFor(run: AgentRun | null, message: string): boolean {
  return Boolean(run && run.taskKind === "substantive" && run.phase === "propose" && isConsent(message));
}
