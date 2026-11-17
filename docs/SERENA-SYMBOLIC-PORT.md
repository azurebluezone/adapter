# Serena → ZombieCoder: Symbolic Tool Port ও Audio MCP নকশা

**তারিখ:** 2026-11-18  
**লক্ষ্য:** Serena-র ৫৩টি টুল থেকে কেবল দরকারি symbolic অংশ `/home/sahon/adapter` প্লাগিনে নেওয়া, Serena বাদ দেওয়া, আর edge-tts দিয়ে একটি audio MCP-র নকশা।  
**অবস্থা:** ডিজাইন (কোড লেখা হয়নি)। প্রতিটি দাবির পাশে লেবেল: `LIVE_PROBE_PASSED` = এই মেশিনে চালিয়ে দেখা, `SOURCE_VERIFIED` = ফাইল/ডকুমেন্টে আছে, `UNVERIFIED` = যাচাই হয়নি।

---

## ১. নির্বাহী সিদ্ধান্ত

1. Serena-র **symbol engine** ধারণাটি নিই, **কোড নিই না** (লাইসেন্স, §৮)।
2. পোর্ট হবে **৪টি read-only টুল P0** + **১টি diagnostics**, তারপর **rename** ও **symbol edit** P1।
3. OpenCode V2.2.3-এ LSP runtime **আছে** (৭টি server configured, initialize 7/7 pass) কিন্তু session catalog-এ **`lsp` tool নেই** — তাই নতুন LSP engine নয়, **বিদ্যমান LSP-কে tool হিসেবে খোলাই** আসল কাজ।
4. OpenCode **অডিও ইনপুট সাপোর্ট করে না** (audio attachment model-এ যায় না)। তাই audio MCP হবে **ফাইল-জেনারেটর**, কথা বলার চ্যানেল নয়।
5. edge-tts লোকালে ইনস্টল আছে (`7.3.1`, `/home/sahon/.local/bin/edge-tts`) — audio MCP আলাদা stdio server হিসেবে, প্লাগিন core-এ নয়।

---

## ২. প্রমাণভিত্তি

| প্রমাণ | ফল | লেবেল |
|---|---|---|
| OpenCode version | `2.2.3`, `opencode-cli --version` | `LIVE_PROBE_PASSED` (adapter `docs/LSP.md`) |
| LSP server configured | `typescript`, `python`, `bash`, `json`, `css`, `html`, `markdown` — ৭টি | `CONFIG_VALIDATED` |
| LSP initialize probe | ৭/৭ ok (TS 172ms, python 246ms, bash 392ms) | `LIVE_PROBE_PASSED` |
| Direct diagnostics probe | `typescript-language-server` child, real `TS2322` | `LIVE_PROBE_PASSED` |
| Session catalog-এ `lsp` tool | ৮৫টি tool, `lsp` **শূন্য** | `SOURCE_VERIFIED` |
| OpenCode-managed edit diagnostics | ৪ সেকেন্ড watch-এ কোনো event নেই | `NOT_TESTED` |
| Serena installed | `2.1.0`, uv tool env, ১০৫ MB | `LIVE_PROBE_PASSED` |
| Serena exposed tools (REPL) | ৫৩ loaded → **৩ exposed** | `LIVE_PROBE_PASSED` (log) |
| Serena লাইসেন্স | app `GPL-3.0-or-later`, `solidlsp` `MIT` | `SOURCE_VERIFIED` |
| adapter লাইসেন্স | custom non-commercial (`Local Freedom`) | `SOURCE_VERIFIED` |
| OpenCode audio attachment | model request-এ **পাঠায় না** | `SOURCE_VERIFIED` (docs) |
| edge-tts | `7.3.1`, LGPLv3, Python ≥3.7 | `LIVE_PROBE_PASSED` |

