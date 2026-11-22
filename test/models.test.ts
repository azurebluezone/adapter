import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  assignModels,
  extractBaseUrl,
  freeModels,
  MAIN_AGENT_ID,
  modelRef,
  modelsUrl,
  probeOpenAiCompatible,
  normalizeModelRef,
  readCatalog,
  resolveModels,
  stableHash,
  type Catalog,
} from "../src/zombie/models.ts";
import { ROSTER } from "../src/roster.ts";

function withServer<T>(handler: http.RequestListener, run: (base: string) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      try {
        resolve(await run(base));
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

test("stableHash is deterministic", () => {
  assert.equal(stableHash("manu"), stableHash("manu"));
  assert.notEqual(stableHash("manu"), stableHash("jarin"));
});

test("assignModels keeps the main agent unpinned and syncs a distinct model to every subagent", () => {
  const candidates = Array.from({ length: 10 }, (_, index) => `a/m${index + 1}`);
  const assigned = assignModels(ROSTER, candidates, false, Math.random, "a/m1");
  assert.equal(assigned[MAIN_AGENT_ID], "", "the main agent keeps the UI-selected model");
  const subagents = Object.entries(assigned).filter(([id]) => id !== MAIN_AGENT_ID);
  assert.equal(subagents.length, ROSTER.length - 1);
  const refs = subagents.map(([, ref]) => ref);
  assert.equal(new Set(refs).size, refs.length, "every subagent gets its own model while the pool lasts");
  assert.ok(!refs.includes("a/m1"), "the owner's UI model is not reused for subagents");
  for (const ref of refs) assert.ok(candidates.includes(ref));
});

test("assignModels is deterministic and only shuffles when asked", () => {
  const candidates = ["a/1", "b/2", "c/3"];
  assert.deepEqual(assignModels(ROSTER, candidates), assignModels(ROSTER, candidates));
  const first = assignModels(ROSTER, candidates, true, () => 0);
  const second = assignModels(ROSTER, candidates, true, () => 0);
  assert.deepEqual(first, second, "an injected random source must be reproducible");
  for (const ref of Object.values(first)) if (ref) assert.ok(candidates.includes(ref));
});

test("assignModels wraps when the catalog is smaller than the roster", () => {
  const assigned = assignModels(ROSTER, ["a/1", "b/2"], false, Math.random, "a/1");
  const refs = Object.entries(assigned)
    .filter(([id]) => id !== MAIN_AGENT_ID)
    .map(([, ref]) => ref);
  assert.deepEqual([...new Set(refs)].sort(), ["b/2"]);
  assert.equal(assigned[MAIN_AGENT_ID], "");
});

test("assignModels leaves every agent unpinned when no model ref is available", () => {
  const assigned = assignModels(ROSTER, []);
  assert.equal(assigned.manu, "");
  assert.equal(assigned[MAIN_AGENT_ID], "");
  assert.equal(new Set(Object.values(assigned)).size, 1);
});

test("random assignment still spawns no duplicate subagent model while the pool lasts", () => {
  const candidates = ["a/1", "b/2", "c/3"];
  const assigned = assignModels(ROSTER, candidates, true, () => 0.5);
  assert.equal(assigned[MAIN_AGENT_ID], "");
  const refs = Object.entries(assigned).filter(([id]) => id !== MAIN_AGENT_ID).map(([, ref]) => ref);
  assert.equal(refs.length, ROSTER.length - 1);
  assert.equal(new Set(refs).size, candidates.length, "the pool is exhausted before any model repeats");
});

test("free strategy syncs one distinct OpenCode free model to each subagent", async () => {
  const free = Array.from({ length: 10 }, (_, index) => ({
    providerID: "opencode",
    modelID: `free-${index}`,
    cost: [{ input: 0, output: 0 }],
    status: "active",
    capabilities: { tools: true },
    enabled: true,
  }));
  const plan = await resolveModels(
    {
      provider: { list: async () => ({ data: [] }) },
      model: {
        list: async () => ({ data: free }),
        default: async () => ({ data: { providerID: "opencode", modelID: "free-0" } }),
      },
    },
    ROSTER,
    { customProviderUrl: "", strategy: "free" },
  );
  assert.equal(plan.strategy, "free-fallback");
  assert.equal(plan.candidates.length, 10);
  assert.equal(plan.assignment[MAIN_AGENT_ID], "", "the main agent follows the UI model");
  const refs = Object.values(plan.assignment).filter(Boolean);
  assert.equal(refs.length, ROSTER.length - 1);
  assert.equal(new Set(refs).size, refs.length, "subagents are spread across distinct free models");
  assert.ok(!refs.includes("opencode/free-0"), "the UI default model is not assigned to subagents");
});

test("freeModels keeps only cost 0/0 active models", () => {
  const catalog: Catalog = {
    providers: [],
    models: [
      { ref: "a/free", providerID: "a", modelID: "free", inputCost: 0, outputCost: 0, status: "active", tools: true, enabled: true },
      { ref: "a/paid", providerID: "a", modelID: "paid", inputCost: 1, outputCost: 1, status: "active", tools: true, enabled: true },
      { ref: "a/off", providerID: "a", modelID: "off", inputCost: 0, outputCost: 0, status: "active", tools: true, enabled: false },
      { ref: "a/notext", providerID: "a", modelID: "notext", inputCost: 0, outputCost: 0, status: "active", tools: false, enabled: true },
    ],
  };
  assert.deepEqual(freeModels(catalog).map((m) => m.ref), ["a/free"]);
});

test("modelsUrl handles base and /v1 URLs", () => {
  assert.equal(modelsUrl("https://x.test"), "https://x.test/v1/models");
  assert.equal(modelsUrl("https://x.test/v1/"), "https://x.test/v1/models");
});

test("modelRef never builds provider/undefined", () => {
  assert.equal(modelRef("gateway", "m1"), "gateway/m1");
  assert.equal(modelRef("gateway", undefined), null);
  assert.equal(modelRef("gateway", ""), null);
  assert.equal(modelRef("", "m1"), null);
});

test("readCatalog reads provider.list and model.list", async () => {
  const catalog = await readCatalog({
    provider: { list: async () => ({ data: [{ id: "custom", name: "Custom", settings: { baseURL: "https://api.test/v1" } }] }) },
    model: {
      list: async () => ({
        data: [
          { providerID: "custom", modelID: "m1", cost: [{ input: 0, output: 0 }], status: "active", capabilities: { tools: true }, enabled: true },
        ],
      }),
    },
  });
  assert.equal(catalog.providers.length, 1);
  assert.equal(extractBaseUrl({ settings: { baseURL: "https://api.test/v1" } }), "https://api.test/v1");
  assert.equal(catalog.models[0].ref, "custom/m1");
});

test("probeOpenAiCompatible accepts a data[] list without object:list", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "live-model" }] }));
    },
    async (base) => {
      const result = await probeOpenAiCompatible(base, 2000);
      assert.equal(result.ok, true);
      assert.deepEqual(result.models, ["live-model"]);
    },
  );
});

