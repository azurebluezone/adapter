// The context hook must tell a real user turn from a plugin-generated card.
// OpenCode stores synthetic cards as user messages, so the route used to reset
// right after a contract preview/result card. These tests pin the resolver that
// keeps the same turn.

import test from "node:test";
import assert from "node:assert/strict";
import {
  isSyntheticText,
  normalizeSyntheticText,
  readSyntheticHashes,
  rememberSynthetic,
  resolveUserTurn,
} from "../src/agents/turn.ts";
import { hashMessage } from "../src/agents/route.ts";

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    values,
    get: async (key: string) => values.get(key),
    set: async (key: string, value: any) => {
      values.set(key, value);
    },
  };
}

test("a synthetic card is recorded and skipped when resolving the real user turn", async () => {
  const storage = memoryStorage();
  const real = "Fix the namespaced goal_contract tool";
  const card = "🧭 শেষ ধাপ — গোল বন্ধ করার আগে\n\nগোল: Fix the namespaced goal_contract tool\nআইডি: gc_test";
  await rememberSynthetic(storage, "ses_turn", card);
  const hashes = await readSyntheticHashes(storage, "ses_turn");
  assert.equal(isSyntheticText(card, hashes), true);
  assert.equal(isSyntheticText(real, hashes), false);

  const messages = [
    { role: "user", text: real },
    { role: "assistant", text: "working" },
    { role: "user", text: card },
  ];
  const turn = resolveUserTurn(messages, (text) => isSyntheticText(text, hashes));
  assert.equal(turn.text, real);
  assert.equal(turn.count, 1);
});

test("the route keeps the same turn when a synthetic card arrives", async () => {
  const storage = memoryStorage();
  const real = "Fix the namespaced goal_contract tool";
  const card = "🧭 কাজ শুরুর আগে — একবার মিলিয়ে নাও\n\nতুমি চাইছ: Fix the namespaced goal_contract tool";
  await rememberSynthetic(storage, "ses_turn", card);
  const hashes = await readSyntheticHashes(storage, "ses_turn");
  const messages = [
    { role: "user", text: real },
    { role: "assistant", text: "contract open" },
    { role: "user", text: card },
  ];
  const resolved = resolveUserTurn(messages, (text) => isSyntheticText(text, hashes));
  const previous = { messageHash: hashMessage(real), turnIndex: 1 };
  const sameTurn =
    previous.messageHash === hashMessage(resolved.text) && previous.turnIndex === resolved.count;
  assert.equal(sameTurn, true, "a synthetic card must not start a new turn");
});

test("a real user message after a synthetic card still advances the turn", async () => {
  const storage = memoryStorage();
  const first = "Fix the namespaced goal_contract tool";
  const card = "✅ Goal Contract gc_test — PASS";
  const second = "Now run the Phase 4 campaign suite";
  await rememberSynthetic(storage, "ses_turn", card);
  const hashes = await readSyntheticHashes(storage, "ses_turn");
  const messages = [
    { role: "user", text: first },
    { role: "user", text: card },
    { role: "user", text: second },
  ];
  const turn = resolveUserTurn(messages, (text) => isSyntheticText(text, hashes));
  assert.equal(turn.text, second);
  assert.equal(turn.count, 2);
});

test("synthetic hashes are deduplicated and capped", async () => {
  const storage = memoryStorage();
  for (let i = 0; i < 45; i += 1) {
    await rememberSynthetic(storage, "ses_cap", `card ${i}`);
  }
  await rememberSynthetic(storage, "ses_cap", "card 44");
  const hashes = await readSyntheticHashes(storage, "ses_cap");
  assert.equal(hashes.size, 40);
  assert.equal(isSyntheticText("card 44", hashes), true);
  assert.equal(isSyntheticText("card 0", hashes), false);
});

test("whitespace changes in a synthetic card do not defeat the match", async () => {
  const storage = memoryStorage();
  await rememberSynthetic(storage, "ses_ws", "line one\n\nline two");
  const hashes = await readSyntheticHashes(storage, "ses_ws");
  assert.equal(isSyntheticText("  line one   line two  ", hashes), true);
  assert.equal(normalizeSyntheticText(" a\n b "), "a b");
});
