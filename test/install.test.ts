import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "bin", "install.mjs");
const BASELINE = "opencode/big-pickle";

function withServer(
  handler: http.RequestListener,
  run: (base: string) => Promise<void>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", async () => {
      const info = server.address();
      const port = typeof info === "object" && info ? info.port : 0;
      const base = `http://127.0.0.1:${port}/v1`;
      try {
        await run(base);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

function runInstaller(
  args: string[],
  env: Record<string, string | null> = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      ZOMBIECODER_BASELINE_MODEL: BASELINE,
    };
    for (const [key, value] of Object.entries(env)) {
      if (value === null) delete childEnv[key];
      else childEnv[key] = value;
    }
    // These tests cover config generation, not the developer's OpenCode
    // install. Without this flag a host binary that cannot report a version
    // fails every install test at the runtime probe.
    const isolatedArgs = args.some(
      (arg) => arg === "--no-opencode" || arg.startsWith("--opencode"),
    )
      ? args
      : [...args, "--opencode", "none"];
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", INSTALLER, ...isolatedArgs],
      { cwd: ROOT, env: childEnv },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function installProject(
  base: string,
  extra: string[] = [],
): Promise<{ root: string; status: number | null; stdout: string; stderr: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-install-"));
  const result = await runInstaller([
    "--dir",
    root,
    "--yes",
    "--no-install",
    "--provider-url",
    base,
    ...extra,
  ]);
  return { root, ...result };
}

test("installer --help exits without touching the target", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-help-"));
  const configDir = path.join(parent, ".opencode");
  const result = await runInstaller(["--help", "--config-dir", configDir]);
  try {
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.ok(!fs.existsSync(configDir), "--help created an install root");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("installer reads the OpenCode version from a supplied binary", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-opencode-path-"));
  const root = path.join(parent, "project");
  const binDir = path.join(parent, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const fake = path.join(binDir, process.platform === "win32" ? "opencode.cmd" : "opencode");
  fs.writeFileSync(
    fake,
    process.platform === "win32"
      ? "@echo off\r\necho opencode v2.2.5\r\n"
      : "#!/bin/sh\necho opencode v2.2.5\n",
  );
  if (process.platform !== "win32") fs.chmodSync(fake, 0o755);
  try {
    const result = await runInstaller([
      "--dir",
      root,
      "--yes",
      "--no-install",
      "--no-lsp",
      "--provider-url",
      "none",
      "--opencode-path",
      fake,
    ]);
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    assert.match(
      result.stdout,
      /OK\s+ensure OpenCode runtime[\s\S]*using 2\.2\.5/,
      `runtime step did not accept the supplied binary:\n${result.stdout}\n${result.stderr}`,
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("installer never writes provider/undefined when /models is empty", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [] }));
    },
    async (base) => {
      const result = await installProject(base);
      const { root } = result;
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        assert.equal(config.model, BASELINE);
        assert.ok(!String(config.model).endsWith("/undefined"));
        const zombiecoder = JSON.parse(
          fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"),
        );
        // The URL was supplied, so the provider exists, but the empty /models
        // answer must not invent a model or a credential.
        assert.ok(zombiecoder.customProviderID, "provider id was not derived from the URL");
        const provider = config.providers[zombiecoder.customProviderID];
        assert.ok(provider, "supplied provider URL was not registered");
        assert.equal(provider.settings.apiKey, undefined);
        assert.deepEqual(provider.models, {});
        // Bundled MCP servers are opt-in, not a default surface.
        assert.equal(config.mcp, undefined);
        assert.match(result.stdout, /copy MCP servers.*skipped \(opt-in/);
        assert.match(result.stdout, /verify MCP tools \(stdio\).*skipped \(opt-in/);
        assert.equal(zombiecoder.installMode, "project");
        assert.equal(zombiecoder.customProviderUrl, base);
        // Native global skill: SKILL.md, not only the legacy flat file.
        const nativeSkill = path.join(
          root,
          ".opencode",
          "skills",
          "first-principles",
          "SKILL.md",
        );
        assert.ok(fs.existsSync(nativeSkill), "native first-principles/SKILL.md missing");
        assert.match(fs.readFileSync(nativeSkill, "utf8"), /^name: first-principles$/m);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

test("installer generates lsp config from resolvable server binaries", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-install-lsp-"));
  const configDir = path.join(parent, ".opencode");
  const bins = path.join(configDir, "lsp", "node_modules", ".bin");
  fs.mkdirSync(bins, { recursive: true });
  for (const name of [
    "typescript-language-server",
    "pyright-langserver",
    "bash-language-server",
    "vscode-json-language-server",
  ]) {
    const file = path.join(bins, process.platform === "win32" ? name + ".cmd" : name);
    fs.writeFileSync(file, "\n", "utf8");
    if (process.platform !== "win32") fs.chmodSync(file, 0o755);
  }
  const result = await runInstaller(
    ["--config-dir", configDir, "--yes", "--no-install", "--provider-url", "none"],
    { HOME: parent, XDG_CONFIG_HOME: path.join(parent, ".config") },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    assert.match(result.stdout, /sync LSP config/);
    const config = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.json"), "utf8"));
    for (const id of ["typescript", "python", "bash", "json"]) {
      assert.ok(config.lsp?.[id], `lsp.${id} missing`);
    }
    assert.equal(
      config.lsp.typescript.command[0],
      path.join(bins, process.platform === "win32" ? "typescript-language-server.cmd" : "typescript-language-server"),
    );
    assert.deepEqual(config.lsp.typescript.command.slice(1), ["--stdio"]);
    assert.ok(config.lsp.typescript.extensions.includes(".ts"));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("installer --config-dir creates a complete self-contained config root", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [] }));
    },
    async (base) => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-config-root-"));
      const configDir = path.join(parent, ".opencode");
      const result = await runInstaller([
        "--config-dir",
        configDir,
        "--yes",
        "--no-install",
        "--provider-url",
        base,
        "--origin-url",
        "https://origin.example",
      ]);
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        assert.ok(fs.existsSync(path.join(configDir, "opencode.json")));
        assert.ok(fs.existsSync(path.join(configDir, "agents", "manu.md")));
        assert.ok(fs.existsSync(path.join(configDir, "plugins", "zombiecoder.ts")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "config.json")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "tools", "evidence_gate.py")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "tls", "nginx.conf.template")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "docs", "SKILL-LIBRARY.md")));
        assert.ok(fs.existsSync(path.join(configDir, "zombiecoder", "model.mjs")));
        assert.ok(!fs.existsSync(path.join(parent, "opencode.json")));
        const config = JSON.parse(fs.readFileSync(path.join(configDir, "opencode.json"), "utf8"));
        assert.equal(config.model, BASELINE);
        assert.equal(config.agents.manu.mode, "all");
        const state = JSON.parse(
          fs.readFileSync(path.join(configDir, "zombiecoder", "config.json"), "utf8"),
        );
        assert.equal(state.installMode, "global");
        assert.equal(state.originUrl, "https://origin.example");
        if (process.platform !== "win32") {
          assert.equal(fs.statSync(path.join(configDir, "opencode.json")).mode & 0o777, 0o600);
          assert.equal(
            fs.statSync(path.join(configDir, "zombiecoder", "config.json")).mode & 0o777,
            0o600,
          );
          assert.equal(
            fs.statSync(path.join(configDir, "plugins", "zombiecoder", "plugin.ts")).mode & 0o777,
            0o644,
            "installed runtime files must not stay world-writable",
          );
        }
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    },
  );
});

