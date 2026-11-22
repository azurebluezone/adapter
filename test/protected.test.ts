import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import {
  isInsidePath,
  protectedRoots,
  protectedWriteTarget,
  resolveSessionPath,
} from "../src/zombie/protectedRoots.ts";

const INSTALL = "/home/user/.opencode";
const SOURCE = "/home/user/adapter";
const PROJECT = "/home/user/work/app";
const options = { installRoot: INSTALL, sourceRoot: SOURCE };

test("a session outside the plugin root cannot write into it", () => {
  assert.match(
    protectedWriteTarget([`${SOURCE}/src/plugin.ts`], "", PROJECT, options) ?? "",
    /read-only/,
  );
  assert.match(
    protectedWriteTarget([`${INSTALL}/opencode.json`], "", PROJECT, options) ?? "",
    /read-only/,
  );
});

test("a session inside the plugin root may edit it", () => {
  assert.equal(protectedWriteTarget([`${SOURCE}/src/plugin.ts`], "", SOURCE, options), null);
  assert.equal(protectedWriteTarget([`${INSTALL}/opencode.json`], "", INSTALL, options), null);
  assert.equal(protectedWriteTarget([`${SOURCE}/src/plugin.ts`], "", `${SOURCE}/docs`, options), null);
});

test("unrelated project writes stay allowed", () => {
  assert.equal(protectedWriteTarget([`${PROJECT}/src/app.ts`], "", PROJECT, options), null);
  assert.equal(protectedWriteTarget([], "", PROJECT, options), null);
});

test("a mutating shell that reaches the plugin root is blocked", () => {
  assert.match(
    protectedWriteTarget([], `cd ${SOURCE} && rm -rf src`, PROJECT, options) ?? "",
    /read-only/,
  );
  assert.match(
    protectedWriteTarget([], `node ${SOURCE}/bin/install.mjs --yes`, PROJECT, options) ?? "",
    /read-only/,
  );
  assert.match(
    protectedWriteTarget([], `cp ${PROJECT}/x ${INSTALL}/x`, PROJECT, options) ?? "",
    /read-only/,
  );
});

test("a sibling path that only shares the protected root prefix stays allowed", () => {
  assert.equal(protectedWriteTarget([`${SOURCE}-other/src/a.ts`], "", PROJECT, options), null);
  assert.equal(protectedWriteTarget([], `cp ${PROJECT}/x ${SOURCE}-other/x`, PROJECT, options), null);
  assert.equal(protectedWriteTarget([], `cp ${PROJECT}/x ${INSTALL}-backup/x`, PROJECT, options), null);
});

test("relative and home paths resolve before the boundary check", () => {
  assert.equal(resolveSessionPath("./src/a.ts", PROJECT), `${PROJECT}/src/a.ts`);
  assert.equal(resolveSessionPath("~/adapter/src/a.ts", PROJECT), path.join(os.homedir(), "adapter", "src", "a.ts"));
  assert.equal(resolveSessionPath("https://example.test/a.ts", PROJECT), null);
  assert.equal(isInsidePath(`${SOURCE}/src`, SOURCE), true);
  assert.equal(isInsidePath("/home/user/adapter-other", SOURCE), false);
});

test("protected roots never include a filesystem root", () => {
  assert.deepEqual(protectedRoots({ installRoot: "/", sourceRoot: "/" }), []);
  assert.deepEqual(protectedRoots({ installRoot: INSTALL, sourceRoot: "" }), [INSTALL]);
});
