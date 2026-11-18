#!/usr/bin/env node
/**
 * cdp MCP server (stdio, zero npm dependencies).
 *
 * Speaks the Chrome DevTools Protocol directly over WebSocket. It attaches to a
 * running Chromium when one is reachable, otherwise it launches a discovered
 * Chromium (system binary or Playwright's bundled build) with a temporary
 * profile. A missing browser is reported as CDP_UNAVAILABLE with the editor
 * browser fallback; it never pretends a page was loaded.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

export const VERSION = "0.1.0";
const DEFAULT_ENDPOINT = "http://127.0.0.1:9222";
const MAX_TEXT = 200_000;
const SESSION_TIMEOUT_MS = 15_000;
const LAUNCH_TIMEOUT_MS = 20_000;

const state = {
  endpoint: null,
  proc: null,
  profileDir: null,
  binary: null,
  targetId: null,
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cdpError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function failure(error, hint) {
  const code = error?.code ?? "CDP_ERROR";
  return {
    ok: false,
    code,
    message: String(error?.message ?? error),
    ...(hint ?? error?.hint ? { hint: hint ?? error?.hint } : {}),
    ...(error?.editorFallback ? { editor_fallback: error.editorFallback } : {}),
  };
}

export function isLocalEndpoint(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return ["127.0.0.1", "localhost", "[::1]", "::1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function normalizeEndpoint(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!isLocalEndpoint(url.href)) {
      throw cdpError("CDP_ENDPOINT", `Refusing non-local CDP endpoint: ${raw}`);
    }
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    if (error?.code === "CDP_ENDPOINT") throw error;
    throw cdpError("CDP_ENDPOINT", `Invalid CDP endpoint: ${raw}`);
  }
}

export function parseDevToolsActivePort(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port <= 0) return null;
  return { port, path: lines[1] || "", endpoint: `http://127.0.0.1:${port}` };
}

export function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function isExecutable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// A shell wrapper such as Ubuntu's chromium snap stub is executable but cannot
// be used as a browser binary. Accept real ELF / Mach-O / PE executables only.
function isRealBinary(file) {
  if (!isExecutable(file)) return false;
  try {
    const head = Buffer.alloc(4);
    const fd = fs.openSync(file, "r");
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    if (head.toString("binary") === "\x7fELF") return true;
    if (head.readUInt32BE(0) === 0xfeedface || head.readUInt32BE(0) === 0xfeedfacf) return true;
    if (head.readUInt32LE(0) === 0xfeedface || head.readUInt32LE(0) === 0xfeedfacf) return true;
    if (head.toString("binary").startsWith("MZ")) return true;
    return false;
  } catch {
    return false;
  }
}

function playwrightRoots(env) {
  const roots = [];
  if (env.PLAYWRIGHT_BROWSERS_PATH) roots.push(env.PLAYWRIGHT_BROWSERS_PATH);
  if (env.HOME) {
    roots.push(path.join(env.HOME, ".cache", "ms-playwright"));
    roots.push(path.join(env.HOME, "Library", "Caches", "ms-playwright"));
  }
  if (env.LOCALAPPDATA) roots.push(path.join(env.LOCALAPPDATA, "ms-playwright"));
  return roots;
}

function playwrightCandidates(env) {
  const candidates = [];
  for (const root of playwrightRoots(env)) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const dirs = entries
      .filter((entry) => entry.isDirectory() && /^chromium(?:[_-]|$)/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const name of dirs) {
      const base = path.join(root, name);
      candidates.push(
        path.join(base, "chrome-linux64", "chrome"),
        path.join(base, "chrome-linux", "chrome"),
        path.join(base, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(base, "chrome-win", "chrome.exe"),
      );
      if (name.includes("headless")) {
        candidates.push(
          path.join(base, "chrome-headless-shell-linux64", "chrome-headless-shell"),
          path.join(base, "chrome-headless-shell-mac", "chrome-headless-shell"),
          path.join(base, "chrome-headless-shell-win", "chrome-headless-shell.exe"),
        );
      }
    }
  }
  return candidates;
}

export function discoverBrowser(options = {}) {
  const env = options.env ?? process.env;
  const candidates = [];
  if (env.CDP_BROWSER_PATH) candidates.push(env.CDP_BROWSER_PATH);
  for (const dir of String(env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of ["chromium", "google-chrome", "google-chrome-stable", "chrome"]) {
      candidates.push(path.join(dir, name));
    }
  }
  candidates.push(
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
  );
  candidates.push(...playwrightCandidates(env));
  return candidates.find((candidate) => isRealBinary(candidate)) ?? null;
}

async function httpJson(url, { method = "GET", timeoutMs = 3000 } = {}) {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { text };
  }
  if (!response.ok) {
    throw cdpError("CDP_HTTP", `${method} ${url} -> ${response.status}`, { body });
  }
  return body;
}

async function versionAt(endpoint) {
  try {
    const info = await httpJson(`${endpoint}/json/version`, { timeoutMs: 2000 });
    if (!info?.webSocketDebuggerUrl) return null;
    return info;
  } catch {
    return null;
  }
}

export async function status() {
  const candidates = [];
  if (state.endpoint) candidates.push(state.endpoint);
  if (process.env.CDP_ENDPOINT) candidates.push(normalizeEndpoint(process.env.CDP_ENDPOINT));
  candidates.push(DEFAULT_ENDPOINT);
  for (const endpoint of [...new Set(candidates)]) {
    const info = await versionAt(endpoint);
    if (info) {
      state.endpoint = endpoint;
      return {
        ok: true,
        running: true,
        endpoint,
        browser: info.Browser ?? null,
        protocol: info["Protocol-Version"] ?? null,
        webSocketDebuggerUrl: info.webSocketDebuggerUrl,
      };
    }
  }
  const binary = discoverBrowser();
  return {
    ok: false,
    running: false,
    code: binary ? "CDP_NOT_RUNNING" : "CDP_UNAVAILABLE",
    message: binary
      ? "No Chromium answered on the CDP endpoint."
      : "No usable Chromium binary was found on this machine.",
    launchable: binary,
    hint: binary
      ? "Call cdp_launch to start it with a temporary profile."
      : "Use the editor's browser tools (browser) instead of CDP on this machine.",
    editor_fallback: "browser",
  };
}

export async function launch() {
  if (state.endpoint) {
    const info = await versionAt(state.endpoint);
    if (info) return { ok: true, running: true, endpoint: state.endpoint, browser: info.Browser ?? null, reused: true };
  }
  if (state.proc && state.proc.exitCode === null && state.endpoint) {
    const info = await versionAt(state.endpoint);
    if (info) return { ok: true, running: true, endpoint: state.endpoint, browser: info.Browser ?? null, reused: true };
  }
  const binary = discoverBrowser();
  if (!binary) {
    throw cdpError("CDP_UNAVAILABLE", "No usable Chromium binary was found on this machine.", {
      hint: "Use the editor's browser tools (browser) instead of CDP on this machine.",
      editorFallback: "browser",
    });
  }
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "zombie-cdp-"));
  const headlessShell = /headless[_-]shell/i.test(binary);
  const args = [
    ...(headlessShell ? [] : ["--headless=new"]),
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ];
  let stderr = "";
  const proc = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
  proc.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const portFile = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let parsed = null;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw cdpError("CDP_LAUNCH", `Chromium exited with code ${proc.exitCode}.`, {
        hint: stderr.trim() || "Check the browser binary and its sandbox flags.",
      });
    }
    if (fs.existsSync(portFile)) {
      parsed = parseDevToolsActivePort(fs.readFileSync(portFile, "utf8"));
      if (parsed) break;
    }
    await sleep(100);
  }
  if (!parsed) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    fs.rmSync(profileDir, { recursive: true, force: true });
    throw cdpError("CDP_LAUNCH", `Chromium did not publish a DevTools port within ${LAUNCH_TIMEOUT_MS} ms.`, {
      hint: stderr.trim() || "Run the binary manually with --headless=new --remote-debugging-port=0.",
    });
  }
  const info = await versionAt(parsed.endpoint);
  if (!info) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    fs.rmSync(profileDir, { recursive: true, force: true });
    throw cdpError("CDP_LAUNCH", "Chromium opened a port but did not answer /json/version.");
  }
  state.endpoint = parsed.endpoint;
  state.proc = proc;
  state.profileDir = profileDir;
  state.binary = binary;
  state.targetId = null;
  return {
    ok: true,
    running: true,
    launched: true,
    endpoint: parsed.endpoint,
    browser: info.Browser ?? null,
    protocol: info["Protocol-Version"] ?? null,
    binary,
    pid: proc.pid,
    profile: profileDir,
  };
}

async function ensureBrowser() {
  const current = await status();
  if (current.ok) return current;
  return launch();
}

export function cleanup() {
  if (state.proc && state.proc.exitCode === null) {
    try {
      state.proc.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      try {
        if (state.proc && state.proc.exitCode === null) state.proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 1500).unref?.();
  }
  if (state.profileDir) {
    try {
      fs.rmSync(state.profileDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    state.profileDir = null;
  }
}

// ---------------------------------------------------------------------------
// CDP WebSocket session
// ---------------------------------------------------------------------------

function connect(wsUrl, timeoutMs = SESSION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const handlers = new Map();
    let opened = false;
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(cdpError("CDP_TIMEOUT", `WebSocket did not open within ${timeoutMs} ms`));
    }, timeoutMs);

    const session = {
      send(method, params = {}) {
        const id = nextId++;
        return new Promise((resolveSend, rejectSend) => {
          pending.set(id, { resolve: resolveSend, reject: rejectSend });
          try {
            ws.send(JSON.stringify({ id, method, params }));
          } catch (error) {
            pending.delete(id);
            rejectSend(error);
          }
        });
      },
      on(method, handler) {
        const list = handlers.get(method) ?? [];
        list.push(handler);
        handlers.set(method, list);
      },
      waitFor(method, waitMs = SESSION_TIMEOUT_MS) {
        return new Promise((resolveWait, rejectWait) => {
          const waitTimer = setTimeout(() => rejectWait(cdpError("CDP_TIMEOUT", `${method} did not fire`)), waitMs);
          const handler = (params) => {
            clearTimeout(waitTimer);
            resolveWait(params);
          };
          session.once(method, handler);
        });
      },
      once(method, handler) {
        const list = handlers.get(method) ?? [];
        const wrapped = (params) => {
          handlers.set(
            method,
            (handlers.get(method) ?? []).filter((entry) => entry !== wrapped),
          );
          handler(params);
        };
        list.push(wrapped);
        handlers.set(method, list);
      },
      close() {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      },
    };

    ws.onopen = () => {
      opened = true;
      clearTimeout(timer);
      resolve(session);
    };
    ws.onerror = () => {
      if (!opened) {
        clearTimeout(timer);
        reject(cdpError("CDP_SOCKET", "WebSocket connection failed"));
      }
    };
    ws.onclose = () => {
      for (const { reject: rejectPending } of pending.values()) {
        rejectPending(cdpError("CDP_SOCKET", "CDP socket closed"));
      }
      pending.clear();
    };
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) {
          waiter.reject(cdpError("CDP_COMMAND", message.error.message || JSON.stringify(message.error)));
        } else {
          waiter.resolve(message.result);
        }
        return;
      }
      for (const handler of handlers.get(message.method) ?? []) {
        try {
          handler(message.params ?? {});
        } catch {
          /* a listener must not kill the session */
        }
      }
    };
  });
}

