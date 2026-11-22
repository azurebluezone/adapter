// Claim evidence — what the processor itself observed.
//
// The response gate used to read proof out of the model's prose: the phrase
// "0 failed" in an answer satisfied the test rule even when no test had run.
// A model can write any phrase, so prose is a claim, not evidence. This module
// keeps the tool results the plugin observed and answers three deterministic
// questions:
//
//   1. did a tool output contain the phrase the answer cites?
//   2. did a mutating tool touch the file the answer says it changed?
//   3. does the contract's check actually compare what the answer calls "same"?
//
// Nothing here understands the task. It only refuses to let the model grade
// its own homework.

export type ToolEvidence = {
  tool: string;
  status: string;
  input: unknown;
  output: string;
};

export type TurnEvidence = { entries: ToolEvidence[] };

export type ContractScope = {
  check?: string;
  expected?: string;
  observed?: string;
};

export const MAX_EVIDENCE_ENTRIES = 60;
export const MAX_EVIDENCE_OUTPUT = 8000;

const MUTATION_TOOLS = new Set([
  "edit",
  "write",
  "patch",
  "multiedit",
  "apply_patch",
  "create",
  "replace",
]);

// A shell command only counts as a mutation when it writes. Reading a file
// (`cat`, `grep`) proves the file exists, never that it changed.
const SHELL_MUTATION =
  /(?:^|[\s;&|])(?:sed\s+-i|perl\s+-i|tee\b|cp\b|mv\b|rm\b|mkdir\b|touch\b|truncate\b|dd\b)|>>?\s*\S/;

// "same as", "identical", "পুরো ডিজাইন", "হুবহু", "এর মতোই" — a comparison the
// answer cannot prove with a single file's existence.
const COMPARATIVE_CLAIM =
  /(?:\b(?:same|identical|exactly|whole|entire)\b|পুরো|সম্পূর্ণ|হুবহু|একদম\s*সেইম|এর\s*মতো(?:ই)?)/i;

// A check that can prove a comparison: a diff, a compare script, a match test.
const COMPARISON_CHECK =
  /(?:\bdiff\b|\bcompare\b|\bcomparison\b|\bsame\b|\bmatch(?:es|ed)?\b|তুলনা|মিলিয়ে|মিলাও|পার্থক্য)/i;

export function normalizeToolName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .toLowerCase();
}

export function addEvidence(list: TurnEvidence | undefined, entry: ToolEvidence): TurnEvidence {
  return { entries: [...(list?.entries ?? []), entry].slice(-MAX_EVIDENCE_ENTRIES) };
}

/** Successful tool output only: a failed command proves nothing. */
export function evidenceText(evidence?: TurnEvidence): string {
  return (evidence?.entries ?? [])
    .filter((entry) => entry.status !== "error")
    .map((entry) => entry.output)
    .join("\n");
}

export function phraseObserved(phrase: string, evidence?: TurnEvidence): boolean {
  const needle = String(phrase ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return false;
  return evidenceText(evidence).toLowerCase().includes(needle);
}

function inputText(entry: ToolEvidence): string {
  try {
    return JSON.stringify(entry.input ?? "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeCitation(candidate: string): string {
  return String(candidate ?? "")
    .trim()
    .replace(/:\d+(?:-\d+)?$/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .toLowerCase();
}

/**
 * True when a successful mutating tool in this turn named the cited file.
 * The input is searched as JSON, so both `filePath` and `command` forms count.
 */
export function mutationTouched(candidate: string, evidence?: TurnEvidence): boolean {
  const needle = normalizeCitation(candidate);
  if (!needle) return false;
  for (const entry of evidence?.entries ?? []) {
    if (entry.status === "error") continue;
    const tool = normalizeToolName(entry.tool);
    const input = inputText(entry);
    if (!input.includes(needle)) continue;
    if (MUTATION_TOOLS.has(tool)) return true;
    if (["shell", "bash", "command", "execute"].includes(tool)) {
      const command = String((entry.input as Record<string, unknown> | null)?.command ?? "");
      if (SHELL_MUTATION.test(command)) return true;
    }
  }
  return false;
}

export function isComparativeClaim(text: string): boolean {
  return COMPARATIVE_CLAIM.test(String(text ?? ""));
}

/** A contract covers a comparison only when its own check compares. */
export function contractCompares(contract?: ContractScope | null): boolean {
  if (!contract) return false;
  return COMPARISON_CHECK.test(`${contract.check ?? ""} ${contract.expected ?? ""}`);
}
