// Deterministic request classification. This is a routing aid, not a claim
// that natural language can be understood with certainty. The user's exact
// request remains the source of truth and always travels with the context.

import { detectExtensionHints, extractTerms, resolveFocus, type FocusPlan } from "./focus.ts";

export type IntentKind = "conversation" | "inspect" | "change" | "verify";

export type Intent = {
  kind: IntentKind;
  confidence: "deterministic";
  terms: string[];
  extensionHints: string[];
  focus: FocusPlan | null;
  reason: string;
};

const CHANGE = /\b(?:add|build|create|implement|fix|refactor|rewrite|write|delete|remove|update|change|install|deploy|migrate|generate|patch|edit|convert|rename|scaffold)\b|(?:বানাও|বানাতে|তৈরি|লিখে|লিখো|ঠিক\s*কর|যোগ\s*কর|বদল|মুছে|ইনস্টল|চালু\s*কর|সংযোজন|পরিবর্তন)/i;
const VERIFY = /\b(?:test|compile|typecheck|lint|verify|validate|build)\b|(?:টেস্ট|কম্পাইল|যাচাই|পরীক্ষা)/i;
const INSPECT = /\b(?:check|inspect|audit|analy[sz]e|review|explain|find|search|read|show|trace|diagnose|compare)\b|(?:চেক|দেখ|বিশ্লেষণ|পর্যালোচনা|খুঁজ|বুঝিয়ে|বলো|কেন|কোথায়)/i;

export function classifyIntent(message: string, files: string[] = []): Intent {
  const text = String(message ?? "").trim();
  const kind: IntentKind = CHANGE.test(text)
    ? "change"
    : VERIFY.test(text)
      ? "verify"
      : INSPECT.test(text)
        ? "inspect"
        : "conversation";
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
