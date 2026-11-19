import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnvironmentFile, writeAtomic } from "../src/zombie/io.ts";

test("writeAtomic writes through a symlink instead of replacing it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-io-"));
  try {
    const target = path.join(dir, "real.json");
    const link = path.join(dir, "opencode.json");
    fs.writeFileSync(target, "{}\n");
    fs.symlinkSync(target, link);
    writeAtomic(link, '{"mcp":{"servers":{"cdp":{}}}}\n');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, "the config link must survive");
    assert.equal(fs.realpathSync(link), fs.realpathSync(target));
    assert.match(fs.readFileSync(target, "utf8"), /"cdp"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseEnvironmentFile reads dotenv-style assignments without evaluation", () => {
  assert.deepEqual(
    parseEnvironmentFile(
      [
        "# comment",
        "export EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL='https://gateway.example/v1'",
        "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY='provider-secret'",
        "EXTERNAL_MCP_URL=https://mcp.example/mcp",
        "EMPTY=",
        "QUOTED=\"value # kept\"",
        "UNQUOTED=value # comment",
        "not an assignment",
      ].join("\n"),
    ),
    {
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: "https://gateway.example/v1",
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY: "provider-secret",
      EXTERNAL_MCP_URL: "https://mcp.example/mcp",
      EMPTY: "",
      QUOTED: "value # kept",
      UNQUOTED: "value",
    },
  );
});