test("probeOpenAiCompatible sends the configured bearer key", async () => {
  let authorization = "";
  await withServer(
    (req, res) => {
      authorization = String(req.headers.authorization ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "secured-model" }] }));
    },
    async (base) => {
      const result = await probeOpenAiCompatible(base, 2000, "secret-key");
      assert.equal(result.ok, true);
      assert.deepEqual(result.models, ["secured-model"]);
    },
  );
  assert.equal(authorization, "Bearer secret-key");
});

test("probeOpenAiCompatible reports HTTP failures", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(503).end("nope");
    },
    async (base) => {
      const result = await probeOpenAiCompatible(base, 2000);
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /503/);
    },
  );
});

test("resolveModels uses the live probe when the provider is configured but not yet in the catalog", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "probe-model" }] }));
    },
    async (base) => {
      const plan = await resolveModels(
        {
          provider: { list: async () => ({ data: [] }) },
          model: { list: async () => ({ data: [] }), default: async () => ({ data: null }) },
        },
        ROSTER,
        { customProviderUrl: base, customProviderID: "gateway", providerConfigured: true, probeTimeoutMs: 2000 },
      );
      assert.equal(plan.strategy, "custom-provider");
      assert.deepEqual(plan.candidates, ["gateway/probe-model"]);
    },
  );
});

