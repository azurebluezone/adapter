// User-turn resolution for the context hook.
//
// `session.synthetic` cards reach the model as ordinary user messages (the
// memory archive stores them with role "user"), so a contract preview card used
// to look like a new user turn and reset the route. Every synthetic text the
// plugin sends is recorded here; the resolver skips those when it looks for the
// real user turn.

import { roleOf, textOf } from "../zombie/memory.ts";
import { hashMessage } from "./route.ts";

export const SYNTHETIC_STORAGE_PREFIX = "synthetic/";
const SYNTHETIC_KEEP = 40;

export type TurnStorage = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: any) => Promise<void>;
};

export function normalizeSyntheticText(text: string): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function syntheticKey(sessionID: string): string {
  return `${SYNTHETIC_STORAGE_PREFIX}${sessionID}`;
}

export async function rememberSynthetic(
  storage: TurnStorage,
  sessionID: string,
  text: string,
): Promise<void> {
  if (!sessionID || sessionID === "unknown") return;
  const normalized = normalizeSyntheticText(text);
  if (!normalized) return;
  const key = syntheticKey(sessionID);
  const previous = await storage.get(key);
  const hashes = Array.isArray(previous)
    ? previous.filter((value): value is string => typeof value === "string")
    : [];
  const hash = hashMessage(normalized);
  const next = [...hashes.filter((value) => value !== hash), hash].slice(-SYNTHETIC_KEEP);
  await storage.set(key, next);
}

export async function readSyntheticHashes(
  storage: TurnStorage,
  sessionID: string,
): Promise<Set<string>> {
  const value = await storage.get(syntheticKey(sessionID));
  return new Set(
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [],
  );
}

export function isSyntheticText(text: string, hashes: ReadonlySet<string>): boolean {
  return hashes.has(hashMessage(normalizeSyntheticText(text)));
}

export type ResolvedUserTurn = {
  text: string;
  count: number;
};

/**
 * Walk the hook payload backwards and return the last real user message plus
 * the number of real user turns. Plugin-generated synthetic cards are skipped
 * by the caller's predicate, so a preview/result card cannot start a new turn.
 */
export function resolveUserTurn(
  messages: ReadonlyArray<any>,
  isSynthetic: (text: string) => boolean,
): ResolvedUserTurn {
  let text = "";
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (String(roleOf(message) ?? "").toLowerCase() !== "user") continue;
    const candidate = textOf(message);
    if (!candidate) continue;
    if (isSynthetic(candidate)) continue;
    count += 1;
    if (!text) text = candidate;
  }
  return { text, count };
}
