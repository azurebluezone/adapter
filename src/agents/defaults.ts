// Default policies. Each agent file still owns its list; these are only the
// baseline every specialist shares, so a new agent cannot silently lose a gate.

import type {
  AgentID,
  FootprintPolicy,
  GatePolicy,
  RoutePhase,
  ToolPolicy,
} from "./types.ts";

// No external MCP server is required or assumed. The plugin's own tools,
// memory, contracts and verification work on a machine with zero MCP servers.
// A mounted server is reachable only when the environment allowlists its
// namespace in `mcpAllow`; an unknown server gets no implicit wildcard grant.
export const DENIED_TOOLS: readonly string[] = [];

// MCP is an environment feature, not a plugin dependency. The install config
// names the server namespaces the owner added; the plugin never hardcodes one.
// An empty list means no MCP tool is reachable, and every plugin tool still works.
export const MCP_PHASES: readonly RoutePhase[] = ["investigate", "work", "verify"];

// The plugin's own tools share the `zombiecoder_` prefix, so that namespace is
// never an MCP grant. A remote server with the same name must use another id.
const RESERVED_MCP_NAMESPACE = "zombiecoder";

export function normalizeMcpServer(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function mcpAllowPatterns(allow: readonly unknown[] | undefined): string[] {
  const names = (allow ?? [])
    .map(normalizeMcpServer)
    .filter((name) => name.length > 0 && name !== RESERVED_MCP_NAMESPACE);
  return [...new Set(names.map((name) => `${name}_*`))];
}

export function mcpToolAllowed(tool: string, allow: readonly unknown[] | undefined): boolean {
  const name = String(tool ?? "").trim().toLowerCase();
  if (!name) return false;
  return mcpAllowPatterns(allow).some((pattern) => name.startsWith(pattern.slice(0, -1)));
}

export const BASE_PHASE_TOOLS: Readonly<Record<RoutePhase, readonly string[]>> = {
  intake: [
    "get_working_directory",
    "read_ssot",
    "read_syllabus",
    "context_status",
    "agent_modes",
    // A request can be misclassified as read-only; the contract is the
    // user-approved escape hatch from intake/footprint to real work.
    "goal_contract",
  ],
  footprint: [
    "read",
    "grep",
    "glob",
    "get_working_directory",
    "read_ssot",
    "read_syllabus",
    "context_status",
    "project_fingerprint",
    "project_onboarding",
    "append_syllabus",
    "memory_archive",
    "skill_catalog",
    // Native skills are reference material, not a write; the first turn must be
    // able to load the stack skill the context pack routed to it.
    "skill",
    "goal_contract",
  ],
  investigate: [
    "read",
    "grep",
    "glob",
    "shell",
    "read_ssot",
    "read_syllabus",
    "context_status",
    "project_fingerprint",
    "evidence_gate",
    "verify_real",
    "project_investigation",
    "syntax_check",
    "goal_contract",
    "http_probe",
    // Investigation is allowed to ask the user one precise question and to
    // read the web. Denying these forced the agent to guess or to tunnel
    // through Code Mode fetch, which is not a rule the user can see.
    "question",
    "webfetch",
    "websearch",
    // Findings belong in the append-only syllabus while they are fresh; the
    // footprint phase is too early and the work phase is too late.
    "append_syllabus",
    "env_get",
    "service_probe",
    "patch_preview",
    "memory_archive",
    "skill_catalog",
    "skill",
    // Read-only symbol/LSP queries gather facts; without them the registered
    // tools are denied in every phase and the agent cannot diagnose code.
    "symbol_overview",
    "find_symbols",
    "find_references",
    "diagnostics_for_file",
    // MCP namespaces are not listed here: the environment-owned `mcpAllow`
    // list is merged at runtime, so the plugin ships no server name.
    "project_onboarding",
    "project_fingerprint",
    // The worker gets the plugin-built judge prompt and can answer a judge
    // question; asking/recording stays gated to the intent-judge agent.
    "intent_judge",
  ],
  propose: [
    "read",
    "grep",
    "glob",
    "read_ssot",
    "read_syllabus",
    "context_status",
    "evidence_gate",
    "skill",
    "skill_catalog",
    // A proposal may need one clarification or one source check before the
    // user approves it; neither changes the project.
    "question",
    "webfetch",
    "websearch",
  ],
  contract: ["goal_contract", "read_ssot", "read_syllabus", "context_status", "question"],
  work: [
    "read",
    "grep",
    "glob",
    "edit",
    "shell",
    "patch_preview",
    "syntax_check",
    "evidence_gate",
    "verify_real",
    // close runs the recorded check and is the only edge out of work; without
    // it the same turn can never reach verify/respond.
    "goal_contract",
    "append_syllabus",
    "context_status",
    // A skill discovered mid-task must be loadable here: investigate can list
    // the catalog, but installation and reload belong to the work phase.
    "skill_catalog",
    "skill",
    // The same non-mutating aids stay available while the contract is being
    // implemented: a doc lookup or one precise question is not a write.
    "question",
    "webfetch",
    "websearch",
    "intent_judge",
  ],
  verify: [
    "goal_contract",
    "evidence_gate",
    "verify_real",
    "syntax_check",
    "shell",
    "read",
    "skill",
    "skill_catalog",
    // Verification may need to ask about an ambiguous expected result or read
    // the official doc it is checking against.
    "question",
    "webfetch",
    // Diagnostics belong to verification: after an edit, the same agent must
    // be able to read the real LSP errors it is claiming to have fixed.
    "symbol_overview",
    "find_symbols",
    "find_references",
    "diagnostics_for_file",
    "intent_judge",
  ],
  respond: [
    "read",
    "grep",
    "glob",
    "read_ssot",
    "read_syllabus",
    "context_status",
    "append_syllabus",
  ],
};

export const MUTATING_TOOLS: readonly string[] = [
  "edit",
  "write",
  "patch",
  "multiedit",
  "apply_patch",
  "shell",
];

export const BASE_FOOTPRINT: FootprintPolicy = {
  required: ["ssot", "syllabus", "memory", "focus"],
  owner: "halim",
  freshSyllabus: "onboarding-required",
  maxBytes: 24000,
};

export const BASE_GATES: GatePolicy = {
  contractFor: ["substantive"],
  evidenceFor: ["readonly", "substantive"],
  releasePhase: "respond",
  prefix: "ভাইয়া",
};

/**
 * Extend the baseline per phase. Order is preserved and duplicates collapse, so
 * a specialist can add `design_sketch` without re-listing the whole policy.
 */
export function phaseTools(
  overrides: Partial<Record<RoutePhase, readonly string[]>> = {},
  denied: readonly string[] = [],
): ToolPolicy {
  const phases = {} as Record<RoutePhase, readonly string[]>;
  for (const phase of Object.keys(BASE_PHASE_TOOLS) as RoutePhase[]) {
    const extra = overrides[phase] ?? [];
    phases[phase] = [...new Set([...BASE_PHASE_TOOLS[phase], ...extra])];
  }
  return {
    phases,
    mutating: MUTATING_TOOLS,
    denied: [...new Set(["task", ...DENIED_TOOLS, ...denied])].filter(Boolean),
  };
}

export function footprint(
  overrides: Partial<FootprintPolicy> = {},
): FootprintPolicy {
  return {
    ...BASE_FOOTPRINT,
    required: [...BASE_FOOTPRINT.required],
    ...overrides,
  };
}

export function gates(overrides: Partial<GatePolicy> = {}): GatePolicy {
  return {
    ...BASE_GATES,
    contractFor: [...BASE_GATES.contractFor],
    evidenceFor: [...BASE_GATES.evidenceFor],
    ...overrides,
  };
}

/** The owner of a fresh syllabus footprint is the documentation agent. */
export const FOOTPRINT_OWNER: AgentID = "halim";
