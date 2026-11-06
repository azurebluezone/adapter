// One controller per agent. The controller owns the prompt, the tool allowlist,
// the footprint policy and the route state; the model only receives the prompt
// and returns text. Nothing in this file can change an answer after the fact —
// it can only refuse to release it.

import {
  SHARED_EXECUTION,
  SHARED_EXPERTISE,
  SHARED_RULES,
} from "./shared.ts";
import {
  advance,
  isConsentFor,
  isProposalTurn,
  legalNext,
  noteAnswer,
  noteContract,
  noteOnboarding,
  releaseCheck,
  routeKey,
  startRun,
  walk,
} from "./route.ts";
import type {
  AgentProfile,
  AgentRun,
  ContractSnapshot,
  ReleaseCheck,
  RoutePhase,
  TaskKind,
  ToolPolicy,
} from "./types.ts";

const TOOL_ALIASES: Readonly<Record<string, string>> = {
  bash: "shell",
  command: "shell",
  write: "edit",
  patch: "edit",
  multiedit: "edit",
  apply_patch: "edit",
};

export function canonicalTool(tool: string): string {
  const value = String(tool ?? "").trim().toLowerCase();
  return TOOL_ALIASES[value] ?? value;
}

export function renderAgentPrompt(profile: AgentProfile): string {
  return [
    "# " + profile.name + " — " + profile.callSign,
    "",
    "**Role:** " + profile.role,
    "",
    "**Mission:** " + profile.mission,
    "",
    "**Core Persona:** \"" + profile.persona + "\"",
    "",
    profile.voice ? "**Voice:** " + profile.voice : "",
    // One tone contract for every agent: the Barishal voice is part of the
    // identity, not a decoration, and it never buys a weaker claim.
    "**Tone:** বন্ধুসুলভ, হালকা দুষ্টমি, বরিশালি টান — উষ্ণ আড্ডার মতো, কিন্তু code, evidence আর safety-তে ছাড় নেই; user বিরক্ত হলে দুষ্টমি বন্ধ।",
    profile.skillFocus?.length ? "**Skill Focus:** " + profile.skillFocus.join(", ") : "",
    profile.skillFocus?.length
      ? "Full 15–20 skill map: `docs/skill-map.md` — websearch to extend it when a new domain appears."
      : "",
    "",
    "**Responsibilities:** " + profile.duties.join(", "),
    "",
    "**Decision Rule:** " + profile.rule,
    "",
    "**Focus:** your persona and this role. Finish your own slice; do not hand the whole task away. Only `zombiecoder` (chair) and `manu` (architect) may launch roster specialists — at most 4 in parallel — and the caller keeps final responsibility.",
    "",
    SHARED_RULES,
    "",
    SHARED_EXECUTION,
    "",
    SHARED_EXPERTISE,
    "",
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

export class AgentController {
  readonly profile: AgentProfile;

  constructor(profile: AgentProfile) {
    this.profile = Object.freeze(profile);
  }

  get id() {
    return this.profile.id;
  }

  /** The persona prompt. It never contains a model reference. */
  prompt(): string {
    return renderAgentPrompt(this.profile);
  }

  /**
   * A model is transport, not identity. The line is deliberately separate from
   * the prompt so swapping a free/small/large model cannot change the route.
   */
  runnerLine(modelRef?: string): string {
    const ref = String(modelRef ?? "").trim() || "unselected";
    return `**Runner:** ${ref} — transport only; identity, tools and route belong to ${this.profile.name}.`;
  }

  route(kind: TaskKind, phase: RoutePhase = "intake"): string {
    return routeKey(this.profile.id, kind, phase);
  }

  next(kind: TaskKind, phase: RoutePhase): readonly RoutePhase[] {
    return legalNext(kind, phase);
  }

  start(input: {
    sessionID: string;
    message: string;
    focus?: string[];
    kind?: TaskKind;
    now?: Date;
  }): AgentRun {
    return startRun({ ...input, agentID: this.profile.id });
  }

  advance(run: AgentRun, phase: RoutePhase, now?: Date): AgentRun {
    return advance(run, phase, now);
  }

  walk(run: AgentRun, phases: readonly RoutePhase[], now?: Date): AgentRun {
    return walk(run, phases, now);
  }

  noteAnswer(run: AgentRun, hasToolCalls: boolean, now?: Date): AgentRun {
    return noteAnswer(run, hasToolCalls, now);
  }

  noteContract(run: AgentRun, contract: ContractSnapshot, now?: Date): AgentRun {
    return noteContract(run, contract, now);
  }

  noteOnboarding(run: AgentRun, ok: boolean, now?: Date): AgentRun {
    return noteOnboarding(run, ok, now);
  }

  release(run: AgentRun | null): ReleaseCheck {
    return releaseCheck(run);
  }

  proposalTurn(run: AgentRun | null): boolean {
    return isProposalTurn(run);
  }

  consentFor(run: AgentRun | null, message: string): boolean {
    return isConsentFor(run, message);
  }

  allows(tool: string, phase: RoutePhase): boolean {
    const policy = this.profile.tools;
    const canonical = canonicalTool(tool);
    if (!canonical) return false;
    if (policy.denied.includes(canonical)) return false;
    if (policy.mutating.includes(canonical) && phase !== "work") return false;
    return policy.phases[phase]?.includes(canonical) ?? false;
  }

  deniedTool(tool: string, phase: RoutePhase): boolean {
    return !this.allows(tool, phase);
  }

  /** The control surface shown to the user and stored in the audit trail. */
  monitor(run?: AgentRun | null) {
    return {
      agent: this.profile.id,
      name: this.profile.name,
      role: this.profile.role,
      modelIndependent: true,
      route: {
        key: run?.routeKey ?? this.route("substantive"),
        kind: run?.taskKind ?? null,
        phase: run?.phase ?? null,
        next: run ? legalNext(run.taskKind, run.phase) : legalNext("substantive", "intake"),
      },
      tools: {
        phases: Object.fromEntries(
          Object.entries(this.profile.tools.phases).map(([phase, tools]) => [
            phase,
            [...tools],
          ]),
        ),
        mutating: [...this.profile.tools.mutating],
        denied: [...this.profile.tools.denied],
      },
      footprint: {
        required: [...this.profile.footprint.required],
        owner: this.profile.footprint.owner,
        freshSyllabus: this.profile.footprint.freshSyllabus,
        maxBytes: this.profile.footprint.maxBytes,
      },
      gates: {
        contractFor: [...this.profile.gates.contractFor],
        evidenceFor: [...this.profile.gates.evidenceFor],
        releasePhase: this.profile.gates.releasePhase,
      },
      contract: run?.contract ?? null,
      steps: run?.steps.length ?? 0,
    };
  }
}

export function defineAgent(profile: AgentProfile): AgentController {
  return new AgentController(profile);
}

export function toolsFor(policy: ToolPolicy): Readonly<Record<RoutePhase, readonly string[]>> {
  return policy.phases;
}