test("resolveModels falls back to free models when no custom provider is configured", async () => {
  const plan = await resolveModels(
    {
      provider: { list: async () => ({ data: [] }) },
      model: {
        list: async () => ({
          data: [
            { providerID: "opencode", modelID: "big-pickle", cost: [{ input: 0, output: 0 }], status: "active", enabled: true },
          ],
        }),
        default: async () => ({ data: { providerID: "opencode", modelID: "big-pickle" } }),
      },
    },
    ROSTER,
    { customProviderUrl: "" },
  );
  assert.equal(plan.strategy, "free-fallback");
  assert.deepEqual(plan.candidates, ["opencode/big-pickle"]);
  assert.deepEqual(plan.freeRefs, ["opencode/big-pickle"], "cost 0/0 refs are the free evidence");
  assert.deepEqual(plan.localProviders, [], "no local baseURL in this catalog");
});

test("resolveModels records local providers as runner-identity evidence", async () => {
  const plan = await resolveModels(
    {
      provider: {
        list: async () => ({
          data: [{ id: "ollama", settings: { baseURL: "http://127.0.0.1:11434/v1" } }],
        }),
      },
      model: {
        list: async () => ({
          data: [
            {
              providerID: "ollama",
              modelID: "llama3",
              cost: [{ input: 0, output: 0 }],
              status: "active",
              enabled: true,
            },
          ],
        }),
      },
    },
    ROSTER,
    { customProviderUrl: "", strategy: "free" },
  );
  assert.deepEqual(plan.localProviders, [
    { providerID: "ollama", baseURL: "http://127.0.0.1:11434/v1" },
  ]);
  assert.deepEqual(plan.freeRefs, ["ollama/llama3"]);
});

test("a non-reference baselineModel never turns the roster baseline into a pin", async () => {
  const plan = await resolveModels(
    {
      provider: { list: async () => ({ data: [] }) },
      model: {
        list: async () => ({
          data: [
            { providerID: "opencode", modelID: "big-pickle", cost: [{ input: 0, output: 0 }], status: "active", enabled: true },
            { providerID: "opencode", modelID: "second-free", cost: [{ input: 0, output: 0 }], status: "active", enabled: true },
          ],
        }),
        default: async () => ({ data: { providerID: "opencode", modelID: "big-pickle" } }),
      },
    },
    ROSTER,
    { customProviderUrl: "", strategy: "free", baselineModel: "inherit" },
  );
  assert.equal(plan.strategy, "free-fallback");
  assert.deepEqual(plan.candidates, ["opencode/big-pickle", "opencode/second-free"]);
  assert.equal(plan.assignment[MAIN_AGENT_ID], "", "the UI/default model stays with the main agent");
  const refs = [...new Set(Object.values(plan.assignment).filter(Boolean))];
  assert.deepEqual(refs, ["opencode/second-free"], "subagents take the remaining catalog model");
  assert.equal(normalizeModelRef("inherit"), null);
  assert.equal(normalizeModelRef("opencode/big-pickle"), "opencode/big-pickle");
  assert.equal(normalizeModelRef("/model"), null);
  assert.equal(normalizeModelRef("provider/"), null);
});

