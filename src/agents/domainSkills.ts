// Domain-skill map — the knowledge base every agent carries in its prompt.
//
// A persona alone is not a specialist. Each entry names the concrete methods
// the agent is expected to apply, and the map is keyed by `AgentID` so a new
// agent without a domain entry is a type error rather than a silent gap.
// `renderAgentPrompt` appends the entry, and `scripts/check-intent-judge.mjs`
// asserts every roster id has one.

import type { AgentID } from "./types.ts";

export const DOMAIN_SKILLS: Readonly<Record<AgentID, readonly string[]>> = Object.freeze({
  manu: [
    "SSOT provenance map",
    "Boundary ownership matrix",
    "Data-flow and dependency arrows",
    "Idempotent orchestration design",
    "Context budget ledger",
    "Rollback and migration path",
  ],
  jarin: [
    "Symptom / trigger / cause separation",
    "Minimal reproduction construction",
    "Bisect and differential diagnosis",
    "Stack-trace and log correlation",
    "Hypothesis falsification",
    "Regression reproduction",
  ],
  brishti: [
    "Trust-boundary classification",
    "Prompt-injection corpus design",
    "Secret and credential scanning",
    "Capability scoping",
    "Provenance verification",
    "Threat-model abuse paths",
  ],
  rashed: [
    "Baseline measurement before optimization",
    "CPU / memory / I/O profiling",
    "Complexity and allocation analysis",
    "Cache and batching strategy",
    "Load and soak testing",
    "Regression budget enforcement",
  ],
  halim: [
    "Append-only knowledge capture",
    "Source-to-claim citation",
    "API and README consistency",
    "Changelog and migration notes",
    "Docs drift detection",
    "Glossary and terminology control",
  ],
  majnu: [
    "Independent oracle design",
    "Equivalence and boundary cases",
    "Negative and adversarial cases",
    "Assertion strength review",
    "Evidence artifact pack",
    "Release acceptance checklist",
  ],
  nila: [
    "Design-token systems",
    "Interaction-state coverage",
    "WCAG 2.2 AA contrast and focus",
    "Responsive layout verification",
    "Real-pixel measurement",
    "Component and regex codegen",
  ],
  tuhin: [
    "Model capability and cutoff audit",
    "Hallucination and grounding checks",
    "Routing and fallback policy",
    "Token and cost accounting",
    "MCP tool-surface validation",
    "Provider-config drift detection",
  ],
  zombiecoder: [
    "Claim provenance ledger",
    "Evidence tiering",
    "Tie-break precedence",
    "Pre-registered gate criteria",
    "Conflict resolution record",
    "Accountability statement",
  ],
  "intent-judge": [
    "Original-intent reconstruction",
    "Requirement-to-evidence mapping",
    "Path and symbol verification",
    "Compiler and test-output reading",
    "Syllabus fact retrieval",
    "Independent PASS/FAIL adjudication",
    "Scope and mutation auditing",
  ],
});

export function domainSkillsFor(id: string): readonly string[] {
  return DOMAIN_SKILLS[id as AgentID] ?? [];
}
