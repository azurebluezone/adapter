// External payload hygiene.
//
// Pasted documents and model-generated pages often carry invisible characters:
// zero-width space/joiners, bidi controls, soft hyphens, BOMs. They are used as
// carriage for watermarking, and a zero-width joiner inside "create" is also a
// real bug source (copy-pasted identifiers stop matching). We treat them as data
// noise, never as signal.

const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;

export type InvisibleReport = {
  count: number;
  suspicious: boolean;
  kinds: string[];
};

export type SanitizedMessages = { messages: any[]; affected: Array<{ index: number; count: number; kinds: string[] }> };

const NAMED: Array<{ re: RegExp; label: string }> = [
  { re: /\u200B/g, label: "zero-width space" },
  { re: /\u200C/g, label: "zero-width non-joiner" },
  { re: /\u200D/g, label: "zero-width joiner" },
  { re: /\uFEFF/g, label: "byte-order mark" },
  { re: /\u00AD/g, label: "soft hyphen" },
  { re: /[\u202A-\u202E]/g, label: "bidi control" },
  { re: /[\u2060-\u2064\u206A-\u206F]/g, label: "invisible operator" },
];

/** Remove invisible formatting characters. Idempotent. */
export function stripInvisible(text: string): string {
  return String(text ?? "").replace(INVISIBLE, "");
}

/** Clone a context payload and remove invisible controls from user-authored text. */
export function sanitizeUserMessages(messages: readonly any[]): SanitizedMessages {
  const affected: SanitizedMessages["affected"] = [];
  const cleanValue = (value: any): any => {
    if (typeof value === "string") return stripInvisible(value);
    if (Array.isArray(value)) return value.map(cleanValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cleanValue(child)]));
  };
  const result = messages.map((message, index) => {
    const role = String(message?.role ?? message?.type ?? message?.info?.role ?? "").toLowerCase();
    if (role !== "user") return message;
    const raw = JSON.stringify(message);
    const report = detectInvisible(raw);
    if (report.count) affected.push({ index, count: report.count, kinds: report.kinds });
    return cleanValue(message);
  });
  return { messages: result, affected };
}

/** Report invisible characters without changing the text. */
export function detectInvisible(text: string): InvisibleReport {
  const value = String(text ?? "");
  const matches = value.match(INVISIBLE) ?? [];
  const kinds = NAMED.filter((entry) => new RegExp(entry.re.source, "g").test(value)).map((entry) => entry.label);
  return { count: matches.length, suspicious: matches.length >= 3, kinds };
}

/**
 * Trailing whitespace steganography: many lines ending in exactly two spaces is a
 * classic markdown-side channel. Two or three such lines happen by accident;
 * a sustained pattern does not.
 */
export function detectTrailingMark(text: string): boolean {
  const lines = String(text ?? "").split(/\r?\n/);
  const marked = lines.filter((line) => /[^ \t] {2,}$/.test(line)).length;
  return lines.length >= 12 && marked >= Math.ceil(lines.length * 0.4);
}

export function isExternallyMarked(text: string): InvisibleReport & { trailing: boolean } {
  return { ...detectInvisible(text), trailing: detectTrailingMark(text) };
}
