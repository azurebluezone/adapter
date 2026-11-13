// ZombieCoder agent roster — the legacy runtime shape used by the installer,
// scripts/configure.mjs and the prompt builder. The persona content lives in
// src/agents/; this file only adapts it and adds the installer-side model pin.

import type { AgentMode } from "./zombie/modes.ts";
import {
  AGENT_PROFILES,
  getAgentProfile,
  renderAgentPrompt,
} from "./agents/index.ts";
import {
  GLOBAL_PERMISSIONS,
  SHARED_EXECUTION,
  SHARED_EXPERTISE,
  SHARED_PERSONA,
  SHARED_RULES,
  type PermissionRule,
} from "./agents/shared.ts";

export {
  GLOBAL_PERMISSIONS,
  SHARED_EXECUTION,
  SHARED_EXPERTISE,
  SHARED_PERSONA,
  SHARED_RULES,
  type PermissionRule,
};

export type AgentDef = {
  id: string;
  name: string;
  callSign: string;
  role: string;
  description: string;
  mode: AgentMode;
  model: string;
  mission: string;
  persona: string;
  duties: string[];
  rule: string;
  // Barishal-tone voice: how this agent sounds in the UI. Tone only — never a
  // substitute for evidence.
  voice?: string;
  // 5 focus skills rendered into the prompt. The full 15-20 skill map lives in
  // docs/skill-map.md; the prompt carries the short list on purpose.
  skillFocus?: string[];
};

// Optional explicit last-resort model. By default each session inherits the
// OpenCode-selected model; the runtime discovers cost-0 catalog models itself.
export const BASELINE_MODEL =
  process.env.ZOMBIECODER_BASELINE_MODEL?.trim() || "";

// Agents that were renamed or removed. Kept in one list so the plugin, the
// installer and the syllabus upgrader cannot disagree about what is stale.
export const LEGACY_AGENT_IDS = ["kobir"] as const;


// Internal OpenCode sessions are not user-facing agents. They keep the short
// contract but must not pay for the full persona on every call.
const INTERNAL_AGENT_IDS = new Set(["compaction", "title", "summary"]);

/** First line of every shared persona block. Presence is the enforcement check. */
export const PERSONA_MARKER = "## ZombieCoder Shared Rules (bound by plugin — do not remove)";

/** Title/summary/compaction are host internals, not user-facing agents. */
export function isInternalAgent(agentID: string): boolean {
  return INTERNAL_AGENT_IDS.has(String(agentID ?? "").trim().toLowerCase());
}

const ALL_SPECIALIST_IDS = ["manu", "jarin", "brishti", "rashed", "halim", "majnu", "nila", "tuhin", "zombiecoder"] as const;
const SPECIALIST_TARGETS: Readonly<Record<string, readonly string[]>> = {
  zombiecoder: ALL_SPECIALIST_IDS,
  manu: ALL_SPECIALIST_IDS,
  jarin: ["majnu"],
  brishti: ["majnu"],
  rashed: ["majnu"],
  halim: ["majnu"],
  majnu: [],
  nila: ["majnu", "brishti", "jarin"],
  tuhin: ["majnu"],
};

/** Hard cap for one parallel reviewer or specialist batch. */
export const MAX_PARALLEL_SPECIALISTS = 4;

export function canDelegate(agentID: string): boolean {
  return allowedSpecialistTargets(agentID).length > 0;
}

export function allowedSpecialistTargets(agentID: string): readonly string[] {
  return SPECIALIST_TARGETS[String(agentID ?? "").trim()] ?? [];
}

export function isRosterAgent(agentID: string): boolean {
  return ROSTER.some((agent) => agent.id === String(agentID ?? "").trim());
}

export type PersonaKind = "roster" | "shared" | "none";

export interface AgentPersona {
  kind: PersonaKind;
  /**
   * Full persona text. The caller pushes it only when the live system prompt
   * lacks PERSONA_MARKER; a roster prompt already carries it.
   */
  text: string;
  /** UTF-8 bytes of `text`, for the audit trail. */
  bytes: number;
}

/**
 * Merge the ZombieCoder persona with whichever OpenCode agent is running.
 *
 * - roster agent: its generated markdown embeds SHARED_RULES +
 *   SHARED_EXECUTION + SHARED_EXPERTISE. The text is returned so a stale or
 *   missing agent file can still be fixed at runtime — the caller checks the
 *   marker before pushing and never doubles the prompt.
 * - builtin/subagent (build, plan, general, explore, custom): no roster entry,
 *   so the identity header + the full shared persona are pushed. The builtin
 *   name describes the tool surface, not the persona.
 * - internal host agent (title, summary, compaction) or unknown: none.
 */
