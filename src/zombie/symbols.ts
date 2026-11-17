// Read-only symbol intelligence over the language servers this plugin already
// configures.
//
// This is an independent implementation of the published Language Server
// Protocol behaviour (stdio JSON-RPC, Content-Length framing, documentSymbol /
// references / diagnostic). No Serena source is copied: the shared part is the
// protocol and the question an agent needs answered.
//
// Every server is spawned lazily, cached per (language server, project root),
// and disposed on idle or plugin unload. The four tools built on this module
// are read-only by construction; they never write to the workspace.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LSP_SERVERS, resolveLspServers, type LspServerConfig } from "./lspConfig.ts";
import { resolveAllowedPath } from "./context.ts";

export type SymbolToolOptions = {
  /** Project root: the boundary for paths and the LSP workspace folder. */
  root: string;
  /** OpenCode install root; language-server binaries are resolved under it and PATH. */
  installRoot: string;
};

export type SymbolNode = {
  name: string;
  name_path: string;
  kind: string;
  line: number;
  column: number;
  end_line: number;
  children: SymbolNode[];
};

export type SymbolHit = {
  path: string;
  name_path: string;
  kind: string;
  line: number;
  column: number;
};

export type ReferenceHit = {
  path: string;
  line: number;
  column: number;
  snippet?: string;
};

export type DiagnosticHit = {
  line: number;
  column: number;
  severity: "error" | "warning" | "info" | "hint";
  code?: string;
  source?: string;
  message: string;
};

export type SymbolFailure = {
  ok: false;
  error: { code: string; message: string; hint?: string };
};

const KIND_NAMES: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enum_member",
  23: "struct",
  24: "event",
  25: "operator",
  26: "type_parameter",
};

const SEVERITY_RANK = ["error", "warning", "info", "hint"] as const;
type SeverityName = (typeof SEVERITY_RANK)[number];

const LANGUAGE_IDS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".json": "json",
  ".jsonc": "jsonc",
  ".md": "markdown",
  ".mdx": "markdown",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
};

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };

type LspDiagnostic = {
  range: Range;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
};

type DocumentSymbolLike = {
  name: string;
  kind: number;
  range?: Range;
  selectionRange?: Range;
  children?: DocumentSymbolLike[];
  location?: { uri: string; range: Range };
};

type SymbolLocation = { uri: string; range: Range };

const IDLE_MS = 10 * 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;
// A fresh TypeScript server answers references from the files it has already
// loaded and returns [] while the project is still being indexed. The first
// reference query therefore waits for the project, bounded by this budget.
const REFERENCE_SETTLE_MS = 8_000;
const REFERENCE_RETRY_MS = 350;

class SymbolError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "SymbolError";
    this.code = code;
    this.hint = hint;
  }
}

export function toSymbolFailure(error: unknown): SymbolFailure {
  if (error instanceof SymbolError) {
    return {
      ok: false,
      error: { code: error.code, message: error.message, ...(error.hint ? { hint: error.hint } : {}) },
    };
  }
  return {
    ok: false,
    error: { code: "SYMBOL_FAILED", message: error instanceof Error ? error.message : String(error) },
  };
}

function languageId(file: string): string {
  return LANGUAGE_IDS[path.extname(file).toLowerCase()] ?? "plaintext";
}

function relativePath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function severityName(value: unknown): SeverityName {
  const index = Number(value) - 1;
  return SEVERITY_RANK[index] ?? "info";
}

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

class LspSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly root: string;
  private buffer = Buffer.alloc(0);
  private nextID = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly pushedDiagnostics = new Map<string, LspDiagnostic[]>();
  private readonly diagnosticWaiters = new Map<string, Array<(items: LspDiagnostic[]) => void>>();
  private readonly opened = new Set<string>();
  private referenceWarm = false;
  private diagnosticsSettled = false;
  private dead = false;
  capabilities: any = {};
  lastUsed = Date.now();

  constructor(command: string[], root: string) {
    this.root = root;
    this.child = spawn(command[0], command.slice(1), {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    // Language servers are chatty on stderr; draining it prevents a blocked pipe.
    this.child.stderr.on("data", () => undefined);
    this.child.on("exit", () => this.failAll(new SymbolError("LSP_EXITED", "language server exited")));
    this.child.on("error", (error) =>
      this.failAll(
        new SymbolError("LSP_SPAWN_FAILED", error.message, "run the installer or check the server binary"),
      ),
    );
  }

  async initialize(timeoutMs = 10_000): Promise<void> {
    const result: any = await this.request(
      "initialize",
      {
        processId: process.pid,
        rootUri: pathToFileURL(this.root).href,
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }],
        capabilities: {
          workspace: {
            symbol: {},
            workspaceEdit: { documentChanges: true },
          },
          textDocument: {
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            references: {},
            diagnostic: {},
            publishDiagnostics: {},
          },
        },
        initializationOptions: {},
      },
      timeoutMs,
    );
    this.capabilities = result?.capabilities ?? {};
    this.notify("initialized", {});
  }

  async open(file: string): Promise<string> {
    const uri = pathToFileURL(file).href;
    if (this.opened.has(uri)) return uri;
    const text = fs.readFileSync(file, "utf8");
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: languageId(file), version: 1, text },
    });
    this.opened.add(uri);
    return uri;
  }

  async documentSymbols(file: string): Promise<DocumentSymbolLike[]> {
    const uri = await this.open(file);
    const result = await this.request(
      "textDocument/documentSymbol",
      { textDocument: { uri } },
      DEFAULT_TIMEOUT_MS,
    );
    return Array.isArray(result) ? (result as DocumentSymbolLike[]) : [];
  }

  async references(file: string, position: Position): Promise<SymbolLocation[]> {
    const uri = await this.open(file);
    const query = () =>
      this.request(
        "textDocument/references",
        { textDocument: { uri }, position, context: { includeDeclaration: false } },
        DEFAULT_TIMEOUT_MS,
      ).then((result) => (Array.isArray(result) ? (result as SymbolLocation[]) : []));

    let result = await query();
    if (this.referenceWarm || result.length > 0) {
      this.referenceWarm = true;
      return result;
    }
    // Empty can mean "no references" or "project not indexed yet". Give the
    // server time to finish indexing, then trust the final answer.
    const deadline = Date.now() + REFERENCE_SETTLE_MS;
    while (result.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, REFERENCE_RETRY_MS));
      result = await query();
    }
    this.referenceWarm = true;
    return result;
  }

  async workspaceSymbols(query: string): Promise<DocumentSymbolLike[]> {
    const result = await this.request("workspace/symbol", { query }, DEFAULT_TIMEOUT_MS);
    return Array.isArray(result) ? (result as DocumentSymbolLike[]) : [];
  }

  async diagnostics(
    file: string,
    timeoutMs: number,
  ): Promise<{ items: LspDiagnostic[]; source: "pull" | "publishDiagnostics" }> {
    const uri = await this.open(file);
    if (this.capabilities?.diagnosticProvider) {
      try {
        const result: any = await this.request("textDocument/diagnostic", { textDocument: { uri } }, timeoutMs);
        if (result && Array.isArray(result.items)) {
          return { items: result.items as LspDiagnostic[], source: "pull" };
        }
      } catch {
        // The capability exists but the request failed; fall back to pushes.
      }
    }
    return { items: await this.waitForDiagnostics(uri, timeoutMs), source: "publishDiagnostics" };
  }

  async dispose(): Promise<void> {
    if (this.dead) return;
    this.dead = true;
    this.send({ jsonrpc: "2.0", id: this.nextID++, method: "shutdown", params: null });
    this.notify("exit", null);
    const child = this.child;
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }, 300);
    timer.unref();
    this.failAll(new SymbolError("LSP_DISPOSED", "language server disposed"));
  }

  killNow(): void {
    try {
      this.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }

  private waitForDiagnostics(uri: string, timeoutMs: number): Promise<LspDiagnostic[]> {
    const cached = this.pushedDiagnostics.get(uri);
    // A settled session has already produced real diagnostics; an empty push is
    // then authoritative. Before that, an empty push may arrive while the
    // project is still loading, so keep waiting for a meaningful one.
    if (cached && (cached.length > 0 || this.diagnosticsSettled)) return Promise.resolve(cached);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        const waiters = (this.diagnosticWaiters.get(uri) ?? []).filter((entry) => entry !== onPush);
        if (waiters.length > 0) this.diagnosticWaiters.set(uri, waiters);
        else this.diagnosticWaiters.delete(uri);
        clearTimeout(timer);
        const items = this.pushedDiagnostics.get(uri) ?? [];
        if (items.length > 0) this.diagnosticsSettled = true;
        resolve(items);
      };
      const onPush = (items: LspDiagnostic[]) => {
        if (items.length > 0 || this.diagnosticsSettled) finish();
      };
      const waiters = this.diagnosticWaiters.get(uri) ?? [];
      waiters.push(onPush);
      this.diagnosticWaiters.set(uri, waiters);
      const timer = setTimeout(finish, Math.max(200, timeoutMs));
      timer.unref();
    });
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<any> {
    if (this.dead) return Promise.reject(new SymbolError("LSP_CLOSED", "language server is not running"));
    const id = this.nextID++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SymbolError("LSP_TIMEOUT", `${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: unknown): void {
    if (this.child.stdin.destroyed) return;
    const body = Buffer.from(JSON.stringify(message), "utf8");
    try {
      this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      this.child.stdin.write(body);
    } catch {
      // The exit handler already rejected pending requests; a dead pipe is not news.
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        // A malformed frame must not poison the stream; the next frame is independent.
      }
    }
  }

  private onMessage(message: any): void {
    if (message?.id !== undefined && typeof message.method === "string") {
      // Server -> client requests. Answer the known ones; a silent client hangs servers.
      let result: unknown = null;
      if (message.method === "workspace/configuration") {
        const count = Array.isArray(message.params?.items) ? message.params.items.length : 0;
        result = Array.from({ length: count }, () => null);
      }
      this.send({ jsonrpc: "2.0", id: message.id, result });
      return;
    }

    if (message?.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new SymbolError(
            String(message.error.code ?? "LSP_ERROR"),
            String(message.error.message ?? "language server error"),
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message?.method === "textDocument/publishDiagnostics") {
      const uri = String(message.params?.uri ?? "");
      const items = Array.isArray(message.params?.diagnostics) ? (message.params.diagnostics as LspDiagnostic[]) : [];
      if (uri) {
        this.pushedDiagnostics.set(uri, items);
        if (items.length > 0) this.diagnosticsSettled = true;
        for (const waiter of [...(this.diagnosticWaiters.get(uri) ?? [])]) waiter(items);
      }
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

type ActiveSession = {
  id: string;
  session: LspSession;
};

const activeSessions = new Map<string, ActiveSession>();
const resolvedByInstallRoot = new Map<string, ReturnType<typeof resolveLspServers>>();
let exitHookInstalled = false;

function serversFor(installRoot: string): ReturnType<typeof resolveLspServers> {
  let resolved = resolvedByInstallRoot.get(installRoot);
  if (!resolved) {
    resolved = resolveLspServers(installRoot);
    resolvedByInstallRoot.set(installRoot, resolved);
  }
  return resolved;
}

function pruneIdle(): void {
  const now = Date.now();
  for (const [key, entry] of activeSessions) {
    if (now - entry.session.lastUsed > IDLE_MS) {
      activeSessions.delete(key);
      void entry.session.dispose();
    }
  }
}

function ensureExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const entry of activeSessions.values()) entry.session.killNow();
  });
}

async function sessionFor(options: SymbolToolOptions, file: string): Promise<ActiveSession> {
  const resolved = serversFor(options.installRoot);
  const extension = path.extname(file).toLowerCase();
  let chosen: { id: string; config: LspServerConfig } | undefined;
  for (const [id, config] of Object.entries(resolved.servers)) {
    if (config.extensions.includes(extension)) {
      chosen = { id, config };
      break;
    }
  }
  if (!chosen) {
    const spec = LSP_SERVERS.find((entry) => entry.extensions.includes(extension));
    if (spec) {
      throw new SymbolError(
        "LSP_SERVER_MISSING",
        `no ${spec.id} language server is available for ${extension}`,
        `install ${spec.packages.join(", ")} or rerun the ZombieCoder installer`,
      );
    }
    throw new SymbolError("LSP_EXTENSION_UNSUPPORTED", `no configured language server handles ${extension}`);
  }

  pruneIdle();
  const key = `${chosen.id}\u0000${options.root}`;
  let entry = activeSessions.get(key);
  if (!entry) {
    const session = new LspSession(chosen.config.command, options.root);
    await session.initialize();
    entry = { id: chosen.id, session };
    activeSessions.set(key, entry);
    ensureExitHook();
  }
  entry.session.lastUsed = Date.now();
  return entry;
}

function resolveFile(options: SymbolToolOptions, file: string): string {
  const resolved = resolveAllowedPath(options.root, file);
  if (!resolved) throw new SymbolError("PATH_OUTSIDE_PROJECT", `${file} is outside the project root`);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new SymbolError("FILE_NOT_FOUND", `no such file: ${file}`);
  }
  if (!stat.isFile()) throw new SymbolError("NOT_A_FILE", `${file} is not a file`);
  return resolved;
}

function buildTree(nodes: DocumentSymbolLike[], parent = ""): SymbolNode[] {
  const result: SymbolNode[] = [];
  for (const node of nodes) {
    const range = node.range ?? node.location?.range;
    if (!range) continue;
    const namePath = parent ? `${parent}/${node.name}` : node.name;
    result.push({
      name: node.name,
      name_path: namePath,
      kind: KIND_NAMES[node.kind] ?? `kind_${node.kind}`,
      line: range.start.line + 1,
      column: range.start.character + 1,
      end_line: range.end.line + 1,
      children: node.children?.length ? buildTree(node.children, namePath) : [],
    });
  }
  return result;
}

function pruneTree(nodes: SymbolNode[], depth: number, level = 0): SymbolNode[] {
  return nodes.map((node) => ({
    ...node,
    children: depth < 0 || level < depth ? pruneTree(node.children, depth, level + 1) : [],
  }));
}

function flattenHits(nodes: DocumentSymbolLike[], parent = ""): Array<{ node: DocumentSymbolLike; namePath: string }> {
  const result: Array<{ node: DocumentSymbolLike; namePath: string }> = [];
  for (const node of nodes) {
    const namePath = parent ? `${parent}/${node.name}` : node.name;
    result.push({ node, namePath });
    if (node.children?.length) result.push(...flattenHits(node.children, namePath));
  }
  return result;
}

function matchesName(hit: { node: DocumentSymbolLike; namePath: string }, query: string, substring: boolean): boolean {
  if (hit.namePath === query) return true;
  if (!query.includes("/") && hit.node.name === query) return true;
  return substring && hit.namePath.toLowerCase().includes(query.toLowerCase());
}

function countNodes(nodes: SymbolNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

type OutlinePayload = {
  ok: true;
  path: string;
  language_server: string;
  symbols: SymbolNode[];
  count: number;
  truncated: boolean;
};

function fitBudget(payload: OutlinePayload, maxChars: number, maxSymbols = 400): OutlinePayload {
  if (JSON.stringify(payload).length <= maxChars) return payload;
  let next: OutlinePayload = {
    ...payload,
    symbols: payload.symbols.map((node) => ({ ...node, children: [] })),
    truncated: true,
  };
  if (JSON.stringify(next).length > maxChars) {
    next = { ...next, symbols: next.symbols.slice(0, maxSymbols) };
  }
  return next;
}

function firstProjectFile(root: string, allowed: Set<string>): string | null {
  const skip = new Set(["node_modules", ".git", "dist", "build", ".zombiecoder", ".opencode"]);
  const stack = [root];
  let seen = 0;
  while (stack.length > 0 && seen < 5_000) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) stack.push(full);
      } else if (allowed.has(path.extname(entry.name).toLowerCase())) {
        return full;
      }
    }
  }
  return null;
}

export async function symbolOverview(
  options: SymbolToolOptions & { file: string; depth?: number; maxChars?: number },
): Promise<Record<string, unknown>> {
  try {
    const file = resolveFile(options, options.file);
    const session = await sessionFor(options, file);
    const raw = await session.session.documentSymbols(file);
    const depth = typeof options.depth === "number" ? options.depth : 1;
    const tree = pruneTree(buildTree(raw), depth);
    const payload: OutlinePayload = {
      ok: true,
      path: relativePath(options.root, file),
      language_server: session.id,
      symbols: tree,
      count: countNodes(tree),
      truncated: false,
    };
    return fitBudget(payload, options.maxChars ?? 20_000);
  } catch (error) {
    return toSymbolFailure(error);
  }
}

export async function findSymbols(
  options: SymbolToolOptions & {
    name: string;
    file?: string;
    substring?: boolean;
    maxResults?: number;
  },
): Promise<Record<string, unknown>> {
  try {
    const query = String(options.name ?? "").trim();
    if (!query) throw new SymbolError("MISSING_NAME", "name is required");
    const maxResults = Math.max(1, Math.min(options.maxResults ?? 20, 100));
    const substring = options.substring === true;
    const hits: SymbolHit[] = [];

    if (options.file) {
      const file = resolveFile(options, options.file);
      const session = await sessionFor(options, file);
      const raw = await session.session.documentSymbols(file);
      for (const hit of flattenHits(raw)) {
        if (!matchesName(hit, query, substring)) continue;
        const range = hit.node.range ?? hit.node.location?.range;
        if (!range) continue;
        hits.push({
          path: relativePath(options.root, file),
          name_path: hit.namePath,
          kind: KIND_NAMES[hit.node.kind] ?? `kind_${hit.node.kind}`,
          line: range.start.line + 1,
          column: range.start.character + 1,
        });
        if (hits.length >= maxResults) break;
      }
      return { ok: true, scope: "file", query, matches: hits, count: hits.length };
    }

    const resolved = serversFor(options.installRoot);
    let source: string | null = null;
    for (const spec of LSP_SERVERS) {
      const config = resolved.servers[spec.id];
      if (!config) continue;
      source = firstProjectFile(options.root, new Set(config.extensions));
      if (source) break;
    }
    if (!source) {
      throw new SymbolError("NO_SOURCE_FILES", "the project has no file for a configured language server");
    }
    const absolute = resolveFile(options, source);
    const session = await sessionFor(options, absolute);
    let raw: DocumentSymbolLike[];
    try {
      raw = await session.session.workspaceSymbols(query);
    } catch (error) {
      throw new SymbolError(
        "WORKSPACE_SYMBOL_UNSUPPORTED",
        error instanceof Error ? error.message : String(error),
        "pass a path to search one file instead",
      );
    }
    for (const node of raw) {
      const namePath = node.name;
      if (!matchesName({ node, namePath }, query, true)) continue;
      const range = node.range ?? node.location?.range;
      if (!range) continue;
      const located = node.location?.uri ? fileURLToPath(node.location.uri) : absolute;
      if (!resolveAllowedPath(options.root, located)) continue;
      hits.push({
        path: relativePath(options.root, located),
        name_path: namePath,
        kind: KIND_NAMES[node.kind] ?? `kind_${node.kind}`,
        line: range.start.line + 1,
        column: range.start.character + 1,
      });
      if (hits.length >= maxResults) break;
    }
    return {
      ok: true,
      scope: "workspace",
      language_server: session.id,
      query,
      matches: hits,
      count: hits.length,
    };
  } catch (error) {
    return toSymbolFailure(error);
  }
}

function lineSnippet(file: string, line: number): string | undefined {
  try {
    const text = fs.readFileSync(file, "utf8").split(/\r?\n/)[line - 1] ?? "";
    const trimmed = text.trim();
    return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
  } catch {
    return undefined;
  }
}

export async function findReferences(
  options: SymbolToolOptions & {
    file: string;
    namePath: string;
    includeSnippet?: boolean;
    maxResults?: number;
  },
): Promise<Record<string, unknown>> {
  try {
    const file = resolveFile(options, options.file);
    const session = await sessionFor(options, file);
    const raw = await session.session.documentSymbols(file);
    const flat = flattenHits(raw);
    const query = String(options.namePath ?? "").trim();
    const hit =
      flat.find((entry) => entry.namePath === query) ??
      flat.find((entry) => entry.node.name === query) ??
      flat.find((entry) => entry.namePath.toLowerCase().endsWith(`/${query.toLowerCase()}`));
    if (!hit) {
      const names = flat.slice(0, 12).map((entry) => entry.namePath);
      throw new SymbolError(
        "SYMBOL_NOT_FOUND",
        `no symbol named ${query} in ${relativePath(options.root, file)}`,
        `known symbols: ${names.join(", ")}`,
      );
    }
    const position = (hit.node.selectionRange ?? hit.node.range)?.start;
    if (!position) throw new SymbolError("SYMBOL_NOT_FOUND", `${query} has no position`);
    const locations = await session.session.references(file, position);
    const maxResults = Math.max(1, Math.min(options.maxResults ?? 50, 200));
    const includeSnippet = options.includeSnippet !== false;
    const references: ReferenceHit[] = [];
    for (const location of locations) {
      const uri = String(location?.uri ?? "");
      if (!uri.startsWith("file:")) continue;
      const absolute = fileURLToPath(uri);
      if (!resolveAllowedPath(options.root, absolute)) continue;
      const line = Number(location?.range?.start?.line ?? -1) + 1;
      const entry: ReferenceHit = {
        path: relativePath(options.root, absolute),
        line,
        column: Number(location?.range?.start?.character ?? 0) + 1,
      };
      if (includeSnippet) entry.snippet = lineSnippet(absolute, line);
      references.push(entry);
      if (references.length >= maxResults) break;
    }
    return {
      ok: true,
      symbol: hit.namePath,
      definition: { path: relativePath(options.root, file), line: (hit.node.range?.start.line ?? 0) + 1 },
      references,
      count: references.length,
      truncated: locations.length > references.length,
    };
  } catch (error) {
    return toSymbolFailure(error);
  }
}

export async function diagnosticsForFile(
  options: SymbolToolOptions & {
    file: string;
    minSeverity?: SeverityName;
    timeoutMs?: number;
  },
): Promise<Record<string, unknown>> {
  try {
    const file = resolveFile(options, options.file);
    const session = await sessionFor(options, file);
    const timeoutMs = Math.max(300, Math.min(options.timeoutMs ?? 4_000, 30_000));
    const { items, source } = await session.session.diagnostics(file, timeoutMs);
    const minimum = Math.max(0, SEVERITY_RANK.indexOf(options.minSeverity ?? "hint"));
    const diagnostics: DiagnosticHit[] = items
      .map((item) => ({
        line: item.range.start.line + 1,
        column: item.range.start.character + 1,
        severity: severityName(item.severity),
        ...(item.code !== undefined ? { code: String(item.code) } : {}),
        ...(item.source ? { source: item.source } : {}),
        message: String(item.message ?? "").trim(),
      }))
      .filter((item) => SEVERITY_RANK.indexOf(item.severity) <= minimum);
    return {
      ok: true,
      path: relativePath(options.root, file),
      language_server: session.id,
      source,
      diagnostics,
      count: diagnostics.length,
    };
  } catch (error) {
    return toSymbolFailure(error);
  }
}

export function disposeSymbolServers(): void {
  for (const entry of activeSessions.values()) void entry.session.dispose();
  activeSessions.clear();
}