**মূল অন্তর্দৃষ্টি:** OpenCode-এ LSP নেই বলে যে ধারণা, তা ভুল। LSP আছে, কিন্তু agent-এর হাতে **symbol-প্রশ্ন করার tool নেই**। তাই কাজটি ছোট: server spawn নয়, **tool surface**।

---

## ৩. Serena-র ৫৩ টুল → সিদ্ধান্ত

### ৩.১ পোর্ট হবে (symbolic core)

| Serena tool | কেন দরকার | OpenCode-এ বর্তমান বিকল্প | সিদ্ধান্ত | অগ্রাধিকার |
|---|---|---|---|---|
| `get_symbols_overview` | পুরো ফাইল না পড়ে outline; টোকেন সাশ্রয় | `read` (পুরো ফাইল), `grep` | পোর্ট | P0 |
| `find_symbol` | নাম/নেম-পাথ ধরে symbol খোঁজা | `grep` (নাম-ভিত্তিক, semantic নয়) | পোর্ট | P0 |
| `find_referencing_symbols` | কোন symbol কোথায় ব্যবহার, snippet সহ | `grep` (false positive) | পোর্ট | P0 |
| `get_diagnostics_for_file` | LSP-র প্রকৃত error/warning | `syntax_check` (শুধু syntax) | পোর্ট | P0 |
| `rename_symbol` | cross-file atomic rename | নেই (regex replace ঝুঁকিপূর্ণ) | পোর্ট, probe-এর পরে | P1 |
| `replace_symbol_body` | symbol-anchored edit | `edit` (text range) | পোর্ট | P1 |
| `insert_after_symbol` | class/method-এর পরে insert | `edit` | পোর্ট | P1 |
| `insert_before_symbol` | symbol-এর আগে insert | `edit` | পোর্ট | P1 |
| `safe_delete_symbol` | reference check করে delete | নেই | পোর্ট | P2 |
| `find_declaration` | call → declaration | `grep`/`read` | P2 (definition দিয়ে শুরু) | P2 |
| `find_implementations` | interface → impl | `grep` | P2 | P2 |

### ৩.২ পোর্ট হবে না

| Serena অংশ | বাদ দেওয়ার কারণ |
|---|---|
| Memory system (৮ ফাইল) | আমাদের SSOT + syllabus + memory আগেই আছে; ডুপ্লিকেট = drift |
| Web dashboard, tray, news fetch | এই CLI workflow-এ ব্যবহার নেই; নেটওয়ার্ক + UI বাড়তি |
| Analytics / token estimator | CHAR_COUNT ভিত্তিক অনুমান; আমাদের খরচের হিসাব অন্যত্র |
| JetBrains integration | paid plugin; আমাদের LSP backend-ই যথেষ্ট |
| Project registry / `activate_project` | প্লাগিনের নিজের project root ধারণা আছে |
| REPL facade (৭টি API) | MCP/MCP-tool ভিত্তিক সারফেসই আমাদের পথ |
| `query_project`, external projects | এক-প্রজেক্ট workflow |
| File/shell tools (`read_file`, `list_dir`, `execute_shell_command`) | OpenCode-এ আগেই আছে |
| ৮৪ language-server config | শুধু configured server (৭টি) |
| Modes/config engine (YAML layers) | প্লাগিনের নিজের permission/mode সিস্টেম আছে |

---

## ৪. আর্কিটেকচার

```
src/zombie/symbols/
  client.ts     # JSON-RPC 2.0 over stdio, Content-Length framing
  registry.ts   # opencode.json lsp block → server command/root; per-(server,root) cache
  nameres.ts    # name_path (Class/method) → LSP Position; documentSymbol tree
  tools.ts      # toolSpecs() + handlers, server.ts-এ register
  edits.ts      # WorkspaceEdit → TextEdit[]; applyEdit fallback
scripts/symbol-probe.mjs   # live acceptance probe
test/symbols.test.ts       # fixture-based, node --test
```

