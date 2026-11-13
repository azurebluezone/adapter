// Spec §6 + §7 — the in-plugin control surface.
//
// Two documented OpenCode doors are used, nothing invented:
//   ctx.rpc.register  -> reachable over HTTP at POST /api/rpc/{rpcID}/{method}
//   ctx.tool.transform -> tools the agents themselves can call
//
// Every handler is pure: it reads the working directory, returns data, and never
// mutates OpenCode's own state. The single exception is `syllabus_append`, which is
// append-only by construction.

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { auditFile, memoryDir, ssotFile, syllabusFile } from "./paths.ts";
import { appendJsonl, ensureDir, readJsonl, readText, redact, redactValue, writeAtomic, PLUGIN_VERSION } from "./io.ts";
import { readArchive, readIndex, readRecent, archiveSummary, type StorageLike } from "./memory.ts";
import { appendSyllabus, readSyllabus } from "./syllabus.ts";
import { scanProject } from "./scan.ts";
import { keepTransform, type TransformDoor } from "./transform.ts";
import { buildContextPack, resolveAllowedPath } from "./context.ts";
import { loadRun } from "../agents/runtime.ts";
import {
  contractStatus,
  failedExpectedRewrite,
  matches,
  normalizeCommand,
  normalizeMatch,
  openContracts,
  parseContract,
  runCheck,
  trivialExpected,
  validateCheck,
  validateExpected,
} from "./goalContract.ts";
import { isStandInPath } from "./responseGate.ts";
import { syntaxCheck } from "./lsp.ts";
import { ensureOnboarding } from "./onboarding.ts";
import { buildProjectInvestigation } from "./investigation.ts";
import { buildDesignSketch, reviewDesign } from "./design.ts";
import {
  autoInstallSkills,
  installSharedSkill,
  listSkillCatalog,
} from "./skillCatalog.ts";
import { ROSTER } from "../roster.ts";
import { AGENT_MODES, BUILTIN_AGENTS, MODE_REGISTRY, applyModeOverrides, planModeSwitch, type AgentMode } from "./modes.ts";

export const RPC_ID = "zombiecoder";
/** Safety cap for the real check command close runs. Not a work budget. */
const CHECK_TIMEOUT_MS = 120_000;
/** The baseline is a quick "does this already pass?" probe, not a work budget. */
const BASELINE_TIMEOUT_MS = 60_000;
export const TOOL_NAMESPACE = { name: "zombiecoder", description: "ZombieCoder project control surface" };

/** One line for the append-only ledger; a newline would break field parsing. */
function oneLine(value: string, limit = 500): string {
  return String(value ?? "").replace(/\r?\n/g, " ⏎ ").slice(0, limit);
}

export type RpcLike = {
  register: (definition: any, handlers: any) => Promise<{ dispose: () => Promise<void>; events?: { emit: (...a: any[]) => Promise<void> } }>;
};

export type ToolLike = {
  transform?: (cb: (editor: any) => void) => Promise<{ dispose: () => Promise<void> }>;
  reload?: () => Promise<void>;
};

