# Desktop/1 nine-persona execution

This example runs the installed ZombieCoder roster in a **separate working
directory** (`/home/sahon/Desktop/1`) so every agent gets its own per-directory
`.zombiecoder` footprint, SSOT and syllabus.

## Run

```bash
mkdir -p /home/sahon/Desktop/1
cd /home/sahon/Desktop/1
opencode run --agent zombiecoder --auto --format json --archived \
  "$(cat /home/sahon/adapter/examples/desktop-1/input.md)" \
  | tee /home/sahon/Desktop/1/run.log
```

`input.md` is the pre-registered brief: it names the goal-contract fields, the
order in which the main agent calls the eight specialists, and the exact report
headings. The run is deliberately sequential: one specialist per step, so a
failure is attributable to a named agent instead of a merged transcript.

If a nested `opencode run` cannot start, the same brief can be executed by the
controlling session one specialist at a time. That fallback is recorded as
`nested=false` in `run.json` and is never presented as a nested run.

## Verify

```bash
node /home/sahon/adapter/examples/desktop-1/verify-delivery.mjs
```

The verifier reads the real git refs, the installed config, the inline-install
proof, the generated report and the browser record. It prints
`ZC_DELIVERY_OK` only when every claim is backed by a file or command result.
