// One controller per agent. The controller owns the prompt, the tool allowlist,
// the footprint policy and the route state; the model only receives the prompt
// and returns text. Nothing in this file can change an answer after the fact —
// it can only refuse to release it.

import { createHash } from "node:crypto";
import {
  SHARED_EXECUTION,
  SHARED_EXPERTISE,
  SHARED_RULES,
} from "./shared.ts";
import { BASE_PHASE_TOOLS } from "./defaults.ts";
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
  execute: "shell",
  write: "edit",
  patch: "edit",
  multiedit: "edit",
  apply_patch: "edit",
};

export function canonicalTool(tool: string): string {
  const value = String(tool ?? "")
    .trim()
    .toLowerCase()
    .replace(/^zombiecoder[._:/-]/, "");
  return TOOL_ALIASES[value] ?? value;
}

/**
 * Phase lists may contain one trailing wildcard, e.g. `image-brand_*`.
 * OpenCode mounts each MCP server under `<server>_<tool>`, so a namespace
 * pattern keeps a server usable without hard-coding every tool it exposes.
 */
export function toolMatches(entry: string, tool: string): boolean {
  const pattern = String(entry ?? "").trim().toLowerCase();
  if (!pattern) return false;
  if (pattern.endsWith("*")) return tool.startsWith(pattern.slice(0, -1));
  return pattern === tool;
}

export function agentProfileMarker(profile: AgentProfile): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([profile, SHARED_RULES, SHARED_EXECUTION, SHARED_EXPERTISE]))
    .digest("hex")
    .slice(0, 16);
  return `<!-- zombiecoder-agent-profile:${profile.id}:${digest} -->`;
}

export function renderAgentPrompt(profile: AgentProfile): string {
  const toolPhases = new Map<string, string[]>();
  for (const [phase, tools] of Object.entries(profile.tools.phases)) {
    for (const tool of tools) {
      if (BASE_PHASE_TOOLS[phase as RoutePhase].includes(tool)) continue;
      toolPhases.set(tool, [...(toolPhases.get(tool) ?? []), phase]);
    }
  }
  const toolPolicy = [...toolPhases]
    .map(([tool, phases]) => `- ${tool}: ${phases.join("/")}`)
    .sort();
  return [
    "# " + profile.name + " — " + profile.callSign,
    "",
    agentProfileMarker(profile),
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
    "### Tool access (enforced by plugin)",
    "Common tool schemas are supplied by OpenCode; the plugin enforces the active phase allowlist.",
    ...(toolPolicy.length > 0 ? ["Role-specific tools (allowed phases):", ...toolPolicy] : []),
    "",
    "**Focus:** keep the selected agent as task owner/reporter. Use only reviewers allowed by the permission matrix and only for a bounded, relevant slice; the selected agent integrates findings and remains responsible.",
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
    if (policy.denied.some((entry) => toolMatches(entry, canonical))) return false;
    return (policy.phases[phase] ?? []).some((entry) => toolMatches(entry, canonical));
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
