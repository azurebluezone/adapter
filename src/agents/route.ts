// Parameterized route: every answer belongs to one agent, one task kind and one
// phase. Phase changes go through a fixed edge table, and a substantive answer
// cannot enter `respond` without a PASS contract. The route key is the visible
// parameter set (agent / kind / phase), not a prompt suggestion.

import { createHash } from "node:crypto";
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
    intake: ["footprint"],
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
    investigate: ["contract"],
    propose: ["contract"],
    contract: ["work"],
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

const TRIVIAL = /^(?:hi|hello|hey|thanks?|thank you|ok(?:ay)?|হাই|হ্যালো|ধন্যবাদ|ওকে|ঠিক আছে|হুম|হাঁ|হ্যাঁ)[\s!।.,?]*$/i;

const WRITE_INTENT =
  /\b(?:build|create|make|add|implement|fix|refactor|rewrite|write|delete|remove|update|change|install|deploy|migrate|generate|patch|edit|convert|rename|scaffold)\b|(?:বানাও|বানাতে|তৈরি|লিখে|লিখো|ঠিক\s*কর|ফিলাপ|যোগ\s*কর|বদল|মুছে|ইনস্টল|চালু\s*কর|করে\s*দে|সংযোজন|পরিবর্তন|টেস্ট\s*কর)/i;

const READ_INTENT =
  /\b(?:check|inspect|audit|analy[sz]e|review|explain|find|search|read|show|trace|diagnose|verify|test|run|compare)\b|(?:চেক|দেখ|বিশ্লেষণ|পর্যালোচনা|খুঁজ|বুঝিয়ে|বলো|কী|কেন|কোথায়|কেমন|যাচাই|পরীক্ষা)/i;

const CONSENT =
  /^(?:yes|yep|ok(?:ay)?|go(?: ahead)?|proceed|approved?|do it|start|continue|হ্যাঁ|হা|ওকে|ঠিক আছে|করো|করে\s*ফেলো|শুরু\s*করো|এগিয়ে\s*যাও|সম্মতি)[\s!।.,?]*$/i;

export function classifyTask(message: string): TaskKind {
  const text = String(message ?? "").trim();
  if (!text) return "trivial";
  if (TRIVIAL.test(text)) return "trivial";
  if (WRITE_INTENT.test(text)) return "substantive";
  if (READ_INTENT.test(text)) return "readonly";
  // Questions and conversation are read-only: they must never be forced through
  // a contract, but they also never earn write tools.
  return "readonly";
}

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
  const run: AgentRun = {
    version: 1,
    sessionID: input.sessionID,
    agentID: input.agentID,
    taskKind: kind,
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
    run.contract?.status !== "PASS"
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
    if (next.phase === "investigate") next = advance(next, "contract", now);
    if (next.phase === "propose") next = advance(next, "contract", now);
    if (next.phase === "contract") next = advance(next, "work", now);
    return next;
  }

  if (contract.status === "PASS") {
    if (next.phase === "investigate") next = advance(next, "contract", now);
    if (next.phase === "propose") next = advance(next, "contract", now);
    if (next.phase === "contract") next = advance(next, "work", now);
    if (next.phase === "work") next = advance(next, "verify", now);
    if (next.phase === "verify") next = advance(next, "respond", now);
    return next;
  }

  // FAIL / BLOCKED: the agent stays accountable and returns to work; a new
  // contract open is the only way back to a releasable answer.
  if (next.phase === "investigate") next = advance(next, "contract", now);
  if (next.phase === "propose") next = advance(next, "contract", now);
  if (next.phase === "contract") next = advance(next, "work", now);
  if (next.phase === "verify" || next.phase === "respond") next = advance(next, "work", now);
  return freezeRun(next);
}

export function noteOnboarding(run: AgentRun, ok: boolean, now?: Date): AgentRun {
  if (!ok || run.phase !== "footprint") return run;
  return advance(run, "investigate", now);
}

export function noteAnswer(run: AgentRun, hasToolCalls: boolean, now?: Date): AgentRun {
  if (hasToolCalls) return run;
  if (run.taskKind === "trivial" && run.phase === "intake") return advance(run, "respond", now);
  if (run.taskKind === "readonly" && run.phase === "investigate") return advance(run, "propose", now);
  return run;
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