| ফাইল | দায়িত্ব | পুনঃব্যবহার |
|---|---|---|
| `src/zombie/lspConfig.ts` | ৭টি server-এর absolute path + `opencode.json` lsp block | **আগেই আছে** — registry এটাই পড়বে |
| `src/zombie/lsp.ts` | `syntax_check` (tsc/py_compile) | অপরিবর্তিত থাকবে |
| `src/zombie/server.ts` | `toolSpecs()`, `registerTools()` | নতুন ৫টি spec যোগ |
| `scripts/lsp-probe.mjs` | initialize probe | একই client ব্যবহার করবে |
| `mcp/public-api/server.mjs` | zero-dep stdio JSON-RPC প্যাটার্ন | audio MCP-র টেমপ্লেট |

**গুরুত্বপূর্ণ:** `src/zombie/lsp.ts` নামটা LSP হলেও এটি LSP client নয় — এটি syntax checker। নতুন `symbols/client.ts` আলাদা রাখতে হবে, নইলে দুটো দায়িত্ব মিশে যাবে।

---

## ৫. Tool contract (P0)

### ৫.১ `get_symbols_overview`

```json
{
  "name": "get_symbols_overview",
  "input": {
    "path": "src/plugin.ts",
    "depth": 1,
    "max_chars": 20000
  },
  "output": {
    "symbols": [{"name": "ZombieCoder", "kind": "class", "line": 42, "children": []}],
    "truncated": false
  }
}
```

LSP: `textDocument/documentSymbol`। `depth` = tree কত গভীরে নামবে (Serena-র `-1` behavior কপি করব না; explicit default `1`)।

### ৫.২ `find_symbol`

```json
{
  "name": "find_symbol",
  "input": {
    "name_path": "ZombieCoder/setup",
    "path": "src/plugin.ts",
    "include_body": false,
    "substring": false,
    "max_matches": 20
  },
  "output": {
    "matches": [{"path": "...", "name_path": "ZombieCoder/setup", "line": 581, "kind": "method"}],
    "count": 1
  }
}
```

LSP: `textDocument/documentSymbol` + নিজের name-path matcher। `workspace/symbol` শুধু fallback (অনেক server-এ খারাপ)।

### ৫.৩ `find_referencing_symbols`

```json
{
  "name": "find_referencing_symbols",
  "input": {"name_path": "Foo/bar", "path": "src/foo.ts", "include_snippet": true, "max_results": 50},
  "output": {"references": [{"path": "...", "line": 12, "snippet": "foo.bar(x)"}], "count": 1}
}
```

LSP: `textDocument/references` (`includeDeclaration: false`)।

### ৫.৪ `get_diagnostics_for_file`

```json
{
  "name": "get_diagnostics_for_file",
  "input": {"path": "src/plugin.ts", "min_severity": "warning"},
  "output": {"diagnostics": [{"line": 432, "severity": "error", "code": "TS2322", "message": "..."}]}
}
```

দুই পথ: (ক) pull `textDocument/diagnostic` সমর্থিত হলে; (খ) নাহলে `publishDiagnostics` cache — initialize-এর পর প্রথম push-এর জন্য অপেক্ষা (timeout 3s), তারপর ফাইল বদলালে refresh।

### ৫.৫ আউটপুট নিয়ম

| নিয়ম | মান |
|---|---|
| ডিফল্ট char budget | 20,000 (Serena-র 150,000 আমাদের জন্য বেশি) |
| max matches | 20 (symbol), 50 (references) |
| ordering | path, তারপর line |
| truncation | `truncated: true` + `omitted` count |
| path | project-relative, POSIX separator |
| error | `{error: {code, message, retryable}}`, stack নয় |

---

## ৬. LSP client লাইফসাইকল

