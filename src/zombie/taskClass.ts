// Five-level task classifier. The route only needs three kinds (trivial,
// readonly, substantive); this classifier answers the finer question the
// document asks: how much process does this turn deserve?
//
// It is deliberately pure: no file reads, no model calls, no clock. A caller
// passes the user message plus an optional file count and gets a level, the
// signals that produced it, and whether the project write gate applies.
// Keeping it pure makes the calibration testable and keeps the router cheap.

export const TASK_COMPLEXITIES = [
  "trivial",
  "small",
  "medium",
  "substantive",
  "complex",
] as const;

export type TaskComplexity = (typeof TASK_COMPLEXITIES)[number];

export function isTaskComplexity(value: unknown): value is TaskComplexity {
  return typeof value === "string" && (TASK_COMPLEXITIES as readonly string[]).includes(value);
}

const TRIVIAL =
  /^(?:hi|hello|hey|thanks?|thank you|ok(?:ay)?|হাই|হ্যালো|ধন্যবাদ|ওকে|ঠিক আছে|হুম|হাঁ|হ্যাঁ)[\s!।.,?]*$/i;

export function isTrivialMessage(message: string): boolean {
  const text = String(message ?? "").trim();
  return text.length === 0 || TRIVIAL.test(text);
}

// A risk word is not a veto; it is a reason to slow down. Distinct categories
// are counted (delete, deploy, schema, auth, secrets, production) so a sentence
// that repeats "delete" does not score like six separate risks.
const RISK_GROUPS: readonly RegExp[] = [
  /\b(?:delete|drop|truncate|reset|wipe|purge|মুছে|ডিলিট)\b/i,
  /\b(?:deploy|release|publish|production|prod|ডিপ্লয়|প্রোডাকশন)\b/i,
  /\b(?:migrat\w*|schema|database|migration|মাইগ্রেট|স্কিমা)\b/i,
  /\b(?:auth\w*|login|session|permission\w*|policy|অথেনটিকেশন|পারমিশন)\b/i,
  /\b(?:secret\w*|token\w*|credential\w*|api[-\s]?key|সিক্রেট|টোকেন)\b/i,
  /\b(?:all files|every file|entire|whole repo|across the repo|সব\s*ফাইল|পুরো\s*(?:রিপো|প্রজেক্ট))\b/i,
];

export type ComplexityInput = {
  message: string;
  /** True when the message asks to change project state. */
  writeIntent?: boolean;
  /** Focus files the caller already resolved, used as blast-radius signal. */
  fileCount?: number;
}

export type ComplexityReport = {
  level: TaskComplexity;
  score: number;
  writeIntent: boolean;
  /** Short, human-readable reasons the level is what it is. */
  signals: string[];
  /**
   * True when the substantive contract gate applies. The project gate is
   * stricter than the document: any write needs a goal_contract, so a
   * small/medium write also reports true.
   */
  contractRequired: boolean;
  /** Read-only turns that may answer without the footprint/investigate walk. */
  fastPath: boolean;
};

export function classifyComplexity(input: ComplexityInput): ComplexityReport {
  const message = String(input?.message ?? "");
  const writeIntent = Boolean(input?.writeIntent);
  const fileCount = Math.max(0, Number(input?.fileCount) || 0);
  const signals: string[] = [];

  if (isTrivialMessage(message)) {
    return {
      level: "trivial",
      score: 0,
      writeIntent,
      signals: ["greeting/empty"],
      contractRequired: false,
      fastPath: true,
    };
  }

  let score = 0;
  if (writeIntent) {
    score += 2;
    signals.push("write-intent");
  }
  if (fileCount >= 2) {
    score += 1;
    signals.push(`files:${fileCount}`);
  }
  if (fileCount >= 6) {
    score += 1;
    signals.push("wide-blast-radius");
  }
  const risks = RISK_GROUPS.filter((pattern) => pattern.test(message));
  if (risks.length > 0) {
    const points = Math.min(3, risks.length);
    score += points;
    signals.push(`risk:${risks.length}`);
  }
  if (message.length > 600) {
    score += 1;
    signals.push("long-request");
  }
  if (message.length > 1500) {
    score += 1;
    signals.push("very-long-request");
  }

  const level: TaskComplexity =
    score >= 5 ? "complex" : score >= 3 ? "substantive" : score >= 1 ? "medium" : "small";
  if (signals.length === 0) signals.push("no-risk-signal");

  return {
    level,
    score,
    writeIntent,
    signals,
    contractRequired: level === "substantive" || level === "complex" || writeIntent,
    fastPath: !writeIntent && (level === "small" || level === "medium"),
  };
}
