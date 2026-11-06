// Registry of the nine controllers. Import order is the roster order used by the
// installer, the syllabus and the UI. `roster.ts` consumes this list; nothing
// here imports roster, so the dependency arrow points one way.

import { AgentController } from "./base.ts";
import { AGENT_MODES, MODE_REGISTRY, isAgentMode, planModeSwitch, type AgentMode } from "../zombie/modes.ts";
import type { AgentID, AgentProfile } from "./types.ts";
import { manu } from "./manu.ts";
import { jarin } from "./jarin.ts";
import { brishti } from "./brishti.ts";
import { rashed } from "./rashed.ts";
import { halim } from "./halim.ts";
import { majnu } from "./majnu.ts";
import { nila } from "./nila.ts";
import { tuhin } from "./tuhin.ts";
import { zombiecoder } from "./zombiecoder.ts";

export const AGENT_CONTROLLERS: readonly AgentController[] = Object.freeze([
  manu,
  jarin,
  brishti,
  rashed,
  halim,
  majnu,
  nila,
  tuhin,
  zombiecoder,
]);

export const AGENT_PROFILES: readonly AgentProfile[] = Object.freeze(
  AGENT_CONTROLLERS.map((controller) => controller.profile),
);

const BY_ID = new Map<string, AgentController>(
  AGENT_CONTROLLERS.map((controller) => [controller.id, controller]),
);

export function getAgentController(id: string): AgentController | undefined {
  return BY_ID.get(String(id ?? "").trim());
}

export function getAgentProfile(id: string): AgentProfile | undefined {
  return getAgentController(id)?.profile;
}

/**
 * Resolve a controller with the config-level `agentModes` override. The base
 * controller is frozen and never mutated: a mode switch is a new controller,
 * which keeps the default roster stable for every other caller.
 */
export function resolveAgentController(
  id: string,
  overrides?: Record<string, string> | null,
): AgentController | undefined {
  const base = getAgentController(id);
  if (!base) return undefined;
  const raw = overrides?.[base.id];
  if (!isAgentMode(raw) || raw === base.profile.mode) return base;
  const plan = planModeSwitch({ agent: { id: base.id, mode: base.profile.mode }, next: raw });
  if (!plan.ok) return base;
  return new AgentController({ ...base.profile, mode: raw });
}

export function resolveAgentProfiles(overrides?: Record<string, string> | null): readonly AgentProfile[] {
  return AGENT_CONTROLLERS.map((controller) => resolveAgentController(controller.id, overrides)!.profile);
}

export type SubagentVerdict = {
  allowed: boolean;
  mode?: AgentMode;
  reason?: string;
};

/**
 * Defense in depth for the host's own mode check. A primary agent must never be
 * launched as a child, even if a stale config or a host bug says otherwise.
 */
export function subagentGuard(
  id: string,
  overrides?: Record<string, string> | null,
): SubagentVerdict {
  const controller = resolveAgentController(id, overrides);
  if (!controller) return { allowed: false, reason: `unknown agent "${String(id ?? "")}"` };
  const mode = controller.profile.mode;
  if (mode === "primary") {
    return {
      allowed: false,
      mode,
      reason: `agent "${controller.id}" is mode=primary; a primary agent cannot run as a subagent`,
    };
  }
  return { allowed: true, mode };
}

export type ModeMatrixCell = {
  mode: AgentMode;
  asPrimary: boolean;
  asSubagent: boolean;
  inPicker: boolean;
};

export type ModeMatrixRow = {
  agent: AgentID;
  current: AgentMode;
  cells: Record<AgentMode, ModeMatrixCell>;
};

function modeCell(mode: AgentMode): ModeMatrixCell {
  const info = MODE_REGISTRY[mode];
  return {
    mode,
    asPrimary: info.asPrimary,
    asSubagent: info.asSubagent,
    inPicker: info.inPicker,
  };
}

/** Nine agents x three modes, with the effective (config-resolved) current mode. */
export function modeMatrix(overrides?: Record<string, string> | null): readonly ModeMatrixRow[] {
  return AGENT_CONTROLLERS.map((controller) => ({
    agent: controller.id,
    current: resolveAgentController(controller.id, overrides)!.profile.mode,
    cells: {
      primary: modeCell("primary"),
      subagent: modeCell("subagent"),
      all: modeCell("all"),
    },
  }));
}

export { AGENT_MODES };

export function isAgentID(id: string): id is AgentID {
  return BY_ID.has(id);
}

export function agentIDs(): AgentID[] {
  return AGENT_PROFILES.map((profile) => profile.id);
}

export { AgentController, defineAgent, renderAgentPrompt } from "./base.ts";
export type {
  AgentID,
  AgentProfile,
  AgentRun,
  ContractSnapshot,
  ReleaseCheck,
  RoutePhase,
  TaskKind,
} from "./types.ts";
