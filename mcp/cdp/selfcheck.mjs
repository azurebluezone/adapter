#!/usr/bin/env node
/**
 * CDP MCP selfcheck.
 *
 * Speaks the real stdio handshake, asserts the 12-tool surface, and proves the
 * status tool is honest: it either reports a live local endpoint or an explicit
 * CDP_NOT_RUNNING / CDP_UNAVAILABLE with the editor-browser fallback. It never
 * launches a browser itself.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../shared/client.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
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

const client = await startServer(path.join(HERE, "server.mjs"), { timeoutMs: 30_000 });
try {
  const init = await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "cdp-selfcheck", version: "1" },
  });
  assert.equal(init.serverInfo?.name, "cdp", "unexpected serverInfo name");

  const listed = await client.request("tools/list", {});
  const names = (listed.tools ?? []).map((tool) => tool.name);
  assert.deepEqual([...names].sort(), [...EXPECTED].sort(), "tool surface drifted");
  for (const tool of listed.tools) {
    assert.equal(tool.inputSchema?.type, "object", `${tool.name} has no object schema`);
    assert.ok(String(tool.description ?? "").length > 40, `${tool.name} lacks a usable description`);
  }

  const status = await client.callTool("status", {});
  assert.equal(typeof status.running, "boolean", "status.running must be a boolean");
  if (status.running) {
    assert.match(status.endpoint, /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/, "non-local endpoint");
    assert.ok(status.browser, "running status must name the browser");
  } else {
    assert.ok(
      ["CDP_NOT_RUNNING", "CDP_UNAVAILABLE"].includes(status.code),
      `unexpected status code ${status.code}`,
    );
    assert.equal(status.editor_fallback, "browser", "missing editor fallback marker");
    assert.ok(
      String(status.hint ?? "").includes("browser") || String(status.hint ?? "").includes("launch"),
      "status hint must name cdp_launch or the editor browser",
    );
  }

  assert.deepEqual(await client.request("ping", {}), {}, "server did not stay alive after tools/call");

  console.log(
    `ZC_CDP_SELFCHECK_OK — ${names.length} tools, status ${
      status.running ? `running@${status.endpoint}` : status.code
    }`,
  );
} finally {
  await client.close();
}