| বিষয় | সিদ্ধান্ত |
|---|---|
| Transport | stdio, `Content-Length` framing, `\r\n\r\n` |
| Spawn | lazy, প্রথম tool call-এ |
| Key | `(serverId, realRootPath)` |
| Concurrency | প্রতি key-তে ১টি process, queue-তে serialize |
| Initialize | `rootUri`, `workspaceFolders`, `capabilities.workspace.workspaceEdit.documentChanges=true` |
| Timeout | initialize 10s, request 15s, diagnostics 5s |
| Idle | 10 মিনিট idle-এ shutdown |
| Crash | process exit → পরের call-এ ১ বার restart, তারপর error |
| Log | stderr ring buffer (64 KB), `--debug` ছাড়া না দেখানো |
| Cleanup | plugin unload-এ `shutdown` + `exit`, 2s পর kill |

**পরিমাপ:** adapter-এর probe অনুযায়ী initialize খরচ TS 172ms / python 246ms — lazy spawn গ্রহণযোগ্য। `UNVERIFIED`: দীর্ঘ সেশনে memory growth (probe চালিয়ে মাপতে হবে)।

---

## ৭. Editing tools (P1) ও fallback

| Tool | LSP method | Fallback |
|---|---|---|
| `rename_symbol` | `textDocument/rename` → `WorkspaceEdit` | reference list + প্রতিটি edit আলাদা `edit` call |
| `replace_symbol_body` | `textDocument/documentSymbol` range | symbol-এর range বের করে `edit` |
| `insert_after_symbol` | documentSymbol range end | `edit` at line |
| `insert_before_symbol` | documentSymbol range start | `edit` at line |
| `safe_delete_symbol` | `references` count | 0 হলে range delete, নাহলে reference list |

নিয়ম:
1. Write-টুল প্রথমে **dry-run diff** দেবে; `apply: true` ছাড়া ফাইল বদলাবে না।
2. `workspace/applyEdit` server→client request; OpenCode LSP server-এ সমর্থন `UNVERIFIED`। তাই **fallback বাধ্যতামূলক**, এবং প্রথমে probe দিয়ে দেখা হবে।
3. এক call-এ এক ফাইল-সেট; ২০টির বেশি edit হলে abort।

---

## ৮. লাইসেন্স ফাঁদ — সবচেয়ে গুরুত্বপূর্ণ সতর্কতা

| উপাদান | লাইসেন্স | adapter-এ সরাসরি কপি করা যাবে? |
|---|---|---|
| Serena app (`src/serena`) | `GPL-3.0-or-later` | **না** — adapter-এর non-commercial license-এর সাথে incompatible |
| `solidlsp` (`src/solidlsp`) | `MIT` | হ্যাঁ, attribution সহ (তবু কোড কপির চেয়ে পুনর্লিখন ভালো) |
| `edge-tts` | `LGPL-3.0` | process হিসেবে call করলে লিংক হয় না |
| adapter | custom non-commercial | — |

**সিদ্ধান্ত:** Serena থেকে **আইডিয়া, tool semantics, JSON output আকৃতি** নেওয়া যাবে; **সোর্স কোড কপি নয়**। LSP নিজেই খোলা স্পেসিফিকেশন — তাই `client.ts` স্ক্র্যাচ থেকে লেখাই নিরাপদ ও পরিষ্কার।

---

## ৯. OpenCode কি অডিও সাপোর্ট করে?

**উত্তর: না — মডেল-স্তরে অডিও ইনপুট নেই, আর playback-এর কোনো ডকুমেন্টেড ফিচার নেই।**

