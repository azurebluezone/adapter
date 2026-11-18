import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TOOLS,
  discoverBrowser,
  handleRpc,
  isLocalEndpoint,
  normalizeEndpoint,
  parseDevToolsActivePort,
  pngSize,
} from "../server.mjs";

const EXPECTED = [
  "status",
  "launch",
  "targets",
  "navigate",
  "dom",
  "markers",
  "audit",
  "screenshot",
  "console",
  "network",
  "act",
  "eval",
];

test("server exposes twelve unique tools with object schemas", () => {
  assert.deepEqual(TOOLS.map((tool) => tool.name), EXPECTED);
  assert.equal(new Set(TOOLS.map((tool) => tool.name)).size, TOOLS.length);
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.type, "object", `${tool.name} schema`);
    assert.ok(tool.description.length > 40, `${tool.name} description`);
  }
});

test("only local CDP endpoints are accepted", () => {
  for (const ok of [
    "http://127.0.0.1:9222",
    "http://localhost:9222",
    "http://[::1]:9222",
    "https://127.0.0.1:9443",
    "http://0.0.0.0:9222",
  ]) {
    assert.equal(isLocalEndpoint(ok), true, ok);
  }
  for (const bad of [
    "http://example.com:9222",
    "http://10.0.0.5:9222",
    "ftp://127.0.0.1:9222",
    "not a url",
    "",
  ]) {
    assert.equal(isLocalEndpoint(bad), false, bad);
  }
});

test("normalizeEndpoint adds a scheme, strips the path, and refuses remote hosts", () => {
  assert.equal(normalizeEndpoint("127.0.0.1:9222"), "http://127.0.0.1:9222");
  assert.equal(normalizeEndpoint("http://localhost:9222/json/version"), "http://localhost:9222");
  assert.equal(normalizeEndpoint("  "), "");
  assert.throws(() => normalizeEndpoint("http://example.com:9222"), /non-local CDP endpoint/);
  assert.throws(() => normalizeEndpoint("not a url"), /Invalid CDP endpoint/);
});

test("DevToolsActivePort is parsed strictly", () => {
  const parsed = parseDevToolsActivePort("9222\n/devtools/browser/abc-123\n");
  assert.deepEqual(parsed, {
    port: 9222,
    path: "/devtools/browser/abc-123",
    endpoint: "http://127.0.0.1:9222",
  });
  assert.equal(parseDevToolsActivePort("abc\n/devtools/browser/x\n"), null);
  assert.equal(parseDevToolsActivePort("0\n"), null);
  assert.equal(parseDevToolsActivePort(""), null);
});

test("pngSize reads real IHDR dimensions and rejects other bytes", () => {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(900, 16);
  header.writeUInt32BE(640, 20);
  assert.deepEqual(pngSize(header), { width: 900, height: 640 });

  assert.equal(pngSize(Buffer.from("GIF89a")), null);
  assert.equal(pngSize(Buffer.alloc(8)), null);
  assert.equal(pngSize(null), null);
});

test("browser discovery accepts real executables and rejects shell wrappers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-discover-"));
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-home-"));
  try {
    const script = path.join(dir, "chromium");
    fs.writeFileSync(script, "#!/bin/sh\nexit 1\n");
    fs.chmodSync(script, 0o755);
    const rejected = discoverBrowser({ env: { PATH: dir, HOME: emptyHome } });
    assert.notEqual(rejected, script, "a shell wrapper must not be treated as a browser");

    const binary = path.join(dir, "google-chrome");
    fs.copyFileSync(process.execPath, binary);
    fs.chmodSync(binary, 0o755);
    const found = discoverBrowser({ env: { PATH: dir, HOME: emptyHome } });
    assert.equal(found, binary, "a real executable should win over the hardcoded fallbacks");

    const missing = discoverBrowser({ env: { PATH: dir, HOME: emptyHome, CDP_BROWSER_PATH: path.join(dir, "nope") } });
    assert.ok(missing === null || missing !== path.join(dir, "nope"), "CDP_BROWSER_PATH must be a real binary");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});

test("rpc rejects unknown tools and invalid arguments without a browser launch", async () => {
  const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(init.result.serverInfo.name, "cdp");

  const unknown = await handleRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "nope", arguments: {} },
  });
  assert.equal(unknown.result.isError, true);
  assert.match(unknown.result.content[0].text, /unknown tool/);

  const badUrl = await handleRpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "navigate", arguments: { url: "ftp://example.com" } },
  });
  assert.equal(badUrl.result.isError, true);
  assert.match(badUrl.result.content[0].text, /CDP_URL/);

  const badEval = await handleRpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "eval", arguments: {} },
  });
  assert.equal(badEval.result.isError, true);
  assert.match(badEval.result.content[0].text, /CDP_EVAL/);

  const missing = await handleRpc({ jsonrpc: "2.0", id: 5, method: "nope/method", params: {} });
  assert.equal(missing.error.code, -32601);
});
