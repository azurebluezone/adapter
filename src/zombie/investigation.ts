// One typed investigation package, shared by goal_contract and the subagent
// envelope. Text summaries are easy to read but impossible to re-check; this
// schema keeps the claims, their evidence and their uncertainty machine-checkable
// without adding a database or an embedding index.

export const EVIDENCE_LABELS = [
  "SOURCE_VERIFIED",
  "CONFIG_VALIDATED",
  "LIVE_PROBE_PASSED",
  "END_TO_END_TESTED",
  "NOT_TESTED",
  "UNVERIFIED",
  "FIXTURE_ONLY",
  "SELF_AUTHORED_MOCK",
] as const;

export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export type InvestigationFinding = {
  claim: string;
  evidence: string;
  label: EvidenceLabel;
};

export type Investigation = {
  version: 1;
  task: string;
  project: string;
  findings: InvestigationFinding[];
  errors: string[];
  skills: string[];
  constraints: string[];
  expected: string;
  uncertainty: string[];
  generatedAt: string;
};

const LIMITS = {
  task: 400,
  project: 400,
  claim: 400,
  evidence: 600,
  expected: 600,
  list: 20,
  item: 400,
};

function text(value: unknown, limit: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function textList(value: unknown, limit = LIMITS.list): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, LIMITS.item))
    .filter(Boolean)
    .slice(0, limit);
}

export function createInvestigation(
  input: Partial<Omit<Investigation, "version" | "generatedAt">> & {
    task: string;
    project: string;
    now?: Date;
  },
): Investigation {
  const findings = Array.isArray(input.findings)
    ? input.findings
        .map((finding) => ({
          claim: text(finding?.claim, LIMITS.claim),
          evidence: text(finding?.evidence, LIMITS.evidence),
          label: (EVIDENCE_LABELS as readonly string[]).includes(String(finding?.label))
            ? (finding.label as EvidenceLabel)
            : "UNVERIFIED",
        }))
        .filter((finding) => finding.claim.length > 0)
        .slice(0, LIMITS.list)
    : [];
  return {
    version: 1,
    task: text(input.task, LIMITS.task),
    project: text(input.project, LIMITS.project),
    findings,
    errors: textList(input.errors),
    skills: textList(input.skills),
    constraints: textList(input.constraints),
    expected: text(input.expected, LIMITS.expected),
    uncertainty: textList(input.uncertainty),
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

export type InvestigationCheck = {
  ok: boolean;
  errors: string[];
  value?: Investigation;
};

/** Strict enough to reject a launcher that forgot evidence, loose enough to
 *  accept a caller that sends only the fields it has. */
export function validateInvestigation(value: unknown): InvestigationCheck {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["investigation must be an object"] };
  }
  const raw = value as Record<string, any>;
  if (raw.version !== 1) errors.push("version must be 1");
  for (const key of ["task", "project"]) {
    if (typeof raw[key] !== "string" || !raw[key].trim()) errors.push(`${key} is required`);
  }
  if (!Array.isArray(raw.findings)) {
    errors.push("findings must be an array");
  } else {
    raw.findings.forEach((finding: any, index: number) => {
      if (!finding || typeof finding !== "object") {
        errors.push(`findings[${index}] must be an object`);
        return;
      }
      if (typeof finding.claim !== "string" || !finding.claim.trim()) {
        errors.push(`findings[${index}].claim is required`);
      }
      if (typeof finding.evidence !== "string" || !finding.evidence.trim()) {
        errors.push(`findings[${index}].evidence is required`);
      }
      if (!(EVIDENCE_LABELS as readonly string[]).includes(String(finding.label))) {
        errors.push(`findings[${index}].label is not an evidence label`);
      }
    });
  }
  for (const key of ["errors", "skills", "constraints", "uncertainty"]) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) errors.push(`${key} must be an array`);
  }
  if (typeof raw.expected !== "string") errors.push("expected must be a string");
  const normalized = createInvestigation({
    task: raw.task,
    project: raw.project,
    findings: raw.findings,
    errors: raw.errors,
    skills: raw.skills,
    constraints: raw.constraints,
    expected: raw.expected,
    uncertainty: raw.uncertainty,
    now: typeof raw.generatedAt === "string" ? new Date(raw.generatedAt) : new Date(),
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [], value: normalized };
}

/** A one-line summary for dispatch notes; the full package stays in the JSON. */
export function investigationDigest(value: Investigation): string {
  return [
    `${value.findings.length} finding${value.findings.length === 1 ? "" : "s"}`,
    `${value.errors.length} error${value.errors.length === 1 ? "" : "s"}`,
    `${value.uncertainty.length} uncertaint${value.uncertainty.length === 1 ? "y" : "ies"}`,
    `${value.skills.length} skill${value.skills.length === 1 ? "" : "s"}`,
  ].join(", ");
}
