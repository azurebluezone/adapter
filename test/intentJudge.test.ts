import test from "node:test";
import assert from "node:assert/strict";
import { mutationInScope, parseScope } from "../src/zombie/intentJudge.ts";

test("parseScope keeps an absolute path with spaces whole", () => {
  assert.deepEqual(parseScope("/home/u/Default Project, src/plugin.ts"), [
    "home/u/Default Project",
    "src/plugin.ts",
  ]);
});

test("parseScope still splits space-separated relative prefixes", () => {
  assert.deepEqual(parseScope("src/agents src/zombie"), ["src/agents", "src/zombie"]);
});

test("a relative target is anchored to the project root before comparison", () => {
  assert.equal(
    mutationInScope("/home/u/Default Project/src", "edit", "src/plugin.ts", "/home/u/Default Project"),
    true,
  );
  assert.equal(
    mutationInScope("/home/u/Default Project/src", "edit", "test/plugin.test.ts", "/home/u/Default Project"),
    false,
  );
});

test("read-only tools stay allowed and an unresolved shell write is blocked", () => {
  assert.equal(mutationInScope("src/agents", "read", "test/plugin.test.ts", "/home/u/project"), true);
  assert.equal(mutationInScope("src/agents", "shell", "", "/home/u/project"), false);
});
