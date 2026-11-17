// Deterministic request classification. This is a routing aid, not a claim
// that natural language can be understood with certainty. The user's exact
// request remains the source of truth and always travels with the context.

import { detectExtensionHints, extractTerms, resolveFocus, type FocusPlan } from "./focus.ts";
import { classifyIntentKind, type IntentKind } from "./intentRules.ts";

export type { IntentKind };

export type Intent = {
  kind: IntentKind;
  confidence: "deterministic";
  terms: string[];
  extensionHints: string[];
  focus: FocusPlan | null;
  reason: string;
};

export function classifyIntent(message: string, files: string[] = []): Intent {
  const text = String(message ?? "").trim();
  // One shared word list with the route gate; see zombie/intentRules.ts.
  const kind = classifyIntentKind(text);
  const focus = text && files.length ? resolveFocus(files, text) : null;
  return {
    kind,
    confidence: "deterministic",
    terms: extractTerms(text),
    extensionHints: detectExtensionHints(text),
    focus,
    reason:
      kind === "change"
        ? "explicit change verb"
        : kind === "verify"
          ? "explicit verification verb"
          : kind === "inspect"
            ? "explicit inspection verb"
            : "no work verb; keep this conversational until the user states an action",
  };
}
