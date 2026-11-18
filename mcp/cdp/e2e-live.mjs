#!/usr/bin/env node
/**
 * Live CDP proof.
 *
 * Launches the real Chromium that browser discovery finds (here: Playwright's
 * bundled build), serves a local fixture, and proves every payload comes from
 * the browser backend: DOM attributes, markers, console, network 404, a real
 * 900x640 PNG screenshot, a click that changes document.title, and eval.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../shared/client.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zc-cdp-live-"));

const HTML = `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="description" content="ZC CDP fixture">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZC CDP Fixture</title>
</head>
<body>
  <header role="banner"><h1>CDP Fixture</h1></header>
  <nav aria-label="Primary"><a href="#main">Skip to main</a> <a href="#">Empty link</a></nav>
  <main id="main" data-testid="fixture-main">
    <h2>Markers</h2>
    <p id="dup">duplicate one</p>
    <p id="dup">duplicate two</p>
    <img src="/pixel.png" width="8" height="8">
    <button id="clickme">Click me</button>
    <button></button>
    <input id="unlabeled" name="unlabeled">
    <div data-role="probe" aria-label="Probe zone">probe</div>
  </main>
  <footer role="contentinfo">done</footer>
  <script>
    console.log("hello from fixture");
    console.error("fixture error line");
    document.getElementById("clickme").addEventListener("click", () => {
      document.title = "ZC CDP Clicked";
      document.body.dataset.clicked = "1";
    });
    fetch("/missing").catch(() => {});
  </script>
</body>
</html>`;

const site = http.createServer((req, res) => {
  if (req.url === "/missing") {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("missing");
    return;
  }
  if (req.url === "/pixel.png") {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(HTML);
});
await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${site.address().port}`;

const client = await startServer(path.join(HERE, "server.mjs"), { timeoutMs: 180_000 });
try {
  const init = await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "cdp-e2e-live", version: "1" },
  });
  assert.equal(init.serverInfo?.name, "cdp");

  const launched = await client.callTool("launch", {});
  assert.equal(launched.ok, true, "launch failed");
  assert.match(launched.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/, "endpoint is not local");
  assert.ok(launched.browser, "no browser version");
  assert.ok(fs.existsSync(launched.binary), `binary missing: ${launched.binary}`);
  assert.ok(launched.pid > 0, "no pid");

  const status = await client.callTool("status", {});
  assert.equal(status.running, true, "status did not see the launched browser");

  const nav = await client.callTool("navigate", { url: `${origin}/`, width: 1000, height: 700 });
  assert.equal(nav.ok, true);
  assert.equal(nav.page.title, "ZC CDP Fixture");
  assert.equal(nav.page.readyState, "complete");
  assert.ok(nav.page.url.startsWith(origin), nav.page.url);

  const dom = await client.callTool("dom", { selector: "#main", mode: "attributes" });
  assert.equal(dom.found, true);
  assert.equal(dom.attributes["data-testid"], "fixture-main");

  const markers = await client.callTool("markers", { limit: 500 });
  assert.ok(markers.headings.length >= 2, "headings missing");
  assert.ok(markers.landmarks.length >= 4, "landmarks missing");
  assert.ok(
    markers.markers.some((marker) => marker.attrs?.["data-testid"] === "fixture-main"),
    "data-* marker missing",
  );
  assert.ok(markers.images.missingAlt.length >= 1, "missing-alt image not reported");
  assert.ok(markers.controls.unnamed.length >= 1, "unnamed button not reported");
  assert.ok(markers.forms.withoutLabel.length >= 1, "unlabeled input not reported");
  assert.ok(markers.duplicateIds.some((entry) => entry.id === "dup"), "duplicate id not reported");
  assert.ok(markers.links.empty.length >= 1, "empty link not reported");

  const audit = await client.callTool("audit", { url: `${origin}/`, wait_ms: 800, limit: 500 });
  assert.equal(audit.ok, true);
  const consoleText = audit.console.map((entry) => entry.text).join("\n");
  assert.match(consoleText, /hello from fixture/, "console.log not captured");
  assert.match(consoleText, /fixture error line/, "console.error not captured");
  assert.ok(
    audit.network.http_errors.some((entry) => entry.status === 404 && entry.url.endsWith("/missing")),
    "404 for /missing not captured",
  );

  const shot = await client.callTool("screenshot", {
    width: 900,
    height: 640,
    output: path.join(dir, "shot.png"),
  });
  assert.equal(shot.ok, true);
  assert.ok(fs.existsSync(shot.file), "screenshot file missing");
  const bytes = fs.readFileSync(shot.file);
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", "not a PNG");
  assert.equal(bytes.readUInt32BE(16), 900, "real PNG width");
  assert.equal(bytes.readUInt32BE(20), 640, "real PNG height");

  const act = await client.callTool("act", { selector: "#clickme", action: "click" });
  assert.equal(act.ok, true, "click failed");
  const title = await client.callTool("eval", { expression: "document.title" });
  assert.equal(title.value, "ZC CDP Clicked", "click did not change the page");

  const missingAct = await client.callTool("act", { selector: "#does-not-exist", action: "click" });
  assert.equal(missingAct.ok, false, "missing selector must not pretend success");

  const targets = await client.callTool("targets", {});
  assert.ok(
    targets.targets.some((target) => target.url.startsWith(origin)),
    "page target missing from /json/list",
  );

  console.log(
    `ZC_CDP_LIVE_OK — ${launched.browser}; dom+markers+console+network+900x640 png+click+eval`,
  );
} finally {
  await client.close();
  await new Promise((resolve) => site.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}