test("resolveModels respects modelStrategy: free without probing the custom provider", async () => {
  let requests = 0;
  await withServer(
    (_req, res) => {
      requests += 1;
      res.end(JSON.stringify({ data: [{ id: "should-not-be-used" }] }));
    },
    async (base) => {
      const plan = await resolveModels(
        {
          provider: { list: async () => ({ data: [] }) },
          model: {
            list: async () => ({
              data: [
                { providerID: "opencode", modelID: "free-one", cost: [{ input: 0, output: 0 }], status: "active", enabled: true },
                { providerID: "opencode", modelID: "free-z-default", cost: [{ input: 0, output: 0 }], status: "active", enabled: true },
              ],
            }),
            default: async () => ({ data: { providerID: "opencode", modelID: "free-z-default" } }),
          },
        },
        ROSTER,
        { customProviderUrl: base, strategy: "free" },
      );
      assert.equal(plan.strategy, "free-fallback");
      assert.deepEqual(plan.candidates, ["opencode/free-one", "opencode/free-z-default"]);
      assert.equal(plan.assignment[MAIN_AGENT_ID], "", "the UI model is not pinned on the main agent");
      const refs = [...new Set(Object.values(plan.assignment).filter(Boolean))];
      assert.deepEqual(refs, ["opencode/free-one"], "subagents use the remaining free model");
    },
  );
  assert.equal(requests, 0, "strategy=free must not call the custom provider");
});

test("resolveModels respects modelStrategy: baseline without probing", async () => {
  const plan = await resolveModels(
    { provider: { list: async () => ({ data: [] }) }, model: { list: async () => ({ data: [] }) } },
    ROSTER,
    { customProviderUrl: "http://127.0.0.1:9/v1", strategy: "baseline", baselineModel: "opencode/big-pickle" },
  );
  assert.equal(plan.strategy, "baseline");
  assert.deepEqual(plan.candidates, ["opencode/big-pickle"]);
  assert.equal(plan.probe.ok, false);
});

test("resolveModels treats an empty /models list as unusable and prefers free models", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [] }));
    },
    async (base) => {
      const plan = await resolveModels(
        {
          provider: { list: async () => ({ data: [] }) },
          model: {
            list: async () => ({
              data: [
                { providerID: "opencode", modelID: "free-empty-fallback", cost: [{ input: 0, output: 0 }], status: "active", enabled: true },
              ],
            }),
          },
        },
        ROSTER,
        { customProviderUrl: base, providerConfigured: true, strategy: "auto" },
      );
      assert.equal(plan.strategy, "free-fallback");
      assert.deepEqual(plan.candidates, ["opencode/free-empty-fallback"]);
    },
  );
});

test("resolveModels sends the provider key while probing", async () => {
  let authorization = "";
  await withServer(
    (req, res) => {
      authorization = String(req.headers.authorization ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "keyed-model" }] }));
    },
    async (base) => {
      const plan = await resolveModels(
        { provider: { list: async () => ({ data: [] }) }, model: { list: async () => ({ data: [] }) } },
        ROSTER,
        {
          customProviderUrl: base,
          customProviderID: "gateway",
          providerConfigured: true,
          customProviderApiKey: "gateway-key",
        },
      );
      assert.equal(plan.strategy, "custom-provider");
      assert.deepEqual(plan.candidates, ["gateway/keyed-model"]);
    },
  );
  assert.equal(authorization, "Bearer gateway-key");
});

test("resolveModels with strategy custom never assigns a dead provider", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(503).end("down");
    },
    async (base) => {
      const plan = await resolveModels(
        { provider: { list: async () => ({ data: [] }) }, model: { list: async () => ({ data: [] }) } },
        ROSTER,
        { customProviderUrl: base, providerConfigured: true, strategy: "custom", baselineModel: "opencode/big-pickle" },
      );
      assert.equal(plan.strategy, "baseline");
      assert.deepEqual(plan.candidates, ["opencode/big-pickle"]);
    },
  );
});
