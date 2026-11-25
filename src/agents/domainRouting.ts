// Deterministic request-to-domain routing. This is an assignment hint, not
// a model switch: the selected agent remains owner and may use only bounded
// specialists allowed by the delegation matrix.

import type { AgentID, DomainKind } from "./types.ts";

export type DomainAssignment = {
  domain: DomainKind;
  owner: AgentID;
  minimum: readonly string[];
};

const RULES: readonly { domain: DomainKind; owner: AgentID; patterns: readonly RegExp[]; minimum: readonly string[] }[] = [
  {
    domain: "security",
    owner: "brishti",
    patterns: [/\b(?:security|auth|authentication|authorization|secret|credential|token|prompt injection|threat)\b/i, /(?:নিরাপত্তা|সিকিউরিটি|অনুমোদন|সিক্রেট|টোকেন|চাবি|প্রম্পট ইনজেকশন)/i],
    minimum: ["identify trust boundary", "name abuse path", "verify the scoped fix"],
  },
  {
    domain: "performance",
    owner: "rashed",
    patterns: [/\b(?:slow|performance|latency|throughput|memory|cpu|optimiz|profile|benchmark|leak)\b/i, /(?:ধীর|পারফরম্যান্স|লেটেন্সি|মেমোরি|সিপিইউ|অপ্টিমাইজ|বেঞ্চমার্ক)/i],
    minimum: ["measure baseline", "identify the bottleneck", "verify with the same check"],
  },
  {
    domain: "ui",
    owner: "nila",
    patterns: [/\b(?:css|html|layout|responsive|button|form|dialog|modal|accessibility|a11y|pixel|frontend|ui|ux)\b/i, /(?:ডিজাইন|লেআউট|বাটন|ফর্ম|মোডাল|রেসপন্সিভ|পিক্সেল|ইউআই|ইউএক্স)/i],
    minimum: ["read the real component", "measure the relevant state", "verify desktop and mobile behavior"],
  },
  {
    domain: "documentation",
    owner: "halim",
    patterns: [/\b(?:readme|docs|documentation|handoff|changelog|glossary|comment)\b/i, /(?:ডকুমেন্টেশন|হ্যান্ডঅফ|চেঞ্জলগ|তথ্যপত্র|README)/i],
    minimum: ["trace source claims", "update only documented behavior", "run the docs checker"],
  },
  {
    domain: "models",
    owner: "tuhin",
    patterns: [/\b(?:model|provider|mcp|catalog|token|fallback|routing|endpoint)\b/i, /(?:মডেল|প্রোভাইডার|ক্যাটালগ|টোকেন|ফ্যালব্যাক|রাউটিং|এন্ডপয়েন্ট)/i],
    minimum: ["check live capability/config", "separate runner from identity", "verify fallback behavior"],
  },
  {
    domain: "quality",
    owner: "majnu",
    patterns: [/\b(?:test|qa|quality|assertion|coverage|negative|adversarial|acceptance)\b/i, /(?:টেস্ট|কভারেজ|কোনোটা|বাধ্যতা|প্রমাণ)/i],
    minimum: ["choose observable criteria", "cover the boundary", "run the real check"],
  },
  {
    domain: "debug",
    owner: "jarin",
    patterns: [/\b(?:bug|error|exception|crash|failed|failure|fix|broken|stack trace|log)\b/i, /(?:বাগ|এরর|ত্রুটি|ক্র্যাশ|ফেইল|ভাঙা|স্ট্যাক ট্রেস|লগ)/i],
    minimum: ["reproduce the symptom", "test one falsifiable hypothesis", "verify the smallest fix"],
  },
  {
    domain: "architecture",
    owner: "manu",
    patterns: [/\b(?:architect|architecture|boundary|dependency|migration|orchestrat|data flow|design)\b/i, /(?:আর্কিটেকচার|সীমানা|ডিপেন্ডেন্সি|মাইগ্রেশন|ডেটা ফ্লো|নকশা)/i],
    minimum: ["map the current boundary", "choose the smallest owning surface", "verify reversibility"],
  },
];

export function routeDomain(message: string): DomainAssignment {
  const text = String(message ?? "");
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return { domain: rule.domain, owner: rule.owner, minimum: rule.minimum };
    }
  }
  return {
    domain: "general",
    owner: "zombiecoder",
    minimum: ["read the project SSOT", "find the smallest real check", "verify before completion"],
  };
}
