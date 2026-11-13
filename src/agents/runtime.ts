// Session glue between the controllers and the plugin hooks. State lives in the
// plugin's storage, keyed by session; the model never writes it and never sees a
// way to move a phase except through a real tool result.

import {
  advance,
  hashMessage,
  isConsentFor,
  noteAnswer,
  noteContract,
  noteOnboarding,
  releaseCheck,
  routeKey,
  startRun,
  walk,
} from "./route.ts";
import { canonicalTool } from "./base.ts";
import { isAgentID } from "./index.ts";
import type {
  AgentRun,
  ContractSnapshot,
  ReleaseCheck,
  TaskKind,
} from "./types.ts";
import { AGENT_IDS, ROUTE_PHASES, TASK_KINDS } from "./types.ts";

export type RunStore = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};

export const RUN_KEY_PREFIX = "agent/route/";

export function runStorageKey(sessionID: string): string {
  return `${RUN_KEY_PREFIX}${sessionID}`;
}

export function parseAgentRun(value: unknown): AgentRun | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AgentRun>;
  if (raw.version !== 1) return null;
  if (typeof raw.sessionID !== "string" || !raw.sessionID) return null;
  if (typeof raw.agentID !== "string" || !isAgentID(raw.agentID)) return null;
  if (!TASK_KINDS.includes(raw.taskKind as TaskKind)) return null;
  if (!ROUTE_PHASES.includes(raw.phase as AgentRun["phase"])) return null;
  if (typeof raw.routeKey !== "string") return null;
  if (!Array.isArray(raw.steps)) return null;
  return raw as AgentRun;
}

export async function loadRun(store: RunStore, sessionID: string): Promise<AgentRun | null> {
  if (!sessionID || sessionID === "unknown") return null;
  return parseAgentRun(await store.get(runStorageKey(sessionID)));
}

export async function saveRun(store: RunStore, run: AgentRun): Promise<void> {
  if (!run.sessionID || run.sessionID === "unknown") return;
  await store.set(runStorageKey(run.sessionID), run);
}

export type TurnResult = {
  run: AgentRun;
  consent: boolean;
  /** True when this is the same run continued by a short "yes". */
  continued: boolean;
  /** True when the same user turn is transferred to a newly selected agent. */
  handedOff: boolean;
};

const CONTINUE =
  /\b(?:retry|continue|again|try again|what happened|same task|চালিয়ে\s*যাও|আবার|পুনরায়|কী\s*হলো|কি\s*হলো|একই\s*কাজ|চেষ্টা\s*কর)\b/i;

function isContinuation(previous: AgentRun | null, message: string): boolean {
  if (!previous) return false;
  if (isConsentFor(previous, message)) return true;
  if (previous.phase === "respond") return false;
  if (previous.phase === "contract" || previous.phase === "work" || previous.phase === "verify") {
    return CONTINUE.test(message);
  }
  return false;
}

