// One shape for every visible plugin card.
//
// The desktop renderer shows a synthetic notice's `description` as a single
// truncated line unless `metadata.source` is the native `goal` surface. A card
// that is meant to be read therefore carries the full text in `description`,
// not a short label. The same helper strips emoji, icons and decorative
// symbols: the user asked for plain text, not a second status language.

const PICTOGRAPHIC = /\p{Extended_Pictographic}\u{FE0F}?/gu;
const DECORATIVE = /[\u2190-\u21FF\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]/gu;

export type UiCard = {
  sessionID: string;
  text: string;
  description: string;
  metadata: { source: "goal"; kind: string };
};

export type UiCardInput = {
  sessionID: string;
  /** Stable semantic kind for tests and audits; never shown to the user. */
  kind: string;
  text: string;
  /** Optional visible text; defaults to `text`. */
  description?: string;
};

export function plainText(value: string): string {
  return String(value ?? "")
    .replace(PICTOGRAPHIC, "")
    .replace(DECORATIVE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasEmojiOrIcon(value: string): boolean {
  const text = String(value ?? "");
  return /\p{Extended_Pictographic}/u.test(text) || /[\u2190-\u21FF\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]/u.test(text);
}

/**
 * Build the payload the UI renders. `source: "goal"` is the native full-message
 * surface; `kind` keeps the plugin's own meaning testable.
 */
export function uiCard(input: UiCardInput): UiCard {
  const text = plainText(input.text);
  return {
    sessionID: input.sessionID,
    text,
    description: plainText(input.description ?? text),
    metadata: { source: "goal", kind: input.kind },
  };
}
