// A subagent must not restart the whole investigation just to learn why it was
// launched. This module renders one bounded envelope: original intent, approved
// goal, the files in play, earlier failures and, when available, a typed
// investigation package. The plugin refuses a launch whose prompt lacks it, so
// the envelope is an enforced contract, not a prompt suggestion.

import {
  investigationDigest,
  validateInvestigation,
  type Investigation,
} from "./investigation.ts";

export const ENVELOPE_HEADER = "## SUBAGENT ENVELOPE";

export const ENVELOPE_LIMITS = {
  files: 12,
  failures: 3,
  constraints: 6,
  chars: 3000,
};

export type SubagentEnvelopeInput = {
  intent: string;
  goal?: string;
  files?: string[];
  priorFailures?: string[];
  constraints?: string[];
  investigation?: unknown;
};

export type SubagentEnvelope = {
  intent: string;
  goal: string;
  files: string[];
  priorFailures: string[];
  constraints: string[];
  investigation?: Investigation;
};

function clean(value: unknown, limit: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function unique(values: unknown, limit: number, itemLimit: number): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const item = clean(value, itemLimit);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildSubagentEnvelope(input: SubagentEnvelopeInput): SubagentEnvelope {
  const intent = clean(input?.intent, 600);
  if (!intent) throw new Error("subagent envelope needs the original intent");
  const envelope: SubagentEnvelope = {
    intent,
    goal: clean(input?.goal, 600) || "none (read-only or already approved context)",
    files: unique(input?.files, ENVELOPE_LIMITS.files, 300),
    priorFailures: unique(input?.priorFailures, ENVELOPE_LIMITS.failures, 300),
    constraints: unique(input?.constraints, ENVELOPE_LIMITS.constraints, 300),
  };
  if (input?.investigation !== undefined) {
    const check = validateInvestigation(input.investigation);
    if (!check.ok) throw new Error(`investigation is invalid: ${check.errors.join("; ")}`);
    envelope.investigation = check.value;
  }
  return envelope;
}

export function renderEnvelope(envelope: SubagentEnvelope): string {
  const lines = [
    ENVELOPE_HEADER,
    `- Intent: ${envelope.intent}`,
    `- Goal: ${envelope.goal}`,
    `- Files: ${envelope.files.length ? envelope.files.join(", ") : "none"}`,
    `- Prior failures: ${envelope.priorFailures.length ? envelope.priorFailures.join(" | ") : "none"}`,
    `- Constraints: ${envelope.constraints.length ? envelope.constraints.join(" | ") : "none"}`,
  ];
  if (envelope.investigation) {
    lines.push(`- Investigation: ${investigationDigest(envelope.investigation)}`);
    lines.push(`- Investigation JSON: ${JSON.stringify(envelope.investigation)}`);
  }
  const text = lines.join("\n");
  if (text.length <= ENVELOPE_LIMITS.chars) return text;
  // Trim the JSON first: the human summary is the part a subagent must read.
  const withoutJson = lines.slice(0, -1).join("\n");
  const digestOnly = lines.slice(0, -2).join("\n");
  return (withoutJson.length <= ENVELOPE_LIMITS.chars ? withoutJson : digestOnly).slice(
    0,
    ENVELOPE_LIMITS.chars,
  );
}

export type EnvelopeCheck = { ok: boolean; missing: string[] };

/** The plugin-side gate: no header or no intent/goal means the child would
 *  receive an unbounded prompt and no approved goal. */
export function validateEnvelopePrompt(prompt: string): EnvelopeCheck {
  const text = String(prompt ?? "");
  const missing: string[] = [];
  if (!text.includes(ENVELOPE_HEADER)) missing.push("SUBAGENT ENVELOPE header");
  if (!/^\s*-\s*Intent:\s*\S+/m.test(text)) missing.push("intent");
  if (!/^\s*-\s*Goal:\s*\S+/m.test(text)) missing.push("approved goal");
  if (!/^\s*-\s*Files:/m.test(text)) missing.push("files line");
  return { ok: missing.length === 0, missing };
}

export function parseEnvelope(prompt: string): SubagentEnvelope | null {
  const text = String(prompt ?? "");
  if (!text.includes(ENVELOPE_HEADER)) return null;
  const pick = (label: string): string => {
    const match = new RegExp(`^\\s*-\\s*${label}:\\s*(.*)$`, "m").exec(text);
    return match ? match[1].trim() : "";
  };
  const intent = pick("Intent");
  const goal = pick("Goal");
  if (!intent || !goal) return null;
  const list = (label: string): string[] => {
    const value = pick(label);
    if (!value || value === "none") return [];
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  };
  const files = pick("Files");
  return {
    intent,
    goal,
    files: files && files !== "none" ? files.split(",").map((item) => item.trim()).filter(Boolean) : [],
    priorFailures: list("Prior failures"),
    constraints: list("Constraints"),
  };
}