async function pageTargets(endpoint) {
  const list = await httpJson(`${endpoint}/json/list`);
  return (Array.isArray(list) ? list : [])
    .filter((target) => target?.type === "page" && target.webSocketDebuggerUrl)
    .map((target) => ({
      id: target.id,
      title: target.title,
      url: target.url,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    }));
}

async function createTarget(endpoint, url) {
  try {
    return await httpJson(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  } catch {
    try {
      return await httpJson(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "GET" });
    } catch {
      return null;
    }
  }
}

async function attachTarget(options = {}) {
  const browser = await ensureBrowser();
  const endpoint = browser.endpoint;
  const targets = await pageTargets(endpoint);
  let target = null;
  if (options.target_id) {
    target = targets.find((entry) => entry.id === options.target_id) ?? null;
    if (!target) {
      throw cdpError("CDP_TARGET", `No page target with id ${options.target_id}`);
    }
  } else if (state.targetId) {
    target = targets.find((entry) => entry.id === state.targetId) ?? null;
  }
  if (!target) target = targets[0] ?? null;
  if (!target) {
    const created = await createTarget(endpoint, "about:blank");
    if (!created?.webSocketDebuggerUrl) {
      throw cdpError("CDP_TARGET", "Could not create a page target.");
    }
    target = created;
  }
  state.targetId = target.id;
  const session = await connect(target.webSocketDebuggerUrl);
  return { endpoint, target, session, launched: Boolean(browser.launched) };
}

function validUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw cdpError("CDP_URL", "url is required");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw cdpError("CDP_URL", `Invalid URL: ${raw}`);
  }
  if (!["http:", "https:", "file:", "about:", "data:"].includes(url.protocol)) {
    throw cdpError("CDP_URL", `Refusing URL protocol ${url.protocol}`);
  }
  return url.href;
}

async function evaluate(session, expression, options = {}) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: options.awaitPromise !== false,
    returnByValue: true,
    userGesture: true,
  });
  if (result?.exceptionDetails) {
    const detail = result.exceptionDetails;
    throw cdpError(
      "CDP_EVALUATION",
      detail.exception?.description || detail.text || "Page evaluation failed",
    );
  }
  return result?.result?.value;
}

async function pageInfo(session) {
  return evaluate(session, `({ url: location.href, title: document.title, readyState: document.readyState })`);
}

async function navigateSession(session, url, options = {}) {
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  const width = Number(options.width) || 0;
  const height = Number(options.height) || 0;
  if (width > 0 && height > 0) {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  const loaded = session.waitFor("Page.loadEventFired", options.timeout_ms ?? 20_000);
  const result = await session.send("Page.navigate", { url });
  if (result?.errorText) {
    throw cdpError("CDP_NAVIGATION", result.errorText);
  }
  await loaded.catch(() => null);
  await sleep(Number(options.wait_ms ?? 250));
  return pageInfo(session);
}

// ---------------------------------------------------------------------------
// page probes
// ---------------------------------------------------------------------------

function markerExpression(limit = 300) {
  return `(() => {
    const max = ${Math.max(1, Math.min(1000, Number(limit) || 300))};
    const clean = (value) => String(value ?? "").trim().replace(/\\s+/g, " ").slice(0, 200);
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    };
    const nameOf = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria && aria.trim()) return clean(aria);
      const labelledby = el.getAttribute("aria-labelledby");
      if (labelledby) {
        const text = labelledby.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
        if (clean(text)) return clean(text);
      }
      const text = el.innerText || el.textContent || "";
      if (clean(text)) return clean(text);
      const title = el.getAttribute("title");
      if (title && title.trim()) return clean(title);
      if (el.tagName === "IMG") return clean(el.getAttribute("alt"));
      if (el.tagName === "INPUT" && ["submit", "button", "reset"].includes(el.type)) return clean(el.value);
      const id = el.getAttribute("id");
      if (id) {
        const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
        if (label) return clean(label.innerText);
      }
      const wrapper = el.closest("label");
      if (wrapper) return clean(wrapper.innerText);
      return "";
    };
    const hasLabel = (el) => {
      if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return true;
      const id = el.getAttribute("id");
      if (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) return true;
      return Boolean(el.closest("label"));
    };
    const markers = [];
    const elements = Array.from(document.querySelectorAll("body *"));
    for (const el of elements) {
      if (markers.length >= max) break;
      const attrs = {};
      for (const attribute of el.attributes) {
        if (
          attribute.name.startsWith("data-") ||
          attribute.name.startsWith("aria-") ||
          ["id", "role", "name", "itemprop", "for", "href"].includes(attribute.name)
        ) {
          attrs[attribute.name] = clean(attribute.value);
        }
      }
      if (Object.keys(attrs).length === 0) continue;
      markers.push({
        tag: el.tagName.toLowerCase(),
        text: clean(el.innerText || el.textContent).slice(0, 80),
        visible: visible(el),
        attrs,
      });
    }
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((el) => ({
      level: Number(el.tagName[1]),
      text: clean(el.innerText),
      id: el.id || null,
    }));
    const landmarks = Array.from(
      document.querySelectorAll(
        "header,nav,main,footer,aside,[role=banner],[role=navigation],[role=main],[role=contentinfo],[role=complementary],[role=search]",
      ),
    ).map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      label: el.getAttribute("aria-label"),
      id: el.id || null,
    }));
    const images = Array.from(document.querySelectorAll("img"));
    const controls = Array.from(
      document.querySelectorAll("button,a[href],input,select,textarea,[role=button],[role=link]"),
    );
    const ids = new Map();
    for (const el of document.querySelectorAll("[id]")) {
      const id = el.id;
      ids.set(id, (ids.get(id) || 0) + 1);
    }
    const duplicateIds = Array.from(ids.entries())
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count }))
      .slice(0, max);
    const fields = Array.from(document.querySelectorAll("input:not([type=hidden]),select,textarea"));
    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang || null,
      dir: document.documentElement.dir || null,
      meta: {
        description: document.querySelector('meta[name="description"]')?.content || null,
        viewport: document.querySelector('meta[name="viewport"]')?.content || null,
        canonical: document.querySelector('link[rel="canonical"]')?.href || null,
        ogTitle: document.querySelector('meta[property="og:title"]')?.content || null,
      },
      headings,
      landmarks,
      markers,
      images: {
        total: images.length,
        missingAlt: images
          .filter((img) => !img.hasAttribute("alt"))
          .map((img) => ({ src: img.currentSrc || img.src, selector: img.id ? "#" + img.id : null }))
          .slice(0, max),
        emptyAlt: images.filter((img) => img.hasAttribute("alt") && !img.getAttribute("alt").trim()).length,
      },
      controls: {
        total: controls.length,
        unnamed: controls
          .filter((el) => !nameOf(el))
          .map((el) => ({ tag: el.tagName.toLowerCase(), id: el.id || null, type: el.getAttribute("type") }))
          .slice(0, max),
      },
      links: {
        total: document.querySelectorAll("a").length,
        empty: Array.from(document.querySelectorAll("a"))
          .filter((a) => !a.getAttribute("href") || a.getAttribute("href") === "#")
          .map((a) => ({ text: clean(a.innerText), id: a.id || null }))
          .slice(0, max),
      },
      forms: {
        fields: fields.length,
        withoutLabel: fields
          .filter((el) => !hasLabel(el))
          .map((el) => ({ tag: el.tagName.toLowerCase(), id: el.id || null, name: el.getAttribute("name") }))
          .slice(0, max),
      },
      duplicateIds,
      counts: {
        elements: elements.length,
        headings: headings.length,
        landmarks: landmarks.length,
        markers: markers.length,
      },
    };
  })()`;
}

async function collectSignals(session, options = {}) {
  const consoleEvents = [];
  const exceptionEvents = [];
  const responses = [];
  const failures = [];
  const requests = new Map();
  await session.send("Runtime.enable");
  await session.send("Log.enable").catch(() => null);
  await session.send("Network.enable");
  await session.send("Page.enable");
  session.on("Runtime.consoleAPICalled", (params) => {
    if (consoleEvents.length >= 200) return;
    consoleEvents.push({
      type: params.type,
      text: (params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? arg.type)
        .join(" ")
        .slice(0, 500),
      at: params.timestamp ?? null,
    });
  });
  session.on("Runtime.exceptionThrown", (params) => {
    if (exceptionEvents.length >= 100) return;
    const detail = params.exceptionDetails ?? {};
    exceptionEvents.push({
      text: detail.exception?.description || detail.text || "exception",
      url: detail.url ?? null,
      line: detail.lineNumber ?? null,
      column: detail.columnNumber ?? null,
    });
  });
  session.on("Log.entryAdded", (params) => {
    const entry = params.entry ?? {};
    if (entry.level === "error" && consoleEvents.length < 200) {
      consoleEvents.push({ type: "log", text: String(entry.text ?? "").slice(0, 500), url: entry.url ?? null });
    }
  });
  session.on("Network.requestWillBeSent", (params) => {
    requests.set(params.requestId, params.request?.url ?? null);
  });
  session.on("Network.responseReceived", (params) => {
    if (responses.length >= 200) return;
    const response = params.response ?? {};
    if (Number(response.status) >= 400) {
      responses.push({
        url: response.url,
        status: response.status,
        type: params.type ?? null,
      });
    }
  });
  session.on("Network.loadingFailed", (params) => {
    if (failures.length >= 200) return;
    failures.push({
      url: requests.get(params.requestId) ?? null,
      error: params.errorText ?? "failed",
      canceled: Boolean(params.canceled),
    });
  });

  if (options.navigate_url) {
    await navigateSession(session, options.navigate_url, {
      width: options.width,
      height: options.height,
      wait_ms: options.wait_ms,
    });
  } else if (options.reload !== false) {
    await session.send("Page.reload", { ignoreCache: false });
    await sleep(Number(options.wait_ms ?? 600));
  } else {
    await sleep(Number(options.wait_ms ?? 400));
  }

  return {
    console: consoleEvents,
    exceptions: exceptionEvents,
    network: {
      failed: failures,
      http_errors: responses,
      requests: requests.size,
    },
  };
}

function defaultShotPath(extension) {
  const dir = path.join(os.homedir(), ".local", "share", "zombie-cdp");
  return path.join(dir, `shot-${Date.now()}.${extension}`);
}

function writeShot(buffer, output, extension) {
  const target = path.resolve(String(output || defaultShotPath(extension)));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  return target;
}

async function screenshotSession(session, options = {}) {
  const width = Number(options.width) || 0;
  const height = Number(options.height) || 0;
  if (width > 0 && height > 0) {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  try {
    const format = options.format === "jpeg" || options.format === "jpg" ? "jpeg" : "png";
    const shot = await session.send("Page.captureScreenshot", {
      format,
      ...(format === "jpeg" ? { quality: Math.max(60, Math.min(100, Number(options.quality) || 90)) } : {}),
      captureBeyondViewport: Boolean(options.full_page),
    });
    if (!shot?.data) throw cdpError("CDP_SCREENSHOT", "Page.captureScreenshot returned no data");
    const buffer = Buffer.from(shot.data, "base64");
    const extension = format === "jpeg" ? "jpg" : "png";
    const file = writeShot(buffer, options.output, extension);
    return {
      ok: true,
      file,
      bytes: buffer.length,
      format,
      ...(format === "png" ? pngSize(buffer) : {}),
      width: width || null,
      height: height || null,
    };
  } finally {
    if (width > 0 && height > 0) {
      await session.send("Emulation.clearDeviceMetricsOverride").catch(() => null);
    }
  }
}

// ---------------------------------------------------------------------------
// tool implementations
// ---------------------------------------------------------------------------

async function toolStatus() {
  return status();
}

async function toolLaunch() {
  return launch();
}

async function toolTargets() {
  const current = await ensureBrowser();
  const targets = await pageTargets(current.endpoint);
  return { ok: true, endpoint: current.endpoint, launched: Boolean(current.launched), targets };
}

async function toolNavigate(args = {}) {
  const url = validUrl(args.url);
  const attached = await attachTarget(args);
  try {
    await attached.session.send("Runtime.enable");
    const page = await navigateSession(attached.session, url, args);
    return {
      ok: true,
      endpoint: attached.endpoint,
      target: attached.target.id,
      launched: attached.launched,
      page,
    };
  } finally {
    attached.session.close();
  }
}

async function toolDom(args = {}) {
  const attached = await attachTarget(args);
  try {
    const selector = String(args.selector ?? "").trim();
    const mode = String(args.mode ?? "outerHTML");
    const maxChars = Math.max(1, Math.min(MAX_TEXT, Number(args.max_chars) || 20_000));
    const result = await evaluate(
      attached.session,
      `(() => {
        const el = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.documentElement"};
        if (!el) return { found: false };
        const mode = ${JSON.stringify(mode)};
        if (mode === "attributes") {
          const attrs = {};
          for (const attribute of el.attributes) attrs[attribute.name] = attribute.value;
          return { found: true, tag: el.tagName.toLowerCase(), attributes: attrs };
        }
        const value = mode === "innerHTML" ? el.innerHTML : mode === "text" ? (el.innerText || el.textContent || "") : el.outerHTML;
        return { found: true, tag: el.tagName.toLowerCase(), length: value.length, value: value.slice(0, ${maxChars}) };
      })()`,
    );
    return { ok: true, target: attached.target.id, ...result };
  } finally {
    attached.session.close();
  }
}

async function toolMarkers(args = {}) {
  const attached = await attachTarget(args);
  try {
    const markers = await evaluate(attached.session, markerExpression(args.limit));
    return { ok: true, target: attached.target.id, ...markers };
  } finally {
    attached.session.close();
  }
}

async function toolAudit(args = {}) {
  const attached = await attachTarget(args);
  try {
    const url = args.url ? validUrl(args.url) : null;
    const signals = await collectSignals(attached.session, {
      navigate_url: url,
      reload: args.reload,
      width: args.width,
      height: args.height,
      wait_ms: args.wait_ms,
    });
    const markers = await evaluate(attached.session, markerExpression(args.limit));
    return {
      ok: true,
      endpoint: attached.endpoint,
      target: attached.target.id,
      launched: attached.launched,
      page: markers,
      ...signals,
    };
  } finally {
    attached.session.close();
  }
}

async function toolScreenshot(args = {}) {
  const attached = await attachTarget(args);
  try {
    return { ok: true, target: attached.target.id, ...(await screenshotSession(attached.session, args)) };
  } finally {
    attached.session.close();
  }
}

async function toolConsole(args = {}) {
  const attached = await attachTarget(args);
  try {
    const signals = await collectSignals(attached.session, {
      reload: args.reload,
      wait_ms: args.wait_ms,
    });
    return {
      ok: true,
      target: attached.target.id,
      console: signals.console,
      exceptions: signals.exceptions,
    };
  } finally {
    attached.session.close();
  }
}

async function toolNetwork(args = {}) {
  const attached = await attachTarget(args);
  try {
    const signals = await collectSignals(attached.session, {
      reload: args.reload,
      wait_ms: args.wait_ms,
    });
    return { ok: true, target: attached.target.id, network: signals.network };
  } finally {
    attached.session.close();
  }
}

async function toolAct(args = {}) {
  const selector = String(args.selector ?? "").trim();
  if (!selector) throw cdpError("CDP_SELECTOR", "selector is required");
  const action = String(args.action ?? "click");
  if (!["click", "focus", "fill"].includes(action)) {
    throw cdpError("CDP_ACTION", `Unsupported action ${action}`);
  }
  const attached = await attachTarget(args);
  try {
    const result = await evaluate(
      attached.session,
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, reason: "selector not found" };
        el.scrollIntoView({ block: "center", inline: "center" });
        const action = ${JSON.stringify(action)};
        if (action === "click") {
          el.focus?.();
          el.click();
        } else if (action === "focus") {
          el.focus?.();
        } else {
          const value = ${JSON.stringify(String(args.value ?? ""))};
          const proto = Object.getPrototypeOf(el);
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) setter.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return { ok: true, tag: el.tagName.toLowerCase(), id: el.id || null, text: (el.innerText || el.value || "").slice(0, 200) };
      })()`,
    );
    return { target: attached.target.id, ...result };
  } finally {
    attached.session.close();
  }
}

async function toolEval(args = {}) {
  const expression = String(args.expression ?? "").trim();
  if (!expression) throw cdpError("CDP_EVAL", "expression is required");
  const attached = await attachTarget(args);
  try {
    const value = await evaluate(attached.session, expression, {
      awaitPromise: args.await_promise !== false,
    });
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return {
      ok: true,
      target: attached.target.id,
      type: typeof value,
      value: text && text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : value,
      truncated: Boolean(text && text.length > MAX_TEXT),
    };
  } finally {
    attached.session.close();
  }
}

// ---------------------------------------------------------------------------
// MCP surface
// ---------------------------------------------------------------------------

export const TOOLS = [
  {
    name: "status",
    description:
      "Report whether a Chromium CDP endpoint is reachable, which browser/protocol answered, and whether a usable Chromium binary can be launched. Read-only; never starts a browser.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "launch",
    description:
      "Launch a discovered Chromium (system or Playwright build) with a temporary profile and headless CDP, or reuse the reachable endpoint. Returns the endpoint, binary, pid and profile.",
    inputSchema: {
      type: "object",
      properties: { timeout_ms: { type: "number", minimum: 1000, maximum: 60000 } },
      additionalProperties: false,
    },
  },
  {
    name: "targets",
    description: "List the real page targets (id, title, url, webSocketDebuggerUrl) on the CDP endpoint.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "navigate",
    description:
      "Navigate the current page (or target_id) to an http(s)/file URL, wait for Page.loadEventFired, and return the real final url, title and readyState. Optionally set an exact viewport.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        wait_ms: { type: "number", minimum: 0, maximum: 30000 },
        target_id: { type: "string" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "dom",
    description:
      "Read the real DOM of the current page: outerHTML/innerHTML/text/attributes for a selector (default documentElement), with a max_chars cap.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        mode: { type: "string", enum: ["outerHTML", "innerHTML", "text", "attributes"] },
        max_chars: { type: "number", minimum: 1, maximum: MAX_TEXT },
        target_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "markers",
    description:
      "Extract every page marker in one pass: title/lang/meta, headings, landmarks, data-*/aria-*/id/role markers, images missing alt, unnamed controls, empty links, unlabeled form fields and duplicate ids.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: 1000 },
        target_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "audit",
    description:
      "One productivity pass: optionally navigate to a URL, then collect markers, console messages, exceptions, failed requests and HTTP >=400 responses from the real page.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        reload: { type: "boolean" },
        width: { type: "number" },
        height: { type: "number" },
        wait_ms: { type: "number", minimum: 0, maximum: 30000 },
        limit: { type: "number", minimum: 1, maximum: 1000 },
        target_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "screenshot",
    description:
      "Capture a real PNG/JPEG screenshot at an exact viewport (width/height) or the current size, plus full_page, and write it to output. Returns the file, bytes and real PNG dimensions.",
    inputSchema: {
      type: "object",
      properties: {
        output: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        full_page: { type: "boolean" },
        format: { type: "string", enum: ["png", "jpeg"] },
        quality: { type: "number", minimum: 60, maximum: 100 },
        target_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "console",
    description:
      "Collect real console messages and uncaught exceptions from the page. Reloads first by default so load-time errors are captured; wait_ms controls the listen window.",
    inputSchema: {
      type: "object",
      properties: {
        reload: { type: "boolean", default: true },
        wait_ms: { type: "number", minimum: 0, maximum: 30000 },
        target_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "network",
    description:
      "Collect real network failures and HTTP responses with status >= 400. Reloads first by default; returns request count, failed requests and http_errors.",
    inputSchema: {
      type: "object",
      properties: {
        reload: { type: "boolean", default: true },
        wait_ms: { type: "number", minimum: 0, maximum: 30000 },
        target_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "act",
    description:
      "Act on a real element by selector: click, focus, or fill (sets the value through the native setter and dispatches input + change). Throws/returns not-found instead of pretending.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        action: { type: "string", enum: ["click", "focus", "fill"] },
        value: { type: "string" },
        target_id: { type: "string" },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: "eval",
    description:
      "Evaluate a JavaScript expression in the page and return its value (awaitPromise by default). Runs in the page, not the OS; use it when no dedicated tool covers the probe.",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string" },
        await_promise: { type: "boolean", default: true },
        target_id: { type: "string" },
      },
      required: ["expression"],
      additionalProperties: false,
    },
  },
];

const HANDLERS = {
  status: toolStatus,
  launch: toolLaunch,
  targets: toolTargets,
  navigate: toolNavigate,
  dom: toolDom,
  markers: toolMarkers,
  audit: toolAudit,
  screenshot: toolScreenshot,
  console: toolConsole,
  network: toolNetwork,
  act: toolAct,
  eval: toolEval,
};

export async function handleRpc(request) {
  const { id, method, params } = request ?? {};
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "cdp", version: VERSION },
      },
    };
  }
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/call") {
    const name = params?.name;
    const handler = HANDLERS[name];
    if (!handler) {
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `Error: unknown tool ${JSON.stringify(name)}` }], isError: true },
      };
    }
    try {
      const result = await handler(params?.arguments ?? {});
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      };
    } catch (error) {
      const payload = failure(error);
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: true },
      };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  process.stderr.write(`cdp MCP ${VERSION} (stdio)\n`);
  let chain = Promise.resolve();
  process.on("exit", cleanup);
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    chain = chain
      .then(async () => {
        let request;
        try {
          request = JSON.parse(line);
        } catch {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
          return;
        }
        const response = await handleRpc(request);
        process.stdout.write(JSON.stringify(response) + "\n");
      })
      .catch((error) => {
        process.stderr.write(`cdp fatal: ${String(error?.stack ?? error)}\n`);
      });
  });
  rl.on("close", () => {
    chain.finally(() => {
      cleanup();
      process.exit(0);
    });
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`fatal: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
}
