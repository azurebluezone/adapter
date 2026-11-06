// Types for the per-agent controller layer.
//
// The model is deliberately absent from AgentProfile. A model is a transport
// choice supplied by the runtime; identity, tools, prompt and footprint belong
// to the agent. `runnerLine()` labels the transport without letting it alter
// the route or the persona.

import type { AgentMode } from "../zombie/modes.ts";

export const AGENT_IDS = [
  "manu",
  "jarin",
  "brishti",
  "rashed",
  "halim",
  "majnu",
  "nila",
  "tuhin",
  "zombiecoder",
] as const;

export type AgentID = (typeof AGENT_IDS)[number];

export const TASK_KINDS = ["trivial", "readonly", "substantive"] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export const ROUTE_PHASES = [
  "intake",
  "footprint",
  "investigate",
  "propose",
  "contract",
  "work",
  "verify",
  "respond",
] as const;

export type RoutePhase = (typeof ROUTE_PHASES)[number];

export type FootprintSection = "ssot" | "syllabus" | "memory" | "focus" | "onboarding";

export type FootprintPolicy = {
  /** Sections the controller injects or verifies before investigation. */
  required: readonly FootprintSection[];
  /** Who writes the full footprint when the syllabus is brand new. */
  owner: AgentID | null;
  freshSyllabus: "onboarding-required" | "generated-by-owner";
  maxBytes: number;
};

export type ToolPolicy = {
  /** Allowed logical tool names per phase. A phase list is the whole allowlist. */
  phases: Readonly<Record<RoutePhase, readonly string[]>>;
  /** Tools that change project state; never allowed before a contract PASS. */
  mutating: readonly string[];
  /** Capabilities denied to this agent in every phase. */
  denied: readonly string[];
};

export type GatePolicy = {
  contractFor: readonly TaskKind[];
  evidenceFor: readonly TaskKind[];
  releasePhase: RoutePhase;
  prefix: string;
};

export type AgentProfile = {
  id: AgentID;
  name: string;
  callSign: string;
  role: string;
  description: string;
  mode: AgentMode;
  mission: string;
  persona: string;
  duties: string[];
  rule: string;
  voice?: string;
  skillFocus?: string[];
  tools: ToolPolicy;
  footprint: FootprintPolicy;
  gates: GatePolicy;
};

export type ContractStatus = "open" | "PASS" | "FAIL" | "BLOCKED";

export type ContractSnapshot = {
  id: string;
  status: ContractStatus;
  check?: string;
  expected?: string;
  observed?: string;
  exitCode?: number;
  at: string;
};

export type RunStep = {
  at: string;
  phase: RoutePhase;
  kind: string;
  tool?: string;
  ok: boolean;
  detail?: string;
};

export type AgentRun = {
  version: 1;
  sessionID: string;
  agentID: AgentID;
  taskKind: TaskKind;
  phase: RoutePhase;
  routeKey: string;
  messageHash: string;
  /** 1-based count of user messages seen when this run started. */
  turnIndex: number;
  focus: string[];
  contract: ContractSnapshot | null;
  proposalAt: string | null;
  freshSyllabus: boolean;
  steps: RunStep[];
  startedAt: string;
  updatedAt: string;
};

export type ReleaseCheck = {
  /** True when the answer may reach the user. */
  ok: boolean;
  /** True when the router, not the old evidence gate, made the decision. */
  managed: boolean;
  phase: RoutePhase | null;
  routeKey: string | null;
  reason: string;
};