export function mergeAgentPersona(agentID: string): AgentPersona {
  const id = String(agentID ?? "").trim() || "unknown";
  if (id === "unknown" || isInternalAgent(id)) {
    return { kind: "none", text: "", bytes: 0 };
  }
  const def = ROSTER.find((agent) => agent.id === id);
  if (def) {
    const text = agentSystemPrompt(def);
    return { kind: "roster", text, bytes: Buffer.byteLength(text, "utf8") };
  }
  const text = [
    `## ZombieCoder identity (builtin runner: ${id})`,
    "You are a ZombieCoder agent executing inside an OpenCode builtin agent runner.",
    "The builtin name describes the tool surface, not the identity. The shared",
    "rules, evidence contract and response contract below bind this session.",
    "",
    ...(id === "build"
      ? [
          "### OpenCode Metadata",
          "`agent=build`; `mode=primary`; `instruction_profile=code`.",
          "Implement and verify requested changes; report evidence.",
          "",
        ]
      : []),
    SHARED_PERSONA,
    "",
  ].join("\n");
  return { kind: "shared", text, bytes: Buffer.byteLength(text, "utf8") };
}

// Delegation is a capability, not a prompt preference. The per-agent target
// matrix limits work and review launches; Majnu cannot delegate further.
export function agentPermissions(a: AgentDef): PermissionRule[] {
  const targets = allowedSpecialistTargets(a.id);
  return targets.length
    ? targets.map((target) => ({ action: "subagent", resource: target, effect: "allow" }))
    : [{ action: "subagent", resource: "*", effect: "deny" }];
}

export function agentSystemPrompt(a: AgentDef): string {
  const profile = getAgentProfile(a.id);
  if (profile) return renderAgentPrompt(profile);
  return legacyAgentSystemPrompt(a);
}

// Only for a definition that is not in the registry (none ship today). The
// registry is the source of truth; this fallback keeps older callers working.
function legacyAgentSystemPrompt(a: AgentDef): string {
  return [
    "# " + a.name + " — " + a.callSign,
    "",
    "**Role:** " + a.role,
    "",
    "**Mission:** " + a.mission,
    "",
    "**Core Persona:** \"" + a.persona + "\"",
    "",
    a.voice ? "**Voice:** " + a.voice : "",
    a.skillFocus?.length ? "**Skill Focus:** " + a.skillFocus.join(", ") : "",
    a.skillFocus?.length
      ? "Full 15–20 skill map: `docs/skill-map.md` — websearch to extend it when a new domain appears."
      : "",
    "",
    "**Responsibilities:** " + a.duties.join(", "),
    "",
    "**Decision Rule:** " + a.rule,
    "",
    "**Focus:** keep the selected agent as task owner/reporter. Delegate only a bounded review allowed by the permission matrix; integrate findings and remain responsible.",
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

// V2 config entry. `system` is the agent's whole prompt; `permissions` is the
// ordered rule list. Both live in the global/project opencode.json so the pack
// does not depend on a single discovery door.
//
// `pins` decides who owns the model choice:
//   true  — the per-agent mapping wins (config pins every agent to a model).
//   false — the entry carries NO model, so the session/UI selection rules and a
//           subagent inherits the parent session's model (OpenCode docs: "a
//           subagent uses its configured model, or inherits the parent session's
//           model when none is configured"). This is the default because a
//           pinned agent silently ignores the model the owner picked in /models.
export function agentConfigEntry(
  a: AgentDef,
  model?: string,
  pins = true,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    description: a.description,
    mode: a.mode,
  };
  const selected = model || a.model;
  if (pins && typeof selected === "string" && selected.includes("/") && !/\s/.test(selected)) entry.model = selected;
  entry.system = agentSystemPrompt(a);
  entry.permissions = agentPermissions(a);
  return entry;
}

export function renderAgentsConfig(
  roster: AgentDef[] = ROSTER,
  assignment: Record<string, string> = {},
  pins = true,
): Record<string, Record<string, unknown>> {
  const agents: Record<string, Record<string, unknown>> = {};
  for (const a of roster) agents[a.id] = agentConfigEntry(a, assignment[a.id], pins);
  return agents;
}

// The profiles own the persona and policies; this adapter only adds the
// installer-side model pin. A model is a deployment choice, never identity.
function toAgentDef(profile: (typeof AGENT_PROFILES)[number]): AgentDef {
  return {
    id: profile.id,
    name: profile.name,
    callSign: profile.callSign,
    role: profile.role,
    description: profile.description,
    mode: profile.mode,
    model: BASELINE_MODEL,
    mission: profile.mission,
    persona: profile.persona,
    duties: [...profile.duties],
    rule: profile.rule,
    voice: profile.voice,
    skillFocus: profile.skillFocus ? [...profile.skillFocus] : undefined,
  };
}

export const ROSTER: AgentDef[] = AGENT_PROFILES.map(toAgentDef);

// Agent markdown with real frontmatter. Without the --- delimiters OpenCode dumps the
// whole file, frontmatter keys included, straight into the agent's system prompt.
//
// The model is written into frontmatter by the installer/runtime. The plugin also
// binds through ctx.agent.transform using the resolved plan; the file is the durable
// door, not the only door.
export function agentMarkdown(a: AgentDef, model?: string, pins = true): string {
  const rules = agentPermissions(a)
    .map((r) => `  - action: ${r.action}\n    resource: "${r.resource}"\n    effect: ${r.effect}`)
    .join("\n");
  const frontmatter = [
    "---",
    'description: "' + a.description + '"',
    "mode: " + a.mode,
    ...(pins && (model || a.model).includes("/") ? ["model: " + (model || a.model)] : []),
    "permissions:",
    rules,
    "---",
    "",
  ].join("\n");
  return frontmatter + agentSystemPrompt(a);
}
