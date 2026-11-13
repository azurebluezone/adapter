# Workstation Orchestration Contract

## উদ্দেশ্য

ZombieCoder-এর workstation plugin মডেলকে oracle ধরে না। Plugin স্থানীয়,
deterministic কাজ করে: project state দেখে, user intent থেকে ছোট task slice
নির্বাচন করে, approval ছাড়া write আটকায়, এবং check-এর ফলসহ claim যাচাই করে।
মডেল পরিকল্পনা, code ও ভাষার component; তার উত্তর plugin বদলায় না।

এটি নৈতিক সীমা: অনিশ্চিত তথ্য `UNVERIFIED`, অনুমতি ছাড়া command নয়, secret
context-এ নয়, এবং demo/mock-কে production proof বলা যাবে না।

## রাজদরবারের flow

```text
User request
  -> watchdog repairs/refreshes project state
  -> deterministic intent + focus resolver selects a small file slice
  -> selected dropdown agent is the primary owner (রাজা)
  -> bounded reviewers gather evidence (সেনাপতি)
  -> visible goal-contract preview + user approval
  -> edit / approved real check / review
  -> owner reports evidence, files, command output, and any UNVERIFIED gap
```

Every roster agent is configured as `mode: all`, so the dropdown-selected one
is primary for that session and may use allowed specialists as child agents.
OpenCode permissions remain the authority for which subagents can launch.

## Watchdog

`src/zombie/watchdog.ts` runs during project scaffold and on the runtime refresh
cycle. It ensures these plugin-owned files exist and are coherent:

- `.zombiecoder/SSOT.md`
- `.zombiecoder/syllabus.md`
- `.zombiecoder/memory/index.json`
- `.zombiecoder/memory/compact.json`

It performs a bounded local scan and ignores dependency/generated/private paths,
including `node_modules`, `vendor`, virtual environments, build output,
`.next`, `.git`, `.zombiecoder`, environment files and backups. A changed
bounded fingerprint refreshes SSOT, footprint and onboarding; unchanged trees
are not repeatedly appended to the syllabus.

The watchdog discovers commands but does not become the task executor. The
selected agent chooses the narrowest task-relevant check, records it in the
goal contract and executes that exact recorded command through OpenCode's normal
permission door. The agent must make safe in-scope progress before reporting a
limitation; any remaining blocker is reported with completed evidence and one
concrete next action.

## SSOT and language inventory

SSOT contains the bounded file map plus root-manifest evidence for Node/JS,
Next.js, Python, PHP, Go, Rust and JVM projects. Each detected runtime records:

- declared version range, or `not declared`;
- root evidence file;
- conventional source/test/template locations;
- candidate compile/test commands for the selected agent to register and run.

File extensions alone never prove a runtime version. Nor can a generic plugin
prove a model's training cutoff: it remains `UNVERIFIED` unless the provider
offers auditable model metadata. Version-specific facts must come from an
official source when the task requires them.

## Syllabus, memory, and compact state

Onboarding records structure, manifests, docs, tests, bounded log findings,
audit failures, open markers and unresolved evidence gaps. The human/agent must
still compare code, docs and the user's stated outcome; a scanner cannot infer
behaviour or a correct fix.

The transcript stays append-only per session. RAM retains the latest ten visible
messages. `memory/compact.json` is intentionally not another transcript: it
stores only the current request (redacted and bounded), deterministic intent,
focused paths and recent-message count for a capped number of sessions.

For every model call, the context packet contains only the current request,
SSOT slice, relevant syllabus lessons, selected paths, current-session recent
memory and contract state. Old archives are searched/read only when the current
task needs a prior decision.

## Intent and contract

`src/zombie/intent.ts` classifies plain-language input as `conversation`,
`inspect`, `verify`, or `change` using transparent deterministic rules. It is a
routing hint—not a claim of perfect language understanding. The literal user
request always wins and is displayed in the context and compact index.

For a change, the primary owner must present the visible goal-contract: what was
understood, bounded files, expected output, and the real check. User approval
opens it. A completion claim needs the recorded check, affected paths, and a
review/result. Failed checks are reported honestly; they are never rewritten
into success.

## Quality questions before release

The owner/reviewer must explicitly check the changed slice for:

1. User intent and stated output.
2. Existing project convention and least-surprise design.
3. Real compiler/test/lint evidence appropriate to the language.
4. Security/privacy boundaries and tool permissions.
5. Demo, mock, placeholder, or stand-in code presented as production behaviour.
6. Developer maintainability, administrator observability, and end-user impact.

This contract does not promise 100% correctness. It makes uncertainty, evidence,
approval, and responsibility visible.
