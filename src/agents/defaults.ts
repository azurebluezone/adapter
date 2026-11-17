// Default policies. Each agent file still owns its list; these are only the
// baseline every specialist shares, so a new agent cannot silently lose a gate.

import type {
  AgentID,
  FootprintPolicy,
  GatePolicy,
  RoutePhase,
  ToolPolicy,
} from "./types.ts";

// The mounted missionbarisal aggregator exposes writes, shells, DB access and
// credential reads next to useful research verbs. Grant the read-only slice by
// exact name and deny the dangerous verbs explicitly, so the boundary is visible
// instead of depending on a wildcard that could widen later.
export const MISSIONBARISAL_READONLY: readonly string[] = [
  "missionbarisal_read_file",
  "missionbarisal_read_ssot",
  "missionbarisal_glob",
  "missionbarisal_grep",
  "missionbarisal_list_directory",
  "missionbarisal_memory_search",
  "missionbarisal_memory_recent",
  "missionbarisal_get_memory",
  "missionbarisal_get_working_dir",
  "missionbarisal_system_info",
];

export const DENIED_TOOLS: readonly string[] = [
  "missionbarisal_exec",
  "missionbarisal_terminal",
  "missionbarisal_write_file",
  "missionbarisal_delete_file",
  "missionbarisal_rename_file",
  "missionbarisal_set_working_dir",
  "missionbarisal_remote_mcp_call",
  "missionbarisal_call_agent",
  "missionbarisal_agent_mission",
  "missionbarisal_agent_single",
  "missionbarisal_db_query",
  "missionbarisal_env_get",
];

export const BASE_PHASE_TOOLS: Readonly<Record<RoutePhase, readonly string[]>> = {
  intake: [
    "get_working_directory",
    "read_ssot",
    "read_syllabus",
    "context_status",
    "agent_modes",
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
    "env_get",
    "service_probe",
    "patch_preview",
    "memory_archive",
    "skill_catalog",
    // Read-only symbol/LSP queries gather facts; without them the registered
    // tools are denied in every phase and the agent cannot diagnose code.
    "symbol_overview",
    "find_symbols",
    "find_references",
    "diagnostics_for_file",
    // MCP servers mounted by OpenCode are exposed as `<server>_<tool>`.
    // Read-only research tools may be used wherever facts are gathered.
    "image-brand_*",
    "public-api_*",
    ...MISSIONBARISAL_READONLY,
    "project_onboarding",
    "project_fingerprint",
  ],
  propose: [
    "read",
    "grep",
    "glob",
    "read_ssot",
    "read_syllabus",
    "context_status",
    "evidence_gate",
  ],
  contract: ["goal_contract", "read_ssot", "read_syllabus", "context_status"],
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
    // MCP research/branding tools, same namespace shape as the host.
    "image-brand_*",
    "public-api_*",
  ],
  verify: [
    "goal_contract",
    "evidence_gate",
    "verify_real",
    "syntax_check",
    "shell",
    "read",
    // Diagnostics belong to verification: after an edit, the same agent must
    // be able to read the real LSP errors it is claiming to have fixed.
    "symbol_overview",
    "find_symbols",
    "find_references",
    "diagnostics_for_file",
    "image-brand_*",
    "public-api_*",
    ...MISSIONBARISAL_READONLY,
  ],
  respond: ["context_status", "append_syllabus"],
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