export function beginTurn(input: {
  sessionID: string;
  agentID: string;
  message: string;
  focus?: string[];
  previous?: AgentRun | null;
  freshSyllabus?: boolean;
  turnIndex?: number;
  now?: Date;
}): TurnResult {
  const previous = input.previous ?? null;
  const message = String(input.message ?? "");
  if (!isAgentID(input.agentID)) {
    // Builtin runners are outside the roster; the old gate still applies. A run
    // for an unknown id would make the route key lie.
    throw new Error(`no controller for agent "${input.agentID}"`);
  }

  if (
    previous &&
    previous.sessionID === input.sessionID &&
    previous.agentID !== input.agentID &&
    previous.turnIndex === input.turnIndex &&
    previous.messageHash === hashMessage(message)
  ) {
    const at = (input.now ?? new Date()).toISOString();
    const run: AgentRun = Object.freeze({
      ...previous,
      agentID: input.agentID,
      routeKey: routeKey(input.agentID, previous.taskKind, previous.phase),
      focus: [...previous.focus],
      contract: previous.contract ? { ...previous.contract } : null,
      steps: [
        ...previous.steps,
        {
          at,
          phase: previous.phase,
          kind: "agent_handoff",
          ok: true,
          detail: `${previous.agentID} -> ${input.agentID}`,
        },
      ].slice(-40),
      updatedAt: at,
    });
    Object.freeze(run.focus);
    if (run.contract) Object.freeze(run.contract);
    Object.freeze(run.steps);
    return { run, consent: false, continued: false, handedOff: true };
  }

  if (isContinuation(previous, message)) {
    const consent = Boolean(previous && isConsentFor(previous, message));
    const advanced = consent && previous ? advance(previous, "contract", input.now) : previous!;
    // Re-key the run to the message that continued it so later requests in the
    // same model turn are recognized as the same run, not a fresh task.
    const run = Object.freeze({
      ...advanced,
      messageHash: hashMessage(message),
      turnIndex: input.turnIndex ?? advanced.turnIndex,
      updatedAt: (input.now ?? new Date()).toISOString(),
    });
    return { run, consent, continued: true, handedOff: false };
  }

  let run = startRun({
    sessionID: input.sessionID,
    agentID: input.agentID,
    message,
    focus: input.focus,
    freshSyllabus: input.freshSyllabus,
    turnIndex: input.turnIndex,
    now: input.now,
  });

  if (run.taskKind === "readonly") {
    run = walk(run, ["footprint"], input.now);
    if (!run.freshSyllabus) run = walk(run, ["investigate"], input.now);
  } else if (run.taskKind === "substantive") {
    run = walk(run, ["footprint"], input.now);
    // A brand-new syllabus must get Halim's full footprint before investigation.
    if (!run.freshSyllabus) run = walk(run, ["investigate"], input.now);
  }

  return { run, consent: false, continued: false, handedOff: false };
}

function rawResult(event: any): any {
  const candidates = [event?.result?.output, event?.result, event?.output];
  for (const item of candidates) {
    let value: any = item;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (value && typeof value === "object") return value;
  }
  return null;
}

export function contractFromEvent(event: any): ContractSnapshot | null {
  const value = rawResult(event);
  if (!value) return null;
  const status = String(value.status ?? "").toLowerCase();
  if (
    status !== "open" &&
    status !== "pass" &&
    status !== "fail" &&
    status !== "blocked" &&
    status !== "rejected" &&
    status !== "unavailable"
  ) {
    return null;
  }
  const contract: ContractSnapshot = {
    id: String(value.id ?? "").trim() || "unknown",
    status:
      status === "pass"
        ? "PASS"
        : status === "fail"
          ? "FAIL"
          : status === "blocked"
            ? "BLOCKED"
            : status === "rejected" || status === "unavailable"
              ? "REJECTED"
              : "open",
    at: new Date().toISOString(),
  };
  if (typeof value.check === "string") contract.check = value.check;
  if (typeof value.expected === "string") contract.expected = value.expected;
  if (typeof value.observed === "string") contract.observed = value.observed;
  if (typeof value.exitCode === "number") contract.exitCode = value.exitCode;
  return contract;
}

export function applyToolEvent(
  run: AgentRun | null,
  input: { tool: string; event: any; now?: Date },
): AgentRun | null {
  if (!run) return null;
  // Code Mode calls arrive namespaced (`zombiecoder_goal_contract`); compare
  // the canonical tool id so open/PASS actually move the route.
  const tool = canonicalTool(input.tool);
  const failed = input.event?.status === "error";
  if (failed) return run;
  const at = (input.now ?? new Date()).toISOString();
  const record = (kind: string, detail?: string): AgentRun =>
    Object.freeze({
      ...run,
      steps: [
        ...run.steps,
        { at, phase: run.phase, kind, tool, ok: true, ...(detail ? { detail } : {}) },
      ].slice(-40),
      updatedAt: at,
    });

  if (tool === "project_onboarding") return noteOnboarding(run, true, input.now);
  if (tool === "goal_contract") {
    const contract = contractFromEvent(input.event);
    return contract ? noteContract(run, contract, input.now) : record("goal_contract.unparsed");
  }
  if (["edit", "write", "patch", "multiedit", "apply_patch", "shell", "bash", "command"].includes(tool)) {
    return record("tool");
  }
  return run;
}

export function routeForResponse(
  run: AgentRun | null,
  parsed: { toolCalls: boolean },
): { run: AgentRun | null; check: ReleaseCheck } {
  const next = run && !parsed.toolCalls ? noteAnswer(run, false) : run;
  return { run: next, check: releaseCheck(next) };
}

export const ALL_AGENT_IDS = AGENT_IDS;