test("reinstall prunes retired runtime assets and keeps the skill database", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-prune-assets-"));
  const configDir = path.join(parent, ".opencode");
  const assets = path.join(configDir, "zombiecoder");
  const args = ["--config-dir", configDir, "--yes", "--no-install", "--provider-url", "none"];
  const env = {
    HOME: parent,
    XDG_CONFIG_HOME: path.join(parent, ".config"),
    EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null,
  };
  try {
    const first = await runInstaller(args, env);
    assert.equal(first.status, 0, String(first.stderr || first.stdout || ""));
    assert.ok(fs.existsSync(path.join(assets, "docs", "SKILL-LIBRARY.md")));

    // The retired doc goes; a hand-written file stays; a file the pack installed
    // earlier (recorded in the manifest) goes when the pack stops shipping it.
    const retired = ["docs/100c-runtime-template.md", "docs/retired-by-manifest.md"];
    const manifestFile = path.join(assets, ".install-assets.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.files.push(retired[1]);
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    for (const rel of retired) {
      fs.writeFileSync(path.join(assets, rel), "retired\n", "utf8");
    }
    const userDoc = path.join(assets, "docs", "custom-notes.md");
    fs.writeFileSync(userDoc, "# mine\n", "utf8");

    const db = path.join(assets, "skill-db", "skills.jsonl");
    const dbText = '{"slug":"database-designer"}\n';
    fs.mkdirSync(path.dirname(db), { recursive: true });
    fs.writeFileSync(db, dbText, "utf8");

    const second = await runInstaller(args, env);
    assert.equal(second.status, 0, String(second.stderr || second.stdout || ""));
    assert.match(second.stdout, /pruned 2 retired/);
    for (const rel of retired) {
      assert.equal(fs.existsSync(path.join(assets, rel)), false, `${rel} must be pruned on reinstall`);
    }
    assert.equal(fs.readFileSync(userDoc, "utf8"), "# mine\n", "a hand-written file is not an asset");
    assert.ok(fs.existsSync(path.join(assets, "docs", "SKILL-LIBRARY.md")), "shipped assets stay");
    assert.equal(fs.readFileSync(db, "utf8"), dbText, "the downloaded skill database is not an asset");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("installer refuses a stale checkout before it writes anything", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-stale-"));
  try {
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    fs.copyFileSync(INSTALLER, path.join(root, "bin", "install.mjs"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "stale-checkout", version: "0.0.0" }, null, 2)}\n`,
    );
    const configDir = path.join(root, ".opencode");
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        path.join(root, "bin", "install.mjs"),
        "--config-dir",
        configDir,
        "--yes",
        "--no-install",
        "--opencode",
        "none",
        "--provider-url",
        "none",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, ".config") },
      },
    );
    assert.equal(result.status, 2, String(result.stderr || result.stdout || ""));
    assert.match(result.stderr, /stale checkout/);
    assert.match(result.stderr, /skillCard\.ts/);
    assert.equal(fs.existsSync(configDir), false, "a refused install must not write a config root");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer links a self-contained home to OpenCode's canonical loader", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-link-home-"));
  const selfRoot = path.join(home, ".opencode");
  const canonical = path.join(home, ".config", "opencode");
  fs.mkdirSync(path.join(selfRoot, "node_modules"), { recursive: true });
  const result = await runInstaller(
    ["--config-dir", selfRoot, "--yes", "--no-install", "--provider-url", "none"],
    { HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    for (const item of ["opencode.json", "agents", "zombiecoder", "node_modules", "package.json"]) {
      const link = path.join(canonical, item);
      if (process.platform !== "win32") {
        assert.equal(fs.lstatSync(link).isSymbolicLink(), true, `${item} should link into the self-contained root`);
      }
      assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(selfRoot, item)));
    }
    // Both config roots are scanned; linking plugins would register the same
    // entry twice ("Duplicate plugin ID"). The self-contained root keeps it.
    assert.equal(fs.existsSync(path.join(canonical, "plugins")), false, "plugins must not be linked");
    assert.ok(fs.existsSync(path.join(selfRoot, "plugins", "zombiecoder.ts")));
    assert.match(result.stdout, /link self-contained root to global loader/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installer retires a generated legacy home plugin entry instead of loading it twice", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-duplicate-home-"));
  const legacyRoot = path.join(home, ".opencode");
  const legacyEntry = path.join(legacyRoot, "plugins", "zombiecoder.ts");
  const legacyDir = path.join(legacyRoot, "plugins", "zombiecoder");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    legacyEntry,
    '// GENERATED by zombiecoder-opencode — do not hand edit.\nexport { default } from "./zombiecoder/plugin.ts";\n',
  );
  fs.writeFileSync(path.join(legacyDir, "marker.txt"), "legacy copy\n");
  const result = await runInstaller(
    ["--global", "--yes", "--no-install", "--no-lsp", "--provider-url", "none"],
    {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null,
    },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    const globalEntry = path.join(home, ".config", "opencode", "plugins", "zombiecoder.ts");
    assert.ok(fs.existsSync(globalEntry), "the global entrypoint must exist");
    assert.equal(fs.existsSync(legacyEntry), false, "the legacy entrypoint must not register a second plugin");
    assert.equal(fs.existsSync(path.join(legacyRoot, ".backups")), false, "clean install must not create backup directories");
    assert.match(result.stdout, /retired/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installer replaces a symlinked legacy plugin directory with one real canonical copy", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-symlink-home-"));
  const legacyRoot = path.join(home, ".opencode");
  const legacyPlugins = path.join(legacyRoot, "plugins");
  const canonicalRoot = path.join(home, ".config", "opencode");
  const canonicalPlugins = path.join(canonicalRoot, "plugins");
  fs.mkdirSync(path.join(legacyPlugins, "zombiecoder"), { recursive: true });
  fs.writeFileSync(
    path.join(legacyPlugins, "zombiecoder.ts"),
    '// GENERATED by zombiecoder-opencode — do not hand edit.\nexport { default } from "./zombiecoder/plugin.ts";\n',
  );
  fs.writeFileSync(path.join(legacyPlugins, "zombiecoder", "marker.txt"), "legacy copy\n");
  fs.mkdirSync(canonicalRoot, { recursive: true });
  fs.symlinkSync(legacyPlugins, canonicalPlugins, "dir");

  const result = await runInstaller(
    ["--global", "--yes", "--no-install", "--no-lsp", "--provider-url", "none"],
    {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null,
    },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    assert.equal(fs.lstatSync(canonicalPlugins).isSymbolicLink(), false, "the canonical plugins path must become real");
    assert.ok(fs.existsSync(path.join(canonicalPlugins, "zombiecoder.ts")));
    assert.ok(fs.existsSync(path.join(canonicalPlugins, "zombiecoder", "plugin.ts")));
    assert.equal(fs.existsSync(path.join(legacyPlugins, "zombiecoder.ts")), false);
    assert.equal(fs.existsSync(path.join(legacyRoot, ".backups")), false, "clean install must not create backup directories");
    assert.equal(fs.existsSync(path.join(legacyPlugins, "zombiecoder.ts")), false);
    assert.match(result.stdout, /retired/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installer writes through a symlinked opencode.json instead of forking the config", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-config-link-home-"));
  const legacyRoot = path.join(home, ".opencode");
  const configRoot = path.join(home, ".config", "opencode");
  const target = path.join(legacyRoot, "opencode.json");
  const link = path.join(configRoot, "opencode.json");
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2) + "\n");
  fs.symlinkSync(target, link);
  const result = await runInstaller(
    ["--global", "--yes", "--no-install", "--no-lsp", "--with-local-mcp", "--provider-url", "none"],
    {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null,
    },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, "the installer must not replace the symlink");
    assert.equal(fs.realpathSync(link), fs.realpathSync(target));
    const config = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.deepEqual(Object.keys(config.mcp.servers).sort(), ["cdp", "image-brand", "public-api"]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installer leaves a hand-written legacy plugin entry alone", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-handwritten-home-"));
  const legacyEntry = path.join(home, ".opencode", "plugins", "zombiecoder.ts");
  fs.mkdirSync(path.dirname(legacyEntry), { recursive: true });
  fs.writeFileSync(legacyEntry, "// my own plugin\nexport default {};\n");
  const result = await runInstaller(
    ["--global", "--yes", "--no-install", "--no-lsp", "--provider-url", "none"],
    {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null,
    },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    assert.equal(fs.readFileSync(legacyEntry, "utf8"), "// my own plugin\nexport default {};\n");
    assert.match(result.stdout, /kept \(not generated/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});


test("installer uses free agent assignments when the project environment URL is empty", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-free-env-"));
  const roster = await import("../src/roster.ts");
  const assignment = Object.fromEntries(
    roster.ROSTER.map((agent, index) => [agent.id, `opencode/free-model-${index + 1}`]),
  );
  fs.writeFileSync(
    path.join(root, ".environment"),
    "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL=\n",
  );
  fs.writeFileSync(
    path.join(root, "opencode.json"),
    JSON.stringify({ default_agent: "manu", agents: roster.renderAgentsConfig(roster.ROSTER, assignment) }, null, 2),
  );
  const result = await runInstaller(
    ["--dir", root, "--yes", "--no-install"],
    { EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null, ZOMBIECODER_PROVIDER_URL: null, ZOMBIECODER_BASELINE_MODEL: null },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
    // Pins on (default): the owner's primary agent stays unpinned so /models
    // governs the session, and every other agent keeps its own catalog model.
    assert.equal(config.model, undefined, "without a provider/catalog ref the installer leaves the UI-selected model alone");
    assert.equal(config.default_agent, "manu", "installer must preserve the UI owner's selected primary agent");
    for (const agent of roster.ROSTER) {
      if (agent.id === "manu") {
        assert.equal(config.agents[agent.id].model, undefined, "the primary agent keeps the UI model");
        continue;
      }
      assert.equal(config.agents[agent.id].model, assignment[agent.id]);
    }
    const state = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"));
    assert.equal(state.customProviderUrl, "");
    assert.equal(state.modelStrategy, "free");
    const plan = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "models.json"), "utf8"));
    assert.equal(plan.strategy, "free-fallback");
    assert.equal(plan.assignment.manu, "", "the primary agent is explicitly unpinned in the plan");
    assert.equal(plan.assignment.zombiecoder, assignment.zombiecoder);
    assert.match(result.stdout, /modelStrategy: free/);
    const markdown = fs.readFileSync(path.join(root, ".opencode", "agents", "manu.md"), "utf8");
    assert.doesNotMatch(markdown, /^model:/m, "the primary agent must not pin a model");
    const subagent = fs.readFileSync(path.join(root, ".opencode", "agents", "zombiecoder.md"), "utf8");
    assert.match(
      subagent,
      new RegExp(`^model: ${assignment.zombiecoder}$`, "m"),
      "a subagent carries its own model",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer keeps per-agent model pins when agentModelPins is true", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-pins-"));
  const roster = await import("../src/roster.ts");
  const assignment = Object.fromEntries(
    roster.ROSTER.map((agent, index) => [agent.id, `opencode/free-model-${index + 1}`]),
  );
  fs.mkdirSync(path.join(root, ".zombiecoder"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".zombiecoder", "config.json"),
    JSON.stringify({
      version: "0.0.0-test",
      customProviderUrl: "",
      customProviderID: "gateway",
      mcpUrl: "",
      opencodeApiUrl: "",
      ssotRefreshMs: 300000,
      modelStrategy: "free",
      agentModelPins: true,
    }),
  );
  fs.writeFileSync(
    path.join(root, "opencode.json"),
    JSON.stringify({ agents: roster.renderAgentsConfig(roster.ROSTER, assignment, true) }, null, 2),
  );
  const result = await runInstaller(
    ["--dir", root, "--yes", "--no-install"],
    {
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null,
      EXTERNAL_MCP_URL: null,
      ZOMBIECODER_PROVIDER_URL: null,
    },
  );
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
    // Pins on: the agent -> model mapping is authoritative for every subagent,
    // but the UI session owner (zombiecoder here, no default_agent) stays
    // unpinned so /models still governs the main session.
    assert.equal(config.model, undefined);
    for (const agent of roster.ROSTER) {
      const expected = agent.id === "zombiecoder" ? undefined : assignment[agent.id];
      assert.equal(config.agents[agent.id].model, expected);
    }
    const markdown = fs.readFileSync(path.join(root, ".opencode", "agents", "manu.md"), "utf8");
    assert.match(markdown, /^model: opencode\/free-model-1$/m);
    const main = fs.readFileSync(path.join(root, ".opencode", "agents", "zombiecoder.md"), "utf8");
    assert.doesNotMatch(main, /^model:/m, "the session owner must not be pinned");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer reads the compatible URL from the project .environment file", async () => {
  await withServer(
    providerHandler,
    async (base) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-environment-url-"));
      const apiKey = "project-provider-secret-123";
      fs.writeFileSync(
        root + "/.environment",
        [
          `EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL=${base}`,
          `EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY=${apiKey}`,
          "",
        ].join("\n"),
      );
      const result = await runInstaller(
        ["--dir", root, "--yes", "--no-install"],
        { EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: null, ZOMBIECODER_PROVIDER_URL: null },
      );
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        const state = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"));
        assert.ok(state.customProviderID, "installer did not derive a provider id from the URL");
        assert.equal(config.providers[state.customProviderID].settings.baseURL, base);
        assert.equal(config.providers[state.customProviderID].settings.apiKey, apiKey);
        assert.equal(config.agents.manu.model, undefined);
        assert.equal(state.customProviderUrl, base);
        assert.equal(state.customProviderApiKey, apiKey);
        assert.equal(state.modelStrategy, "auto");
        assert.ok(!result.stdout.includes(apiKey));
        assert.ok(!result.stderr.includes(apiKey));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

test("installer reads and registers the MCP URL from the project .environment file", async () => {
  await withServer(
    (req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += String(chunk)));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        res.setHeader("content-type", "application/json");
        if (body.method === "notifications/initialized") {
          res.statusCode = 202;
          res.end();
          return;
        }
        const result =
          body.method === "initialize"
            ? {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "test-mcp", version: "1.0.0" },
              }
            : { tools: [{ name: "example" }] };
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      });
    },
    async (base) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-environment-mcp-"));
      fs.writeFileSync(root + "/.environment", `EXTERNAL_MCP_URL=${base}\n`);
      const result = await runInstaller(
        ["--dir", root, "--yes", "--no-install"],
        { EXTERNAL_MCP_URL: null, ZOMBIECODER_MCP_URL: null },
      );
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        assert.equal(config.mcp.servers.zombiecoder.url, base);
        const state = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"));
        assert.equal(state.mcpUrl, base);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

function providerHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === "POST" && String(req.url ?? "").endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      let body: any = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        /* fall through to a plain chat answer */
      }
      res.setHeader("content-type", "application/json");
      if (Array.isArray(body.tools)) {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "get_time", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "pong" } }],
          usage: { prompt_tokens: 10 },
          timings: { prompt_n: 10, prompt_ms: 1 },
        }),
      );
    });
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ data: [{ id: "live-model" }] }));
}

test("installer replaces a previous free baseline when the provider becomes live", async () => {
  await withServer(
    providerHandler,
    async (base) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-upgrade-"));
      fs.writeFileSync(
        path.join(root, "opencode.json"),
        JSON.stringify({ model: BASELINE }, null, 2),
      );
      const result = await runInstaller([
        "--dir",
        root,
        "--yes",
        "--no-install",
        "--provider-url",
        base,
      ]);
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        const state = JSON.parse(fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"));
        assert.equal(config.model, `${state.customProviderID}/live-model`);
        assert.equal(config.agents.manu.model, undefined);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

function slowProviderHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === "POST" && String(req.url ?? "").endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      let body: any = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        /* ignore */
      }
      res.setHeader("content-type", "application/json");
      if (Array.isArray(body.tools)) {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "get_time", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "pong" } }],
          usage: { prompt_tokens: 10 },
          timings: { prompt_n: 10, prompt_ms: 2500 },
        }),
      );
    });
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ data: [{ id: "live-model" }] }));
}

test("a slow provider is saved but not selected, and stale models are removed", async () => {
  await withServer(
    slowProviderHandler,
    async (base) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-slow-"));
      fs.writeFileSync(
        path.join(root, "opencode.json"),
        JSON.stringify(
          {
            model: "gateway/old-model",
            providers: {
              gateway: {
                settings: { baseURL: "http://old.test/v1", apiKey: "old-key" },
                models: { "old-model": { name: "old-model" } },
              },
            },
            agents: { manu: { model: "gateway/old-model" } },
          },
          null,
          2,
        ),
      );
      const result = await runInstaller([
        "--dir",
        root,
        "--yes",
        "--no-install",
        "--provider-url",
        base,
        "--provider-id",
        "gateway",
        "--provider-key",
        "test-key",
      ]);
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        assert.match(result.stdout, /slow prompt processing/);
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        assert.equal(config.model, BASELINE);
        assert.equal(config.agents.manu.model, undefined);
        assert.deepEqual(Object.keys(config.providers.gateway.models), ["live-model"]);
        assert.ok(!("old-model" in config.providers.gateway.models));
        const zombiecoder = JSON.parse(
          fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"),
        );
        assert.equal(zombiecoder.modelStrategy, "free");
        const plan = JSON.parse(
          fs.readFileSync(path.join(root, ".zombiecoder", "models.json"), "utf8"),
        );
        assert.equal(plan.providerUsable, false);
        assert.equal(plan.providerSlow, true);
        assert.equal(plan.assignment.manu, "", "a dead provider must not leave a pin behind");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

test("installer passes the provider key to the probe and to opencode.json", async () => {
  let authorization = "";
  await withServer(
    (req, res) => {
      authorization = String(req.headers.authorization ?? "");
      if (authorization !== "Bearer gateway-key") {
        res.writeHead(401, { "content-type": "application/json" }).end(
          JSON.stringify({ error: { message: "unauthorized" } }),
        );
        return;
      }
      providerHandler(req, res);
    },
    async (base) => {
      const result = await installProject(base, [
        "--provider-id",
        "gateway",
        "--provider-key",
        "gateway-key",
      ]);
      const { root } = result;
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
        assert.equal(authorization, "Bearer gateway-key");
        assert.equal(config.providers.gateway.settings.apiKey, "gateway-key");
        assert.equal(config.model, "gateway/live-model");
        assert.equal(config.agents.manu.model, undefined);
        const zombiecoder = JSON.parse(
          fs.readFileSync(path.join(root, ".zombiecoder", "config.json"), "utf8"),
        );
        assert.equal(zombiecoder.customProviderApiKey, "gateway-key");
        assert.ok(!result.stdout.includes("gateway-key"), "installer printed the key");
        if (process.platform !== "win32") {
          assert.equal(fs.statSync(path.join(root, "opencode.json")).mode & 0o777, 0o600);
          assert.equal(
            fs.statSync(path.join(root, ".zombiecoder", "config.json")).mode & 0o777,
            0o600,
          );
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

test("installer leaves bundled MCP servers out unless --with-local-mcp is passed", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [] }));
    },
    async (base) => {
      const off = await installProject(base);
      try {
        assert.equal(off.status, 0, String(off.stderr || off.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(off.root, "opencode.json"), "utf8"));
        assert.equal(config.mcp, undefined, "bundled MCP servers were registered without opt-in");
        assert.match(off.stdout, /copy MCP servers.*skipped \(opt-in/);
      } finally {
        fs.rmSync(off.root, { recursive: true, force: true });
      }

      const on = await installProject(base, ["--with-local-mcp"]);
      try {
        assert.equal(on.status, 0, String(on.stderr || on.stdout || ""));
        const config = JSON.parse(fs.readFileSync(path.join(on.root, "opencode.json"), "utf8"));
        for (const name of ["image-brand", "public-api", "cdp"]) {
          const entry = config.mcp?.servers?.[name];
          assert.ok(entry, `mcp.${name} missing with --with-local-mcp`);
          assert.equal(entry.type, "local");
          assert.ok(
            fs.existsSync(entry.command[1]),
            `mcp.${name} command points at a missing file: ${entry.command[1]}`,
          );
          assert.match(entry.command[1], new RegExp(`[\\\\/]mcp[\\\\/]${name}[\\\\/]server\\.mjs$`));
        }
      } finally {
        fs.rmSync(on.root, { recursive: true, force: true });
      }
    },
  );
});

test("installer keeps an owner-installed MCP server when bundled servers are opt-in", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-mcp-owner-"));
  const mcpDir = path.join(root, ".opencode", "mcp", "cdp");
  fs.mkdirSync(mcpDir, { recursive: true });
  const entry = path.join(mcpDir, "server.mjs");
  fs.writeFileSync(entry, "console.log('cdp')\n");
  fs.writeFileSync(
    path.join(root, "opencode.json"),
    JSON.stringify({ mcp: { servers: { cdp: { type: "local", command: ["node", entry] } } } }, null, 2),
  );
  const result = await runInstaller([
    "--dir",
    root,
    "--yes",
    "--no-install",
    "--no-lsp",
    "--no-opencode",
    "--no-mcp-check",
    "--no-space-check",
  ]);
  try {
    assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
    const config = JSON.parse(fs.readFileSync(path.join(root, "opencode.json"), "utf8"));
    assert.ok(config.mcp?.servers?.cdp, "owner-installed MCP server was pruned");
    assert.deepEqual(config.mcp.servers.cdp.command, ["node", entry]);
    assert.equal(config.mcp.servers["image-brand"], undefined, "bundled server registered without opt-in");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// OpenCode follows plugins/zombiecoder.ts into plugins/zombiecoder/, so every
// relative import in that graph must exist. The stale-prune step once deleted
// agents/ (still imported by plugin.ts and roster.ts) and broke plugin load.
function assertPluginGraphResolves(pluginFolder: string): void {
  const queue = ["plugin.ts", "roster.ts"].map((file) => path.join(pluginFolder, file));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const target = path.resolve(path.dirname(file), match[1]);
      assert.ok(fs.existsSync(target), `missing import target ${target} (imported by ${file})`);
      if (target.endsWith(".ts")) queue.push(target);
    }
  }
  assert.ok(seen.size > 30, `plugin graph too small: only ${seen.size} modules`);
}

test("installed plugin graph resolves every relative import", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [] }));
    },
    async (base) => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-plugin-graph-"));
      const configDir = path.join(parent, ".opencode");
      const result = await runInstaller([
        "--config-dir",
        configDir,
        "--yes",
        "--no-install",
        "--no-lsp",
        "--provider-url",
        base,
      ]);
      try {
        assert.equal(result.status, 0, String(result.stderr || result.stdout || ""));
        const pluginFolder = path.join(configDir, "plugins", "zombiecoder");
        assertPluginGraphResolves(pluginFolder);
        for (const agent of ["index.ts", "runtime.ts", "route.ts", "types.ts", "shared.ts"]) {
          assert.ok(
            fs.existsSync(path.join(pluginFolder, "agents", agent)),
            `agents/${agent} missing after install (pruned despite being imported)`,
          );
        }
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    },
  );
});
