// One deterministic word list for every intent classifier.
//
// Two classifiers used to carry their own regex: the route gate in
// `src/agents/route.ts` and the context hint in `src/zombie/intent.ts`. They
// drifted, so a Bengali change request could be "change" in the prompt and
// "readonly" at the gate (or the reverse). This module is the single source of
// truth; both callers only choose what to do with the verdict.

export type IntentKind = "conversation" | "inspect" | "change" | "verify";

export const CHANGE_INTENT =
  /\b(?:build|create|make|add|implement|fix|refactor|rewrite|write|delete|remove|update|change|install|reinstall|uninstall|deploy|migrate|generate|patch|edit|convert|rename|scaffold|wire|rewire|connect|mount|enable|disable|apply|sync|prune|replace|clean|start)\b|(?:বানাও|বানাতে|তৈরি|লিখে|লিখো|লিখ|ঠিক\s*কর|ঠিক\s*করে|ফিলাপ|যোগ\s*কর|যুক্ত\s*কর|বদল|বদলে|মুছে|মুছ|ইনস্টল|রিইনস্টল|কানেক্ট|চালু\s*কর|বন্ধ\s*কর|আপডেট|শুরু\s*কর|প্রতিস্থাপন|সিঙ্ক|মাইগ্রেট|ডিপ্লয়|সংযোজন|পরিবর্তন|বাদ\s*দি|করে\s*দে(?:ও|বো|ব|ন|ছে|বে|লো|লাম)?(?![\u0980-\u09FF])|টেস্ট\s*কর)/i;

export const VERIFY_INTENT =
  /\b(?:test|compile|typecheck|lint|verify|validate)\b|(?:টেস্ট|কম্পাইল|যাচাই|পরীক্ষা)/i;

export const READ_INTENT =
  /\b(?:check|inspect|audit|analy[sz]e|review|explain|find|search|read|show|trace|diagnose|run|compare)\b|(?:চেক|দেখ|বিশ্লেষণ|পর্যালোচনা|খুঁজ|বুঝিয়ে|বলো|কী|কেন|কোথায়|কেমন|যাচাই|পরীক্ষা)/i;

/**
 * Intent matching reads the user's instruction, not a quoted diagnostic.
 * Pasted errors contain verbs such as `write`; treating them as the request is
 * how a read-only question used to become a write contract.
 */
export function stripQuotedText(message: string): string {
  return String(message ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/"[^"\n]*"/g, " ")
    .replace(/“[^”\n]*”/g, " ")
    .replace(/'[^'\n]{1,400}'/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyIntentKind(message: string): IntentKind {
  const text = String(message ?? "").trim();
  if (!text) return "conversation";
  const intent = stripQuotedText(text) || text;
  if (CHANGE_INTENT.test(intent)) return "change";
  if (VERIFY_INTENT.test(intent)) return "verify";
  if (READ_INTENT.test(intent)) return "inspect";
  return "conversation";
}