| দাবি | প্রমাণ | লেবেল |
|---|---|---|
| audio attachment model request-এ যায় না | Attachments docs: "AVIF, BMP, audio, video, and other binary prompt attachments are not included in the model request." | `SOURCE_VERIFIED` |
| image সমর্থিত | একই ডক: image model-এ pass হয়, ২০ MiB limit | `SOURCE_VERIFIED` |
| binary tool output নয় | `read` docs: PDF/ইমেজ ছাড়া অন্য binary fail | `SOURCE_VERIFIED` |
| TUI/desktop audio playback | docs-এ কোনো mention নেই | `UNVERIFIED` (নেই ধরাই যুক্তিযুক্ত) |
| MCP audio tool সম্ভব? | MCP tool টেক্সট/path ফেরত দিতে পারে; অডিও ফাইল ডিস্কে লিখে path দিলে কাজ করে | `SOURCE_VERIFIED` (MCP docs) |

**অর্থ:** "অডিও এমসিপি" দিয়ে agent কথা বলবে না; agent **অডিও ফাইল বানাবে**, আর মানুষ সেটি প্লে করবে। ভয়েস-চ্যাট বা STT চাইলে সেটি আলাদা প্রকল্প (Whisper-ভিত্তিক), OpenCode-এর ভেতরে নেই।

---

## ১০. edge-tts Audio MCP নকশা

### ১০.১ অবস্থান ও রূপ

| বিষয় | সিদ্ধান্ত |
|---|---|
| পাথ | `mcp/audio-tts/server.mjs` |
| ধরন | stdio MCP, zero npm dependency, `mcp/public-api` প্যাটার্ন |
| নির্ভরতা | `edge-tts` CLI (ইনস্টলড `7.3.1`) — Python import নয়, process call |
| ইনস্টল | `uv tool install edge-tts` (আগেই আছে); version pin: `==7.3.1` |
| কনফিগ | `opencode.json` → `mcp.servers.audio-tts` |

### ১০.২ Tools

| Tool | ইনপুট | আউটপুট |
|---|---|---|
| `tts_to_file` | `text`, `voice?`, `rate?`, `format?=mp3`, `subtitles?=true`, `out?` | `{path, bytes, duration_s, cues, voice, cached}` |
| `tts_list_voices` | `locale?=bn` | `[{name, gender, locale}]` |
| `tts_health` | — | `{edge_tts, endpoint, ok}` |

### ১০.৩ আউটপুট নিয়ম

| নিয়ম | মান |
|---|---|
| ডিফল্ট ডিরেক্টরি | `AUDIO_TTS_DIR` নাহলে `os.tmpdir()/opencode-audio` |
| ফাইলনেম | `tts-<sha256(text\|voice\|rate)[0:12]>.mp3` |
| overwrite | ডিফল্টে না; `force: true` লাগবে |
| cache | hash মিললে আগের ফাইল + `cached: true` |
| duration | SRT শেষ cue থেকে (ffprobe নির্ভরতা নয়) |
| char limit | 20,000; বেশি হলে error, চুপচাপ কাটবে না |
| chunking | 4,500 chars-এ ভাগ, MP3 concat, SRT offset merge |
| permissions | `0600` |

### ১০.৪ নিরাপত্তা ও ব্যর্থতা

| ঝুঁকি | ব্যবস্থা |
|---|---|
| লেখা Microsoft endpoint-এ যায় | ডকুমেন্টে স্পষ্ট; `AUDIO_TTS_DISABLED=1` kill-switch |
| secret টেক্সটে | tool description-এ নিষেধ; `sk-`, `ghp_`, `AKIA` প্যাটার্নে refuse |
| path traversal | `out` শুধু `AUDIO_TTS_DIR`-এর ভেতরে, realpath check |
| 401/403/429 | retry 2 বার (backoff), তারপর `retryable: true` error |
| offline | দ্রুত fail; `tts_health` আগে |
| দীর্ঘ লেখা | chunking; প্রথম chunk fail হলে abort |
| ToS | unofficial service — personal use; production-এ নয় |

### ১০.৫ Self-check

```
npm run mcp:audio-tts:check
→ tools/list-এ ৩টি tool
→ ২০ অক্ষরের বাংলা বাক্য synthesize
→ mp3 > 5KB, SRT cue ≥ 1, duration > 0
→ AUDIO_MCP_OK
```