export type SurfaceDeps = {
  /** Session-aware project root. Falls back to the setup root when no session is cached. */
  projectRoot: (sessionID?: string) => string;
  /** OpenCode config directory: the shared skill store lives under it. */
  installRoot: () => string;
  storage: StorageLike;
  refreshSsot: () => { sha256: string; file: string; bytes: number };
  modelPlan: () => unknown;
  /** Read-only view of the config-level agentModes overrides. */
  agentModes?: () => Record<string, string>;
  /** Reload the skill registry after a project skill is added. */
  reloadSkills?: () => Promise<void>;
  /** Reload agent markdown after a persona/config change. */
  reloadAgents?: () => Promise<void>;
  /** Reload the provider and model catalogs after a model/config change. */
  reloadProviders?: () => Promise<void>;
  /** Reload the plugin's own tool registrations after a surface change. */
  reloadTools?: () => Promise<void>;
  /** Show a visible card in the session UI (OpenCode synthetic message). */
  synthetic?: (input: { sessionID: string; text: string; description?: string }) => Promise<unknown>;
  /**
   * OpenCode's native permission door. The plugin asks once per contract at open
   * and once per close; the user's reply ("once" / "always" / "reject") is
   * handled by the host, not by this plugin. Resolves on approval.
   */
  assertPermission?: (input: {
    sessionID: string;
    action: string;
    resources: string[];
    save?: string[];
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
};

const obj = (properties: Record<string, unknown>) => ({
  type: "object" as const,
  properties,
  additionalProperties: false,
});

// The installer places the Python verifier at <install-root>/zombiecoder/tools.
// Source checkouts keep it at <repo-root>/tools. Resolve both shapes instead of
// hardcoding one machine's home directory.
const INSTALL_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SOURCE_ROOT = path.resolve(import.meta.dirname, "..", "..");

function evidenceGateScript(projectRoot: string): string | null {
  const candidates = [
    path.join(INSTALL_ROOT, "zombiecoder", "tools", "evidence_gate.py"),
    path.join(INSTALL_ROOT, "tools", "evidence_gate.py"),
    path.join(SOURCE_ROOT, "tools", "evidence_gate.py"),
    path.join(projectRoot, ".opencode", "zombiecoder", "tools", "evidence_gate.py"),
    path.join(projectRoot, ".zombiecoder", "tools", "evidence_gate.py"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// `events` is required by Rpc.Definition, so it is declared empty rather than omitted.
export function rpcDefinition() {
  return {
    id: RPC_ID,
    methods: {
      working_directory: {
        input: obj({}),
        output: obj({ root: { type: "string" } }),
      },
      status: {
        input: obj({}),
        output: obj({
          version: { type: "string" },
          root: { type: "string" },
          agents: { type: "number" },
          ssotFile: { type: "string" },
          syllabusFile: { type: "string" },
        }),
      },
      ssot: {
        input: obj({}),
        output: obj({ file: { type: "string" }, markdown: { type: "string" } }),
      },
      ssot_refresh: {
        input: obj({}),
        output: obj({ file: { type: "string" }, sha256: { type: "string" }, bytes: { type: "number" } }),
      },
      syllabus: {
        input: obj({}),
        output: obj({ file: { type: "string" }, markdown: { type: "string" } }),
      },
      syllabus_append: {
        input: obj({ topic: { type: "string" }, summary: { type: "string" } }),
        output: obj({ file: { type: "string" }, bytes: { type: "number" } }),
      },
      memory: {
        input: obj({ sessionID: { type: "string" } }),
        output: obj({ recent: { type: "array" }, summary: { type: "string" } }),
      },
      memory_index: {
        input: obj({}),
        output: obj({ index: { type: "object" } }),
      },
      audit: {
        input: obj({ limit: { type: "number" } }),
        output: obj({ entries: { type: "array" } }),
      },
      models: {
        input: obj({}),
        output: obj({ plan: { type: "object" } }),
      },
      fingerprint: {
        input: obj({}),
        output: obj({ fingerprint: { type: "object" } }),
      },
      context_status: {
        input: obj({ agent: { type: "string" }, sessionID: { type: "string" } }),
        output: obj({
          uiLine: { type: "string" },
          packBytes: { type: "number" },
          allowedRoot: { type: "string" },
          ssot: { type: "object" },
          syllabus: { type: "object" },
          ssotExcerptBytes: { type: "number" },
          syllabusExcerptBytes: { type: "number" },
          memory: { type: "object" },
          owners: { type: "object" },
        }),
      },
      agents: {
        input: obj({}),
        output: obj({ agents: { type: "array" } }),
      },
    },
    events: {},
  };
}

export async function registerRpc(rpc: RpcLike | undefined, deps: SurfaceDeps): Promise<{ ok: boolean; error?: string }> {
  if (!rpc || typeof rpc.register !== "function") return { ok: false, error: "ctx.rpc not available" };
  try {
    const handlers = {
      working_directory: async () => ({ root: deps.projectRoot() }),

      status: async () => ({
        version: PLUGIN_VERSION,
        root: deps.projectRoot(),
        agents: ROSTER.length,
        ssotFile: ssotFile(deps.projectRoot()),
        syllabusFile: syllabusFile(deps.projectRoot()),
      }),

      ssot: async () => ({
        file: ssotFile(deps.projectRoot()),
        markdown: readText(ssotFile(deps.projectRoot())) ?? "(SSOT not generated yet)",
      }),

      ssot_refresh: async () => {
        const written = deps.refreshSsot();
        return { file: written.file, sha256: written.sha256, bytes: written.bytes };
      },

      syllabus: async () => ({
        file: syllabusFile(deps.projectRoot()),
        markdown: readSyllabus(deps.projectRoot()) ?? "(syllabus not seeded yet)",
      }),

      syllabus_append: async (input: { topic: string; summary: string }) => {
        if (!input?.topic || !input?.summary) throw new Error("topic and summary are required");
        const result = appendSyllabus(deps.projectRoot(), input.topic, input.summary, auditFile(deps.projectRoot()));
        return { file: result.file, bytes: result.bytes };
      },

      memory: async (input: { sessionID: string }) => {
        const sessionID = input?.sessionID ?? "unknown";
        return {
          recent: await readRecent(deps.storage, sessionID),
          summary: archiveSummary(deps.projectRoot(sessionID), sessionID),
        };
      },

      memory_index: async () => ({ index: readIndex(deps.projectRoot()) }),

      audit: async (input: { limit?: number }) => ({
        entries: readJsonl(auditFile(deps.projectRoot()), input?.limit ?? 50),
      }),

      models: async () => ({
        plan: deps.modelPlan() ?? {},
      }),

      fingerprint: async () => ({
        fingerprint: scanProject(deps.projectRoot()),
      }),

      context_status: async (input: { agent?: string; sessionID?: string; message?: string }) => {
        const sessionID = String(input?.sessionID ?? "").trim();
        const projectRoot = deps.projectRoot(sessionID);
        const recent = sessionID ? await readRecent(deps.storage, sessionID) : [];
        const pack = buildContextPack(
          projectRoot,
          String(input?.agent ?? "unknown"),
          recent,
          String(input?.message ?? ""),
        );
        return {
          uiLine: pack.uiLine,
          packBytes: pack.bytes,
          allowedRoot: pack.allowedRoot,
          ssot: pack.ssot,
          syllabus: pack.syllabus,
          ssotExcerptBytes: pack.ssotExcerptBytes,
          syllabusExcerptBytes: pack.syllabusExcerptBytes,
          focus: pack.focus,
          intent: {
            kind: pack.intent.kind,
            confidence: pack.intent.confidence,
            reason: pack.intent.reason,
            terms: pack.intent.terms,
            primary: pack.intent.focus?.primary.map((item) => item.path) ?? [],
            related: pack.intent.focus?.related.map((item) => item.path) ?? [],
          },
          memory: pack.memory,
          owners: pack.owners,
        };
      },

      agents: async () =>
        ROSTER.map((a) => ({
          id: a.id,
          name: a.name,
          callSign: a.callSign,
          role: a.role,
          mode: a.mode,
          model: a.model,
        })),
    };

    const registration = await rpc.register(rpcDefinition(), handlers);
    // Keep the registration for the lifetime of the plugin; nothing to dispose eagerly.
    void registration;
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

// ---- agent-callable tools (spec names `get_working_directory` explicitly) ----

type ToolContextLike = { sessionID?: string };

type ToolSpec = {
  name: string;
  description: string;
  input: Record<string, unknown>;
  run: (input: any, context?: ToolContextLike) => any;
};

export function toolSpecs(deps: SurfaceDeps): ToolSpec[] {
  const empty = { type: "object" as const, properties: {}, additionalProperties: false };
  const rootFor = (context?: ToolContextLike) => deps.projectRoot(context?.sessionID);

  // Consent is a commitment gate, not a tool wall. `save` is the resource list
  // OpenCode stores when the user answers "always"; open saves the project root
  // so one "always yes" covers later goals here, close saves only that contract id
  // so closing still needs a fresh human answer.
  const ask = async (
    context: ToolContextLike | undefined,
    action: string,
    resources: string[],
    metadata: Record<string, unknown>,
    save?: string[],
  ): Promise<{ ok: true } | { ok: false; status: "rejected" | "unavailable"; reason: string }> => {
    const sessionID = String(context?.sessionID ?? "").trim();
    if (!sessionID) {
      return { ok: false, status: "unavailable", reason: "no session id: the user cannot be asked" };
    }
    if (!deps.assertPermission) {
      return { ok: false, status: "unavailable", reason: "permission.assert is not available in this runtime" };
    }
    try {
      await deps.assertPermission({
        sessionID,
        action,
        resources,
        ...(save ? { save } : {}),
        metadata,
      });
      return { ok: true };
    } catch (error: any) {
      return {
        ok: false,
        status: "rejected",
        reason: redact(String(error?.message ?? error)).slice(0, 300),
      };
    }
  };

  return [
    {
      name: "get_working_directory",
      description: "Return the working directory the ZombieCoder plugin is bound to, plus the .zombiecoder layout.",
      input: empty,
      run: (_input: any, context?: ToolContextLike) => {
        const projectRoot = rootFor(context);
        return {
          root: projectRoot,
          zombiecoder: projectRoot + "/.zombiecoder",
          ssot: ssotFile(projectRoot),
          syllabus: syllabusFile(projectRoot),
          memory: memoryDir(projectRoot),
        };
      },
    },
    {
      name: "read_ssot",
      description: "Read the generated Single Source of Truth for this project.",
      input: empty,
      run: (_input: any, context?: ToolContextLike) => {
        const projectRoot = rootFor(context);
        return {
          file: ssotFile(projectRoot),
          markdown: readText(ssotFile(projectRoot)) ?? "(not generated)",
        };
      },
    },
    {
      name: "read_syllabus",
      description: "Read the append-only syllabus for this project.",
      input: empty,
      run: (_input: any, context?: ToolContextLike) => {
        const projectRoot = rootFor(context);
        return {
          file: syllabusFile(projectRoot),
          markdown: readSyllabus(projectRoot) ?? "(not seeded)",
        };
      },
    },
    {
      name: "append_syllabus",
      description: "Append a lesson to the syllabus. Append-only: existing content is never modified.",
      input: {
        type: "object" as const,
        properties: { topic: { type: "string" }, summary: { type: "string" } },
        required: ["topic", "summary"],
        additionalProperties: false,
      },
      run: (input: any, context?: ToolContextLike) => {
        if (!input?.topic || !input?.summary) throw new Error("topic and summary are required");
        const topic = String(input.topic).trim();
        const summary = String(input.summary);
        if (/[\r\n]/.test(topic)) throw new Error("topic must be one line");
        // goal_contract open/close appends its own ledger blocks through the
        // function. Letting the generic lesson tool mint a "— result" heading
        // would let an agent write its own PASS without the permission door.
        if (
          /^Goal Contract\b/i.test(topic) ||
          summary
            .split(/\r?\n/)
            .some((line) => /^#{1,6}\s*Goal Contract\b/i.test(line.trim()))
        ) {
          throw new Error(
            "append_syllabus cannot write a Goal Contract block; goal_contract open/close owns that ledger",
          );
        }
        const projectRoot = rootFor(context);
        return appendSyllabus(projectRoot, topic, summary, auditFile(projectRoot));
      },
    },
    {
      name: "goal_contract",
      description:
        "Pre-register a task's expected outcome in the append-only syllabus BEFORE writing code, with the user's explicit consent. open refuses a second contract while one is open in this session, rejects a no-op check or a status-word expected, and runs the check once as a baseline after consent; a baseline that already passes writes no contract, because a check that passes before the work proves nothing. open needs the real user input, an observable expected output (not 'tests pass'), the check command, pass criteria and a match mode (contains|equals|regex|json); it shows a Bengali preview card in the session UI, then asks the user through the native permission door. In that dialog Allow once approves this goal, Allow always approves later opens in this project, and Reject writes nothing and returns status=rejected. close shows its own preview and asks again (per contract), then RUNS the recorded check command in the project root (120s cap) and matches the real output against the recorded expected value; PASS only when the exit code is 0 and the output matches. close proposes no saved pattern, so Allow always cannot skip the next close. Agent-supplied observed/exitCode are saved as a claim and never trusted. A mismatch, empty output or failed command is FAIL, so a mock cannot be tuned to the expected result afterwards. After a FAIL, a new contract may reuse the same check only with the same expected; a different expected is rejected as a rewrite (v2 contracts enforce this again at close). A FAIL result is fed into the same-agent circuit breaker; there is no delegation. Without an approval the tool writes and runs nothing; the agent must hand over instead of self-closing.",
      input: {
        type: "object" as const,
        properties: {
          action: { type: "string", enum: ["open", "close"] },
          id: { type: "string", description: "Contract id returned by open; required by close." },
          goal: { type: "string" },
          input: { type: "string", description: "Real user input: file path, URL, or exact request." },
          expected: { type: "string", description: "Observable outcome the user will see (status/body/file content)." },
          check: { type: "string", description: "Command that produces the observable outcome. close runs it." },
          pass: { type: "string", description: "Pass criteria." },
          match: {
            type: "string",
            enum: ["contains", "equals", "regex", "json"],
            description: "How close compares the real output with expected. Default contains.",
          },
          observed: { type: "string", description: "Actual output produced by the check." },
          exitCode: { type: "number" },
          artifact: { type: "string", description: "Path to the recorded output." },
        },
        required: ["action"],
        additionalProperties: false,
      },
      run: async (input: any, context?: ToolContextLike) => {
        const projectRoot = rootFor(context);
        const action = String(input?.action ?? "");
        const text = (key: string) => String(input?.[key] ?? "").trim();

        if (action === "open") {
          const goal = text("goal");
          const realInput = text("input");
          const expected = text("expected");
          const check = text("check");
          const pass = text("pass");
          const missing = [
            ["goal", goal],
            ["input", realInput],
            ["expected", expected],
            ["check", check],
            ["pass", pass],
          ]
            .filter(([, value]) => !value)
            .map(([name]) => name);
          if (missing.length > 0) {
            throw new Error(`goal_contract open is missing: ${missing.join(", ")}`);
          }
          // "tests pass" is a status, not an outcome. A mock can satisfy it.
          if (/^(?:tests?|suite|checks?)\s+(?:pass|passes|green|ok)\b/i.test(expected) || /^pass(?:ed)?$/i.test(expected)) {
            throw new Error(
              "expected must be an observable outcome (status/body/file content), not a test status",
            );
          }
          if (/[\r\n]/.test(expected) || /[\r\n]/.test(check)) {
            throw new Error("expected and check must be single-line; use a regex or a JSON token");
          }
          const mode = normalizeMatch(text("match"));
          const expectedError = validateExpected(expected, mode);
          if (expectedError) throw new Error(expectedError);
          const outcomeError = trivialExpected(expected, mode);
          if (outcomeError) throw new Error(outcomeError);
          const checkError = validateCheck(check);
          if (checkError) throw new Error(checkError);
          const sessionID = String(context?.sessionID ?? "").trim();
          const currentSyllabus = readSyllabus(projectRoot) ?? "";
          // One open contract per session. A second open is how an agent would
          // otherwise keep a fresh expectation ready for whatever the check prints.
          if (sessionID) {
            const active = (await deps.storage.get(`goal/active/${sessionID}`)) as { id?: string } | null | undefined;
            const alreadyOpen = active?.id || openContracts(currentSyllabus, sessionID)[0]?.id;
            if (alreadyOpen) {
              audit(projectRoot, "goal_contract", {
                kind: "goal_contract.duplicate_open",
                status: "rejected",
                sessionID,
                open: alreadyOpen,
                goal,
              });
              throw new Error(
                `goal_contract ${alreadyOpen} is already open for this session; close it with its recorded check before opening a new one`,
              );
            }
          }
          const rewrite = failedExpectedRewrite(currentSyllabus, { check, expected, match: mode });
          if (rewrite) {
            audit(projectRoot, "goal_contract", {
              kind: "goal_contract.rewrite_block",
              status: "rejected",
              prior: rewrite.id,
              check,
              priorExpected: rewrite.expected,
              expected,
            });
            throw new Error(
              `goal_contract open rejected: ${rewrite.id} already FAILED with the same check and a different expected (${rewrite.expected}). ` +
                "A FAIL verdict cannot be rewritten. Keep that expected and fix the real output, or use a different check command.",
            );
          }
          // Human-readable card: the user must see what the agent understood
          // before any code is written. Shown as a synthetic session message so
          // it appears in the UI, not only inside a file.
          const preview = [
            "🧭 কাজ শুরুর আগে — একবার মিলিয়ে নাও",
            "",
            `তুমি চাইছ: ${goal}`,
            `আসল ইনপুট: ${realInput}`,
            `আমি তোমাকে দেব: ${expected}`,
            `যাচাই: \`${check}\` → ${pass}`,
            `মিলানোর নিয়ম: ${mode}`,
            "",
            "খোলার আগে একবার baseline চালাব। ওটা pass করে ফেললে contract খুলব না — আগেই pass করা check কোনো কাজের প্রমাণ নয়।",
            "👍 permission dialog-এ: Allow once = শুধু এইবার; Allow always = এই প্রজেক্টে পরেরবার আর জিজ্ঞেস করব না; Reject = কিছুই লেখা হবে না।",
            "✋ ভুল মনে হলে Reject দাও; কোনো ফাইল লেখা হবে না, নতুন করে বলব।",
          ].join("\n");
          let uiShown = false;
          if (context?.sessionID && deps.synthetic) {
            try {
              await deps.synthetic({
                sessionID: String(context.sessionID),
                text: preview,
                description: "goal contract preview",
              });
              uiShown = true;
            } catch {
              uiShown = false;
            }
          }
          // The preview is an announcement, not consent. The user's answer is
          // collected through the native permission door; without it, nothing is
          // written and the agent must hand over.
          const approval = await ask(
            context,
            "goal_contract.open",
            [projectRoot],
            { goal, input: realInput, expected, check, pass, match: mode },
            [projectRoot],
          );
          if (!approval.ok) {
            audit(projectRoot, "goal_contract", {
              kind: "goal_contract.open",
              status: approval.status,
              goal,
              reason: approval.reason,
            });
            appendSyllabus(
              projectRoot,
              "Goal Contract — consent",
              [
                `- status: ${approval.status}`,
                ...(sessionID ? [`- session: ${sessionID}`] : []),
                `- goal: ${goal}`,
                `- reason: ${approval.reason}`,
                "",
                "Nothing was written and no check ran. The contract was not opened.",
              ].join("\n"),
              auditFile(projectRoot),
            );
            return {
              status: approval.status,
              wrote: false,
              uiShown,
              preview,
              reason: approval.reason,
              next: [
                ...(uiShown ? [] : ["Paste the preview above into the chat verbatim; the session UI did not show it."]),
                "Ask the user to rephrase the goal or hand over; do not retry the same goal silently.",
              ].join(" "),
            };
          }
          // A contract whose check already passes proves nothing: the agent
          // could open it after the fact and "close" without doing the work.
          // The baseline runs only after consent, and a passing baseline writes
          // no contract at all.
          const baseline = await runCheck(projectRoot, check, { timeoutMs: BASELINE_TIMEOUT_MS });
          const baselineOutput = baseline.stdout.trim() || baseline.stderr.trim();
          const baselinePasses =
            !baseline.timedOut &&
            !baseline.error &&
            baseline.exitCode === 0 &&
            baselineOutput.length > 0 &&
            matches(baselineOutput, expected, mode);
          if (baselinePasses) {
            audit(projectRoot, "goal_contract", {
              kind: "goal_contract.baseline_block",
              status: "rejected",
              goal,
              check,
              expected,
              exitCode: baseline.exitCode,
            });
            if (sessionID && deps.synthetic) {
              try {
                await deps.synthetic({
                  sessionID,
                  description: "goal contract baseline blocked",
                  text: [
                    "⛔ Ανακτήθηκε এই check আগেই pass করে",
                    "",
                    `চেক: \`${check}\``,
                    `পেলাম: ${oneLine(baselineOutput) || "(empty)"}`,
                    "",
                    "কাজ শুরুর আগেই প্রত্যাশা মিলে গেছে — এটা কোনো কাজের প্রমাণ নয়, তাই contract খোলা হয়নি।",
                    "আসল পরিবর্তনের পর যে check fail করে, সেটাই contract-এ দাও।",
                  ].join("\n"),
                });
              } catch {
                // The card is a courtesy; the refusal below is the gate.
              }
            }
            return {
              id: null,
              status: "already-passing",
              wrote: false,
              approved: true,
              ran: true,
              exitCode: baseline.exitCode,
              observed: baselineOutput,
              reason: "the check already passes before any work; a contract cannot prove a change it did not cause",
              next: "Tell the user the check already passes. Make the real change first, then open a contract with a check that fails now.",
            };
          }

          const id = `gc-${Date.now().toString(36)}`;
          const openedAt = new Date().toISOString();
          const summary = [
            `- status: open`,
            ...(sessionID ? [`- session: ${sessionID}`] : []),
            ...(sessionID ? [`- consent: approved (goal_contract.open)`] : []),
            `- goal: ${goal}`,
            `- input: ${realInput}`,
            `- expected: ${expected}`,
            `- check: \`${check}\``,
            `- pass: ${pass}`,
            `- match: ${mode}`,
            `- guard: v3`,
            `- baseline: failed (exit ${baseline.exitCode === null ? "none" : baseline.exitCode})`,
            `- baselineObserved: ${oneLine(baselineOutput) || "(empty)"}`,
          ].join("\n");
          const written = appendSyllabus(projectRoot, `Goal Contract ${id}`, summary, auditFile(projectRoot));
          // Storage is the short-lived marker: close refuses a v3 contract that
          // has no open marker, so a hand-written ledger block cannot become a
          // contract after the fact.
          await deps.storage.set(`goal/open/${id}`, {
            id,
            session: sessionID,
            goal,
            input: realInput,
            expected,
            check,
            pass,
            match: mode,
            guard: "v3",
            openedAt,
            baseline: {
              exitCode: baseline.exitCode,
              timedOut: baseline.timedOut,
              observed: oneLine(baselineOutput, 2000),
            },
          });
          if (sessionID) {
            await deps.storage.set(`goal/active/${sessionID}`, { id, goal, check, openedAt });
          }
          audit(projectRoot, "goal_contract", {
            kind: "goal_contract.open",
            status: "approved",
            id,
            goal,
            baselineExitCode: baseline.exitCode,
          });
          return {
            id,
            file: written.file,
            status: "open",
            approved: true,
            uiShown,
            preview,
            baseline: { exitCode: baseline.exitCode, observed: baselineOutput },
          };
        }

        if (action === "close") {
          const id = text("id");
          if (!id) throw new Error("goal_contract close needs the id returned by open");
          const syllabus = readSyllabus(projectRoot) ?? "";
          const contract = parseContract(syllabus, id);
          if (!contract) {
            throw new Error(`goal_contract ${id} was never opened; open it before closing`);
          }
          const mode = normalizeMatch(contract.match);
          const expectedError = validateExpected(contract.expected, mode);
          if (expectedError) {
            throw new Error(`goal_contract ${id} is invalid: ${expectedError}`);
          }
          const prior = contractStatus(syllabus, id);
          if (prior === "PASS") {
            return {
              id,
              status: "closed",
              ran: false,
              reason: "this contract already passed; a verdict cannot be overwritten",
              next: "Do not ask for consent again. Open a new contract for a new goal.",
            };
          }
          const sessionID = String(context?.sessionID ?? "").trim();
          // The open marker is the proof that this contract went through the
          // preview and the permission door. A ledger block written by hand is
          // not a contract; v2 blocks predate the marker and stay closable.
          const stored = (await deps.storage.get(`goal/open/${id}`)) as
            | { session?: string; check?: string; guard?: string; openedAt?: string }
            | null
            | undefined;
          if (contract.guard === "v3" && !stored) {
            audit(projectRoot, "goal_contract", {
              kind: "goal_contract.marker_block",
              status: "blocked",
              id,
              sessionID,
              reason: "no open marker",
            });
            throw new Error(
              `goal_contract ${id} has no open marker; it was not opened through the preview and permission door. Reopen it.`,
            );
          }
          if (stored?.session && sessionID && stored.session !== sessionID) {
            throw new Error(`goal_contract ${id} belongs to another session; open your own contract`);
          }
          if (stored?.check && normalizeCommand(stored.check) !== normalizeCommand(contract.check)) {
            audit(projectRoot, "goal_contract", {
              kind: "goal_contract.check_rewrite_block",
              status: "blocked",
              id,
              stored: stored.check,
              ledger: contract.check,
            });
            throw new Error(
              `goal_contract ${id} check changed after open; the recorded check is the only one close may run`,
            );
          }
          // Defense in depth: even if an open block predates the open guard, a
          // post-FAIL expected rewrite cannot be closed PASS.
          const rewrite = contract.guard
            ? failedExpectedRewrite(syllabus, {
                id,
                check: contract.check,
                expected: contract.expected,
                match: mode,
              })
            : null;
          if (rewrite) {
            audit(projectRoot, "goal_contract", {
              kind: "goal_contract.rewrite_block",
              status: "blocked",
              id,
              prior: rewrite.id,
              check: contract.check,
              priorExpected: rewrite.expected,
              expected: contract.expected,
            });
            let uiShown = false;
            if (sessionID && deps.synthetic) {
              try {
                await deps.synthetic({
                  sessionID,
                  description: "goal contract blocked",
                  text: [
                    `⛔ Goal Contract ${id} — blocked`,
                    "",
                    `আগের contract \`${rewrite.id}\` একই check দিয়ে FAIL হয়েছে (expected: ${rewrite.expected})।`,
                    `এখন expected বদলে \`${contract.expected}\` দেওয়া হয়েছে — এটা FAIL-এর ফল পুনর্লিখন।`,
                    "",
                    "contract খোলাই আছে। আসল output ঠিক করো, অথবা ভিন্ন check command দিয়ে নতুন contract খোলো।",
                  ].join("\n"),
                });
                uiShown = true;
              } catch {
                uiShown = false;
              }
            }
            return {
              id,
              status: "blocked",
              ran: false,
              uiShown,
              reason: `expected rewritten after ${rewrite.id} FAILED with the same check`,
              next: "Do not rewrite the expected value. Fix the real output under the recorded expectation, or open a new contract with a different check command.",
            };
          }
          // The user must see what will be executed before the native dialog.
          const closePreview = [
            "🧭 শেষ ধাপ — গোল বন্ধ করার আগে",
            "",
            `গোল: ${contract.goal}`,
            `আইডি: ${id}`,
            `যাচাই চলবে: \`${contract.check}\``,
            `প্রত্যাশা: ${contract.expected}`,
            `মিলানোর নিয়ম: ${mode}`,
            ...(stored?.openedAt ? [`খোলার সময়: ${stored.openedAt}`] : []),
            "",
            "👍 permission dialog-এ: Allow once = চেক চালাও; Allow always চাপলেও close-এর জন্য কিছু সেভ হয় না, পরের close-এ আবার জিজ্ঞেস করব; Reject = চেক চলবে না।",
            "✋ Reject দিলে contract খোলাই থাকবে, ফল লেখা হবে না।",
          ].join("\n");
          let previewShown = false;
          if (sessionID && deps.synthetic) {
            try {
              await deps.synthetic({
                sessionID,
                text: closePreview,
                description: "goal contract close preview",
              });
              previewShown = true;
            } catch {
              previewShown = false;
            }
          }
          // Closing is never self-service: the user approves this specific
          // contract id every time. `save: []` proposes no durable pattern, so
          // "Allow always" cannot skip the next close.
          const approval = await ask(
            context,
            "goal_contract.close",
            [id],
            { id, goal: contract.goal, expected: contract.expected, check: contract.check },
            [],
          );
          if (!approval.ok) {
            audit(projectRoot, "goal_contract", {
              kind: "goal_contract.close",
              status: approval.status,
              id,
              reason: approval.reason,
            });
            appendSyllabus(
              projectRoot,
              `Goal Contract ${id} — consent`,
              [
                `- status: ${approval.status}`,
                ...(sessionID ? [`- session: ${sessionID}`] : []),
                `- goal: ${contract.goal}`,
                `- reason: ${approval.reason}`,
                "",
                "The contract stays open. The check did not run.",
              ].join("\n"),
              auditFile(projectRoot),
            );
            return {
              id,
              status: approval.status,
              ran: false,
              uiShown: previewShown,
              preview: closePreview,
              reason: approval.reason,
              next: [
                ...(previewShown ? [] : ["Paste the close preview above into the chat verbatim; the session UI did not show it."]),
                "Hand over to the user; do not claim this task is done.",
              ].join(" "),
            };
          }
          // The agent's own numbers are a claim, not proof. The verdict comes
          // from running the recorded command in the project root.
          const run = await runCheck(projectRoot, contract.check, {
            timeoutMs: CHECK_TIMEOUT_MS,
          });
          const output = run.stdout.trim() || run.stderr.trim();
          let status: "PASS" | "FAIL" = "FAIL";
          let reason = "";
          if (run.timedOut) reason = `check timed out after ${CHECK_TIMEOUT_MS}ms`;
          else if (run.error) reason = `check could not start: ${run.error}`;
          else if (run.exitCode === null) reason = "check was killed before it exited";
          else if (run.exitCode !== 0) reason = `check exited with ${run.exitCode}`;
          else if (!output) reason = "check produced no output";
          else if (!matches(output, contract.expected, mode)) {
            reason = `observed output does not match expected (${mode})`;
          } else status = "PASS";

          const claimed = [
            text("observed") ? `claimObserved: ${text("observed").slice(0, 300)}` : "",
            typeof input?.exitCode === "number" ? `claimExitCode: ${input.exitCode}` : "",
          ].filter(Boolean);
          const artifact = text("artifact");
          const summary = [
            `- status: ${status}`,
            `- consent: approved (goal_contract.close)`,
            `- command: \`${contract.check}\``,
            `- exitCode: ${run.exitCode === null ? "none" : run.exitCode}`,
            `- observed: ${oneLine(output) || "(empty)"}`,
            `- expected: ${contract.expected}`,
            `- match: ${mode}`,
            ...(reason ? [`- reason: ${reason}`] : []),
            ...(stored ? [] : ["- legacy: true (v2 block without open marker)"]),
            ...claimed,
            ...(artifact ? [`- artifact: ${artifact}`] : []),
          ].join("\n");
          const written = appendSyllabus(projectRoot, `Goal Contract ${id} — result`, summary, auditFile(projectRoot));
          // The verdict is stored, not just written into a text file an agent
          // could later edit. The active marker clears only for this id.
          await deps.storage.set(`goal/result/${id}`, {
            id,
            status,
            exitCode: run.exitCode,
            observed: oneLine(output, 4000),
            expected: contract.expected,
            match: mode,
            reason: reason || undefined,
            legacy: !stored,
            closedAt: new Date().toISOString(),
          });
          if (sessionID) {
            const active = (await deps.storage.get(`goal/active/${sessionID}`)) as { id?: string } | null | undefined;
            // Real OpenCode storage rejects a null value (SQLite NOT NULL); write
            // a cleared marker without an id instead. open only reads `.id`.
            if (!active || active.id === id) {
              await deps.storage.set(`goal/active/${sessionID}`, { clearedAt: new Date().toISOString() });
            }
          }

          // The UI must show the verdict too, not only the file.
          let uiShown = false;
          if (sessionID && deps.synthetic) {
            try {
              await deps.synthetic({
                sessionID,
                description: "goal contract result",
                text: [
                  status === "PASS" ? `✅ Goal Contract ${id} — PASS` : `❌ Goal Contract ${id} — FAIL`,
                  "",
                  `চেক: \`${contract.check}\` → exit ${run.exitCode === null ? "none" : run.exitCode}`,
                  `expected: ${contract.expected}`,
                  `পেলাম: ${oneLine(output) || "(কোনো output নেই)"}`,
                  ...(reason ? [`কারণ: ${reason}`] : []),
                  "",
                  status === "PASS"
                    ? "প্রমাণ syllabus-এ লেখা হয়েছে।"
                    : "এটা PASS নয় — ফল বদলালে নতুন contract খোলো।",
                ].join("\n"),
              });
              uiShown = true;
            } catch {
              uiShown = false;
            }
          }
          return {
            id,
            file: written.file,
            status,
            exitCode: run.exitCode,
            observed: output,
            expected: contract.expected,
            match: mode,
            reason: reason || undefined,
            uiShown,
            previewShown,
          };
        }

        throw new Error("goal_contract action must be open or close");
      },
    },
    {
      name: "project_fingerprint",
      description: "Scan the project live and return its machine-readable fingerprint. No fingerprint file is created.",
      input: empty,
      run: (_input: any, context?: ToolContextLike) => scanProject(rootFor(context)),
    },
    {
      name: "design_sketch",
      description:
        "Optional lightweight sketch for a new screen or interaction flow. Small CSS/layout changes should be implemented directly without a sketch or full state matrix. Writes sketch.md and design.json; includes interaction states only when relevant. site: ecommerce | hospital | lms | generic.",
      input: {
        type: "object" as const,
        properties: {
          brief: { type: "string", description: "What the interface must do, in the user's words." },
          brand: { type: "string", description: "Site/brand name." },
          site: { type: "string", enum: ["ecommerce", "hospital", "lms", "generic"] },
          screens: { type: "array", items: { type: "string" }, description: "Screen names, primary first." },
          output: { type: "string", description: "Optional directory relative to the project root." },
        },
        required: ["brief"],
        additionalProperties: false,
      },
      run: (input: any, context?: ToolContextLike) => buildDesignSketch(rootFor(context), input ?? {}),
    },
    {
      name: "design_review",
      description:
        "Stitch stage 3: review real markup/CSS and return file:line findings for missing alt text, unnamed buttons, removed focus rings, missing lang/viewport, absent loading/empty/error/success states and missing design tokens. Regex heuristic, not a browser or contrast engine; high findings must be fixed before claiming the design is done.",
      input: {
        type: "object" as const,
        properties: {
          target: { type: "string", description: "File or directory relative to the project root. Default: '.'" },
        },
        additionalProperties: false,
      },
      run: (input: any, context?: ToolContextLike) => reviewDesign(rootFor(context), String(input?.target ?? ".")),
    },
    {
      name: "project_onboarding",
      description:
        "First-input project audit. Reads the tree, manifests, docs, tests, log files, open TODO/FIXME markers and recent audit failures; checks which stack skills are installed; appends ONE evidence lesson per file tree to the syllabus (idempotent by an onboarding:<hash> marker) and returns the evidence plus the manual checklist. Call it on the first user input of a session, then read the docs/code yourself, compare the user's expectation with the documented scope, append the human judgement with append_syllabus and install missing skills before the first goal_contract. The tool records facts; it cannot judge whether the docs are true.",
      input: empty,
      run: (_input: any, context?: ToolContextLike) => {
        const projectRoot = rootFor(context);
        const fingerprint = scanProject(projectRoot);
        const result = ensureOnboarding(projectRoot, fingerprint, { installRoot: deps.installRoot() });
        return {
          created: result.created,
          marker: result.marker,
          file: result.file,
          evidence: result.evidence,
          next: [
            "Read the docs and the code; the scanner cannot tell whether the docs are true.",
            "Record the user's expectation, contradictions and remaining gaps with append_syllabus.",
            "Install missing stack skills with skill_catalog, then open goal_contract for the user's approval.",
          ],
        };
      },
    },
    {
      name: "project_investigation",
      description:
        "Build a bounded, session-aware project map: current user intent and focus files, prior Git state, declared stack versions, installed compiler/runtime versions, official documentation links, tests, recent log errors, and prior tool failures. Records one deduplicated structured investigation in the syllabus. It never runs project build/test scripts; model training data remains UNVERIFIED unless the provider exposes auditable metadata.",
      input: {
        type: "object" as const,
        properties: { request: { type: "string", description: "The exact current user request." } },
        required: ["request"],
        additionalProperties: false,
      },
      run: (input: any, context?: ToolContextLike) =>
        buildProjectInvestigation(
          rootFor(context),
          String(input?.request ?? ""),
          String(context?.sessionID ?? ""),
        ),
    },
    {
      name: "context_status",
      description:
        "Optional detail lookup for the active agent and its context stewards: SSOT, syllabus, focus files and session memory. The compact context is already injected; call this only when more detail or a different focus query is needed. Pass `message` with the user's sentence to get the target file list.",
      input: {
        type: "object" as const,
        properties: {
          agent: { type: "string", description: "Agent id, when the caller knows it." },
          sessionID: { type: "string", description: "Session id, to include recent kept memory." },
          message: { type: "string", description: "The user's sentence, to resolve the focus file list." },
        },
        additionalProperties: false,
      },
      run: async (input: any, context?: ToolContextLike) => {
        const sessionID = String(input?.sessionID ?? context?.sessionID ?? "").trim();
        const projectRoot = deps.projectRoot(context?.sessionID || sessionID);
        const recent = sessionID ? await readRecent(deps.storage, sessionID) : [];
        const pack = buildContextPack(
          projectRoot,
          String(input?.agent ?? "unknown"),
          recent,
          String(input?.message ?? ""),
        );
        const run = sessionID ? await loadRun(deps.storage, sessionID) : null;
        return {
          uiLine: pack.uiLine,
          packBytes: pack.bytes,
          allowedRoot: pack.allowedRoot,
          ssot: pack.ssot,
          syllabus: pack.syllabus,
          ssotExcerptBytes: pack.ssotExcerptBytes,
          syllabusExcerptBytes: pack.syllabusExcerptBytes,
          focus: pack.focus,
          memory: pack.memory,
          route: run
            ? {
                routeKey: run.routeKey,
                taskKind: run.taskKind,
                phase: run.phase,
                contract: run.contract
                  ? { id: run.contract.id, status: run.contract.status }
                  : null,
                steps: run.steps.length,
              }
            : null,
        };
      },
    },
    {
      name: "evidence_gate",
      description:
        "Validate a response or factual claim before calling it PASS. Reuses the installed Python evidence gate; FAIL/SKIP means the claim must be reported as UNVERIFIED, the agent must stop, and the user must get a clear next-step message instead of a silent dead-end.",
      input: {
        type: "object" as const,
        properties: {
          file: { type: "string", description: "JSON payload path, relative to the working directory or absolute." },
          kind: {
            type: "string",
            enum: ["auto", "models", "chat", "stream", "responses", "anthropic", "tls", "claim"],
          },
          claim: { type: "string", description: "Inline factual claim; used when file is omitted." },
          evidence: {
            type: "array",
            description: "Inline evidence records for a claim: [{source, observation, verified}].",
            items: { type: "object" },
          },
        },
        required: [],
        additionalProperties: false,
      },
      run: (input: any, context?: ToolContextLike) => {
        const projectRoot = rootFor(context);
        const script = evidenceGateScript(projectRoot);
        if (!script) {
          throw new Error(
            "evidence_gate.py is not installed; run the ZombieCoder installer to copy runtime assets",
          );
        }
        let file: string;
        let ephemeral = false;
        const requested = String(input?.file ?? "").trim();
        if (requested) {
          file = path.isAbsolute(requested)
            ? requested
            : path.resolve(projectRoot, requested);
        } else if (String(input?.claim ?? "").trim()) {
          const dir = path.join(projectRoot, ".zombiecoder", ".state");
          fs.mkdirSync(dir, { recursive: true });
          file = path.join(dir, `evidence-gate-${process.pid}-${Date.now()}.json`);
          fs.writeFileSync(
            file,
            JSON.stringify({
              claim: String(input.claim),
              evidence: Array.isArray(input.evidence) ? input.evidence : [],
            }),
            { mode: 0o600 },
          );
          ephemeral = true;
        } else {
          throw new Error("file or claim is required");
        }
        if (!fs.existsSync(file)) throw new Error(`evidence payload not found: ${file}`);
        try {
          const kind = String(input?.kind ?? (ephemeral ? "claim" : "auto"));
          const result = spawnSync(
            "python3",
            [script, "--kind", kind, "--file", file, "--root", projectRoot],
            {
              encoding: "utf8",
              timeout: 30000,
              maxBuffer: 4 * 1024 * 1024,
            },
          );
          if (result.error) throw new Error(`evidence_gate failed: ${result.error.message}`);
          const stdout = String(result.stdout ?? "").trim();
          if (!stdout) {
            throw new Error(`evidence_gate returned no output (exit ${result.status ?? "unknown"})`);
          }
          try {
            return JSON.parse(stdout);
          } catch {
            throw new Error(`evidence_gate returned non-JSON output: ${stdout.slice(0, 200)}`);
          }
        } finally {
          if (ephemeral) {
            try {
              fs.unlinkSync(file);
            } catch {
              // best-effort cleanup of the ephemeral payload
            }
          }
        }
      },
    },
    {
      name: "verify_real",
      description:
        "Record provenance for a real-input check: hash the real input and the artifact produced from it, write .zombiecoder/verify/<id>.json, and return a claim-ready evidence object (origin real_run/real_file). It never runs a command and never invents proof: missing input, missing/empty artifact, a stand-in path, or an artifact older than the input returns NOT_TESTED with the next step.",
      input: {
        type: "object" as const,
        properties: {
          input: { type: "string", description: "Real input file inside the working directory." },
          artifact: { type: "string", description: "Log/report produced by running against that input." },
          command: { type: "string", description: "Exact command that produced the artifact." },
          origin: {
            type: "string",
            enum: ["real_run", "real_file"],
            description: "real_run for an execution, real_file for a read artifact.",
          },
        },
        required: ["input", "artifact"],
        additionalProperties: false,
      },
      run: (input: any, context?: ToolContextLike) => {
        const projectRoot = rootFor(context);
        const resolve = (value: string) => (path.isAbsolute(value) ? value : path.resolve(projectRoot, value));
        const inputPath = resolve(String(input?.input ?? ""));
        const artifactPath = resolve(String(input?.artifact ?? ""));
        const command = String(input?.command ?? "").trim();
        const origin = String(input?.origin ?? "real_run");
        if (origin !== "real_run" && origin !== "real_file") {
          throw new Error("origin must be real_run or real_file");
        }
        const insideRoot = (file: string) => {
          const rel = path.relative(projectRoot, file);
          return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
        };
        const notTested = (reason: string, next: string) => ({
          status: "NOT_TESTED" as const,
          reason,
          next,
          evidence: null,
        });

        if (!String(input?.input ?? "").trim() || !String(input?.artifact ?? "").trim()) {
          return notTested("input and artifact are required", "pass the real input path and the artifact it produced");
        }
        if (!fs.existsSync(inputPath)) {
          return notTested(`real input not found: ${inputPath}`, "supply the real file the user cares about");
        }
        if (!insideRoot(inputPath)) {
          return notTested(
            `real input is outside the working directory: ${inputPath}`,
            "copy it under the project root, or cite it directly with path:line",
          );
        }
        if (!fs.statSync(inputPath).isFile()) {
          return notTested(`real input is not a file: ${inputPath}`, "pass a concrete file, or a manifest file for a directory");
        }
        if (isStandInPath(inputPath, projectRoot)) {
          return notTested(
            `input is an explicit stand-in: ${inputPath}`,
            "use the real data, not a mock/fixture/demo",
          );
        }
        if (!fs.existsSync(artifactPath)) {
          return notTested(`artifact not found: ${artifactPath}`, "run the check against the real input and pass its output file");
        }
        if (!insideRoot(artifactPath)) {
          return notTested(
            `artifact is outside the working directory: ${artifactPath}`,
            "write the output under .zombiecoder/verify/",
          );
        }
        if (!fs.statSync(artifactPath).isFile()) {
          return notTested(`artifact is not a file: ${artifactPath}`, "pass the log/report file itself");
        }
        if (isStandInPath(artifactPath, projectRoot)) {
          return notTested(
            `artifact is an explicit stand-in: ${artifactPath}`,
            "the artifact must come from a real run, not a mock/fixture/demo",
          );
        }
        if (fs.statSync(artifactPath).size === 0) {
          return notTested(`artifact is empty: ${artifactPath}`, "re-run the check and capture its output");
        }

        const digest = (file: string) => {
          const stat = fs.statSync(file);
          return {
            path: file,
            bytes: stat.size,
            mtimeMs: stat.mtimeMs,
            sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
          };
        };
        const inputRecord = digest(inputPath);
        const artifactRecord = digest(artifactPath);
        if (artifactRecord.mtimeMs < inputRecord.mtimeMs) {
          return notTested(
            "artifact is older than the input",
            "re-run the check after the input changed and capture fresh output",
          );
        }

        const dir = path.join(projectRoot, ".zombiecoder", "verify");
        fs.mkdirSync(dir, { recursive: true });
        const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${inputRecord.sha256.slice(0, 8)}`;
        const recordFile = path.join(dir, `${id}.json`);
        const record = {
          status: "PASS",
          generatedAt: new Date().toISOString(),
          origin,
          command: command || null,
          projectRoot,
          input: inputRecord,
          artifact: artifactRecord,
        };
        fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), { mode: 0o600 });

        return {
          status: "PASS" as const,
          recordFile,
          evidence: {
            source: artifactPath,
            observation: `real_input=${inputPath} input_sha256=${inputRecord.sha256.slice(0, 12)} command=${command || "not recorded"} artifact_sha256=${artifactRecord.sha256.slice(0, 12)}`,
            verified: true,
            origin,
          },
        };
      },
    },
    {
      name: "memory_archive",
      description:
        "Read archived messages for a session. Read memory/index.json first to see every archive; this tool returns the actual rows.",
      input: {
        type: "object" as const,
        properties: {
          sessionID: { type: "string" },
          limit: { type: "number" },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
      run: (input: any, context?: ToolContextLike) => ({
        sessionID: input?.sessionID,
        entries: readArchive(
          rootFor(context),
          String(input?.sessionID ?? ""),
          input?.limit ?? 50,
        ),
      }),
    },
    {
      name: "syntax_check",
      description:
        "LSP-shaped syntax helper: return line/column diagnostics for a snippet before claiming it is valid. Uses JSON.parse, node --check, tsc, python3 compile, bash -n, php -l, then bracket balance.",
      input: {
        type: "object" as const,
        properties: {
          code: { type: "string", description: "Code snippet to check." },
          language: {
            type: "string",
            description: "Language or extension: javascript, typescript, python, bash, php, json, text.",
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
      run: async (input: any) => {
        const code = String(input?.code ?? "");
        if (!code.trim()) throw new Error("code is required");
        return syntaxCheck(code, String(input?.language ?? "text"));
      },
    },
    {
      name: "skill_catalog",
      description:
        "List or install shared runtime skills. The catalog covers Laravel, Node, Next, Python, FastAPI, cPanel, UI/UX, resource optimization, server operations, first-principles and evidence-before-confidence. Installing writes OpenCode's native global skill at <install>/skills/<name>/SKILL.md (name matches the folder, description 1-1024 chars) plus a legacy flat copy, so the skill loads in every working directory. When the user names a skill or domain, call action=install with its id: the file is fetched from the gate/git catalog if missing, written natively, and the skill registry reloads. action=auto detects the current project's stack and installs those ids.",
      input: {
        type: "object" as const,
        properties: {
          action: { type: "string", enum: ["list", "install", "auto"] },
          id: { type: "string", description: "Skill id for action=install." },
          ids: { type: "array", items: { type: "string" }, description: "Optional skill ids for action=auto." },
        },
        additionalProperties: false,
      },
      run: async (input: any, context?: ToolContextLike) => {
        const action = String(input?.action ?? "list");
        const installRoot = deps.installRoot();
        if (action === "list") return listSkillCatalog(installRoot);
        if (action === "auto") {
          const ids = Array.isArray(input?.ids)
            ? input.ids.map((value: any) => String(value)).filter(Boolean)
            : undefined;
          const result = await autoInstallSkills(installRoot, rootFor(context), { ids, download: true });
          await deps.reloadSkills?.();
          return result;
        }
        const id = String(input?.id ?? "").trim();
        if (!id) throw new Error("id is required for action=install");
        const result = await installSharedSkill(installRoot, id, { download: true });
        await deps.reloadSkills?.();
        return result;
      },
    },
    {
      name: "agent_modes",
      description:
        "OpenCode V2 agent modes. Lists the real modes (primary | subagent | all), the builtin agents, the caller's current mode, and plans a validated switch. Read-only: it writes nothing — apply the returned patch through zombiecoder/config.json agentModes and reload.",
      input: {
        type: "object" as const,
        properties: {
          agent: { type: "string", description: "Agent id to inspect, e.g. manu." },
          next: { type: "string", enum: ["primary", "subagent", "all"], description: "Requested mode for a switch plan." },
        },
        additionalProperties: false,
      },
      run: (input: any) => {
        const overrides = deps.agentModes?.() ?? {};
        const effective = applyModeOverrides(ROSTER, overrides);
        const agent = effective.agents.find((entry) => entry.id === String(input?.agent ?? ""));
        const next = String(input?.next ?? "").trim();
        const plan =
          agent && next
            ? planModeSwitch({ agent: { id: agent.id, mode: agent.mode }, next: next as AgentMode })
            : null;
        const changed = Boolean(plan?.ok && plan.changed);
        return {
          modes: AGENT_MODES.map((id) => MODE_REGISTRY[id]),
          builtins: BUILTIN_AGENTS,
          rejected: effective.rejected,
          agent: agent
            ? {
                id: agent.id,
                mode: agent.mode,
                configured: overrides[agent.id] ?? null,
              }
            : null,
          plan,
          apply:
            plan && changed
              ? {
                  file: "zombiecoder/config.json",
                  patch: { agentModes: plan.patch.agentModes },
                  frontmatter: plan.patch.frontmatter,
                }
              : null,
          reload: {
            required: changed,
            tool: "reload",
            target: "agents",
            fallback: "restart OpenCode",
          },
          note: changed
            ? `Nothing is written. Apply the config patch and frontmatter, then reload target=agents; until reload the current mode stays "${plan!.from}". Do not claim switched.`
            : plan?.ok
              ? `Already in mode "${plan.to}"; nothing to write or reload.`
              : "Mode is config-level. Apply the patch, then reload/restart; without reload the switch is UNVERIFIED.",
        };
      },
    },
    {
      name: "reload",
      description:
        "Reload one or all OpenCode doors after a persona, skill, provider or tool change: agents, skills, providers (provider + model catalogs), tools. Returns per-target ok/error; a door missing in this OpenCode version reports ok:false instead of pretending.",
      input: {
        type: "object" as const,
        properties: {
          target: { type: "string", enum: ["all", "agents", "skills", "providers", "tools"] },
        },
        additionalProperties: false,
      },
      run: async (input: any) => {
        const requested = String(input?.target ?? "all");
        const targets = requested === "all" ? ["agents", "skills", "providers", "tools"] : [requested];
        const doors: Record<string, (() => Promise<void>) | undefined> = {
          agents: deps.reloadAgents,
          skills: deps.reloadSkills,
          providers: deps.reloadProviders,
          tools: deps.reloadTools,
        };
        const results: { target: string; ok: boolean; error?: string }[] = [];
        for (const target of targets) {
          const door = doors[target];
          if (!door) {
            results.push({ target, ok: false, error: "door not available in this OpenCode version" });
            continue;
          }
          try {
            await door();
            results.push({ target, ok: true });
          } catch (error) {
            results.push({ target, ok: false, error: String(error) });
          }
        }
        return { ok: results.every((entry) => entry.ok), results };
      },
    },
    {
      name: "http_probe",
      description:
        "Call an HTTP endpoint and return status, redacted response headers, byte count, body sha256 and a bounded body preview. Redirects are not followed, so a 3xx stays visible.",
      input: {
        type: "object" as const,
        properties: {
          url: { type: "string" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
          headers: { type: "object", additionalProperties: { type: "string" } },
          body: { type: "string" },
          timeout_ms: { type: "number" },
        },
        required: ["url"],
        additionalProperties: false,
      },
      run: async (input: any) => {
        const raw = String(input?.url ?? "").trim();
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          throw new Error("url must be an absolute http(s) URL");
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("url must be http or https");
        const method = String(input?.method ?? "GET").toUpperCase();
        const headers: Record<string, string> = {};
        if (input?.headers && typeof input.headers === "object" && !Array.isArray(input.headers)) {
          for (const [key, value] of Object.entries(input.headers)) headers[key] = String(value);
        }
        const timeout = Math.min(Math.max(Number(input?.timeout_ms ?? 10_000), 1_000), 30_000);
        const started = Date.now();
        let response: Awaited<ReturnType<typeof fetch>>;
        try {
          response = await fetch(url, {
            method,
            headers,
            body: method === "GET" || method === "HEAD" ? undefined : input?.body,
            redirect: "manual",
            signal: AbortSignal.timeout(timeout),
          });
        } catch (error) {
          return { url: url.toString(), method, ok: false, duration_ms: Date.now() - started, error: String(error) };
        }
        const body = Buffer.from(await response.arrayBuffer());
        const secretHeader = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = secretHeader.test(key) ? "<redacted>" : value;
        });
        const text = body.toString("utf8");
        return {
          url: url.toString(),
          method,
          status: response.status,
          ok: response.ok,
          duration_ms: Date.now() - started,
          bytes: body.length,
          sha256: createHash("sha256").update(body).digest("hex"),
          headers: responseHeaders,
          body_preview: text.slice(0, 2000),
          body_truncated: text.length > 2000,
        };
      },
    },
    {
      name: "patch_preview",
      description:
        "Dry-run one exact-string replacement: counts matches and shows the changed lines. It writes only when apply=true, and copies the original into .zombiecoder/.state/backups first.",
      input: {
        type: "object" as const,
        properties: {
          file: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          apply: { type: "boolean" },
        },
        required: ["file", "old_string", "new_string"],
        additionalProperties: false,
      },
      run: (input: any, context?: ToolContextLike) => {
        const projectRoot = rootFor(context);
        const target = resolveAllowedPath(projectRoot, String(input?.file ?? ""));
        if (!target) {
          return { file: String(input?.file ?? ""), matches: 0, applied: false, error: "path outside the allowed root" };
        }
        const oldString = String(input?.old_string ?? "");
        const newString = String(input?.new_string ?? "");
        if (!oldString) return { file: target, matches: 0, applied: false, error: "old_string is required" };
        const before = readText(target);
        if (before === undefined) return { file: target, matches: 0, applied: false, error: "file not readable" };
        const first = before.indexOf(oldString);
        const second = first < 0 ? -1 : before.indexOf(oldString, first + oldString.length);
        if (first < 0 || second >= 0) {
          return {
            file: target,
            matches: first < 0 ? 0 : 2,
            applied: false,
            error: first < 0 ? "old_string not found" : "old_string matches more than once",
          };
        }
        const oldLines = oldString.split("\n");
        const newLines = newString.split("\n");
        const diff = [...oldLines.map((line) => "- " + line), ...newLines.map((line) => "+ " + line)];
        let backup: string | undefined;
        if (input?.apply === true) {
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          backup = path.join(projectRoot, ".zombiecoder", ".state", "backups", `${stamp}-${path.basename(target)}`);
          ensureDir(path.dirname(backup));
          fs.copyFileSync(target, backup);
          writeAtomic(target, before.slice(0, first) + newString + before.slice(first + oldString.length));
        }
        return {
          file: target,
          matches: 1,
          applied: input?.apply === true,
          backup,
          additions: newLines.length,
          deletions: oldLines.length,
          diff: diff.slice(0, 80),
          diff_truncated: diff.length > 80,
        };
      },
    },
    {
      name: "env_get",
      description:
        "Check whether an environment variable exists without revealing it: presence, length, a short sha256 fingerprint and a placeholder hint. The value is never returned.",
      input: {
        type: "object" as const,
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
      run: (input: any) => {
        const name = String(input?.name ?? "").trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("name must be a valid environment variable name");
        const value = process.env[name];
        if (value === undefined) return { name, present: false };
        return {
          name,
          present: true,
          length: value.length,
          sha256_12: createHash("sha256").update(value).digest("hex").slice(0, 12),
          placeholder: /^(changeme|change-me|todo|example|xxx+|your[-_].*)$/i.test(value.trim()),
        };
      },
    },
    {
      name: "service_probe",
      description:
        "Probe a service: TCP connect by default, or an HTTP GET when path is given. Returns reachability, duration and, for HTTP, status, byte count and body sha256.",
      input: {
        type: "object" as const,
        properties: {
          host: { type: "string" },
          port: { type: "number" },
          path: { type: "string" },
          timeout_ms: { type: "number" },
        },
        required: ["port"],
        additionalProperties: false,
      },
      run: async (input: any) => {
        const host = String(input?.host ?? "127.0.0.1").trim();
        const port = Number(input?.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be an integer 1-65535");
        const timeout = Math.min(Math.max(Number(input?.timeout_ms ?? 3_000), 500), 15_000);
        if (input?.path !== undefined) {
          const rawPath = String(input.path);
          const suffix = rawPath.startsWith("/") ? rawPath : "/" + rawPath;
          const hostPart = host.includes(":") ? `[${host}]` : host;
          const started = Date.now();
          try {
            const response = await fetch(`http://${hostPart}:${port}${suffix}`, {
              redirect: "manual",
              signal: AbortSignal.timeout(timeout),
            });
            const body = Buffer.from(await response.arrayBuffer());
            return {
              host,
              port,
              path: suffix,
              reachable: true,
              duration_ms: Date.now() - started,
              http: {
                status: response.status,
                ok: response.ok,
                bytes: body.length,
                sha256: createHash("sha256").update(body).digest("hex"),
              },
            };
          } catch (error) {
            return { host, port, path: suffix, reachable: false, duration_ms: Date.now() - started, error: String(error) };
          }
        }
        const started = Date.now();
        return await new Promise<Record<string, unknown>>((resolve) => {
          const socket = net.createConnection({ host, port });
          let settled = false;
          const finish = (result: Record<string, unknown>) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve({ host, port, duration_ms: Date.now() - started, ...result });
          };
          socket.setTimeout(timeout);
          socket.once("connect", () => finish({ reachable: true }));
          socket.once("timeout", () => finish({ reachable: false, error: "timeout" }));
          socket.once("error", (error) => finish({ reachable: false, error: String(error) }));
        });
      },
    },
  ];
}

export type ToolRegistration = {
  /** Always empty at registration time; the transform applies after setup returns. */
  registered: string[];
  /** Resolves with what the deferred transform actually applied. */
  applied: Promise<{ registered: string[]; error?: string }>;
  release: () => Promise<void>;
};

export function registerTools(tool: ToolLike | undefined, deps: SurfaceDeps): ToolRegistration {
  if (!tool || typeof tool.transform !== "function") {
    return {
      registered: [],
      applied: Promise.resolve({ registered: [], error: "ctx.tool not available" }),
      release: async () => undefined,
    };
  }
  const specs = toolSpecs(deps);
  // Every ZombieCoder tool returns a JSON object. Declaring the output schema is
  // not optional: OpenCode rejects a result that carries `output` without one.
  const output = { type: "object" as const, additionalProperties: true };
  const kept = keepTransform<any, string[]>(tool as TransformDoor<any>, (editor: any) => {
    const added: string[] = [];
    editor?.namespace?.(TOOL_NAMESPACE);
    const existing = new Set<string>((editor.list?.() ?? []).map((entry: any) => entry?.name).filter(Boolean));
    for (const spec of specs) {
      // OpenCode re-runs transforms on reload. Do not add the same tool twice.
      if (existing.has(spec.name)) {
        added.push(spec.name);
        continue;
      }
      editor.add({
        name: spec.name,
        description: spec.description,
        input: spec.input,
        output,
        options: { namespace: TOOL_NAMESPACE.name },
        execute: async (input: any, context?: ToolContextLike) => {
          // JSON has no `undefined`. A result such as
          // { id, file, copied, error: undefined } is a valid JS object but an
          // invalid JSON value; OpenCode's output-schema check rejects it.
          const result = await spec.run(input, context);
          return {
            output: JSON.parse(JSON.stringify(result ?? {})),
            metadata: { source: "zombiecoder", tool: spec.name },
          };
        },
      });
      added.push(spec.name);
    }
    return added;
  });

  const applied = kept.first.then(async (value) => {
    // Only the first apply triggers a reload; later invocations are re-applies.
    if (value !== null) {
      try {
        await tool.reload?.();
      } catch {
        /* reload is a convenience, not the registration itself */
      }
    }
    return {
      registered: value ?? [],
      error: value === null ? kept.error() ?? "tool transform callback did not fire" : kept.error(),
    };
  });

  return { registered: [], applied, release: kept.release };
}

// Audit append is the one thing every surface shares. It lives under .state so
// the project root stays focused on SSOT, syllabus and memory.
export function audit(projectRoot: string, agentID: string, record: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), agent: agentID, ...record };
  appendJsonl(auditFile(projectRoot), redactValue(entry));
}
