// Prompt budget guard. The shared rules are user-approved governance text, so
// "compression" must not quietly delete a rule. What we can do is measure every
// persona prompt, prove the shared block appears exactly once, and fail when a
// future edit pushes a prompt over budget or starts duplicating long lines.

export type PromptBudgetEntry = { agent: string; bytes: number };

export type PromptBudgetReport = {
  ok: boolean;
  budgetBytes: number;
  maxBytes: number;
  totalBytes: number;
  agents: PromptBudgetEntry[];
  sharedCopies: Record<string, number>;
  duplicateLines: string[];
  issues: string[];
};

const LONG_LINE = 40;

export function auditPromptBudget(
  prompts: Record<string, string>,
  sharedRules: string,
  budgetBytes = 32000,
): PromptBudgetReport {
  const issues: string[] = [];
  const agents: PromptBudgetEntry[] = [];
  const sharedCopies: Record<string, number> = {};
  const duplicateLines = new Set<string>();
  let totalBytes = 0;
  let maxBytes = 0;

  for (const [agent, raw] of Object.entries(prompts)) {
    const text = String(raw ?? "");
    const bytes = Buffer.byteLength(text, "utf8");
    agents.push({ agent, bytes });
    totalBytes += bytes;
    maxBytes = Math.max(maxBytes, bytes);
    if (bytes > budgetBytes) issues.push(`${agent}: ${bytes} bytes exceeds ${budgetBytes}`);

    if (sharedRules) {
      const copies = text.split(sharedRules).length - 1;
      sharedCopies[agent] = copies;
      if (copies !== 1) issues.push(`${agent}: shared rules appear ${copies} times, expected 1`);
    }

    const seen = new Set<string>();
    for (const line of text.split("\n")) {
      const key = line.trim();
      if (key.length < LONG_LINE) continue;
      if (seen.has(key)) duplicateLines.add(`${agent}: ${key.slice(0, 80)}`);
      seen.add(key);
    }
  }

  for (const duplicate of duplicateLines) issues.push(`duplicate line — ${duplicate}`);
  return {
    ok: issues.length === 0,
    budgetBytes,
    maxBytes,
    totalBytes,
    agents: agents.sort((a, b) => b.bytes - a.bytes),
    sharedCopies,
    duplicateLines: [...duplicateLines],
    issues,
  };
}