---

## ১১. খরচ, সময়, ঝুঁকি

| কাজ | সময় | ঝুঁকি | নির্ভরতা |
|---|---:|---|---|
| `symbols/client.ts` + registry | 2 দিন | LSP lifecycle, Windows path | `lspConfig.ts` |
| P0 ৪টি টুল + tests | 1.5 দিন | name-path ambiguity | client |
| diagnostics | 0.5 দিন | push/pull পার্থক্য | client |
| rename + fallback | 2 দিন | `applyEdit` অসমর্থিত হতে পারে | probe |
| symbol edit ৩টি | 1 দিন | range drift (edit-এর পর stale) | rename |
| audio MCP + selfcheck | 0.5–1 দিন | service instability | edge-tts |
| **মোট** | **৬–৮ দিন** | | |

**ঝুঁকির ক্রম:** (১) লাইসেন্স ভুল করে GPL কোড কপি, (২) `applyEdit` ধরে নেওয়া, (৩) LSP server crash-এ hang, (৪) অডিও "চ্যাট" প্রত্যাশা।

---

## ১২. যা করব না (non-goals)

- Serena-র memory/dashboard/modes/project registry পোর্ট নয়।
- নিজের LSP server লেখা নয়; শুধু configured ৭টি server।
- ৮৪ ভাষার সমর্থন নয়।
- অডিও ইনপুট/STT নয় (OpenCode সাপোর্ট করে না)।
- production-grade অডিও নয়; ToS ঝুঁকি।

---

## ১৩. ACCEPTANCE (কপি-পেস্ট)

```bash
# 1. type + unit
npm run typecheck
node --experimental-strip-types --test test/symbols.test.ts

# 2. live LSP (আগের probe অপরিবর্তিত)
npm run lsp:probe -- --compact          # expect 7/7
npm run lsp:diagnostics                 # expect real TS2322

# 3. নতুন symbol probe
node --experimental-strip-types scripts/symbol-probe.mjs --fixture test/fixtures/ts
# expect: SYMBOL_PROBE_OK overview=1 symbol=1 refs=1 diag=1

# 4. audio MCP
npm run mcp:audio-tts:check             # expect AUDIO_MCP_OK
npm run mcp:test

# 5. পুরো gate
npm run check
```

**Definition of done (প্রতি টুল):** fixture-এ সঠিক ফল + timeout-এ hang নয় + error-এ structured JSON + কোনো write টুল `apply:true` ছাড়া ফাইল না ছোঁয়া।

---

## ১৪. মন্তব্য (সারকথা)

- **হ্যাঁ, পোর্টটি যুক্তিসঙ্গত — কিন্তু প্রত্যাশার চেয়ে ছোট।** OpenCode-এ LSP runtime আগেই আছে; আমাদের শুধু ৪–৫টি read-only tool খুলতে হবে। এটি ২–৩ দিনের কাজ, "নতুন IDE" নয়।
- **না, Serena কোড কপি নয়।** GPL ↔ non-commercial সংঘাত। ধারণা নাও, বাস্তবায়ন নিজের।
- **rename সবচেয়ে দামি, কিন্তু সবচেয়ে ঝুঁকিপূর্ণ।** `applyEdit` probe pass না করলে fallback ছাড়া ship কোরো না।
- **অডিও MCP করা উচিত, তবে সেটি "audio support" নয়।** এটি ফাইল-জেনারেটর; OpenCode-এর মডেল অডিও শোনে না, TUI অডিও বাজায় না (ডকুমেন্টেড নয়)। প্রত্যাশা পরিষ্কার রাখলে এটি কম খরচে ভালো utility।
- **সবচেয়ে বড় অযৌক্তিকতা হবে Serena-র ৯০% সারফেস টেনে আনা।** ৫৩ টুলের ৯টি, ৮৪ server-এর ৭টি — এটাই সীমা।
