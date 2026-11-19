---
id: root-cause
name: Root Cause Analysis
description: Separate symptom, trigger and cause with a minimal reproduction before proposing a fix. Use when a failure repeats, a fix did not hold, or the obvious cause feels borrowed.
---

# Root Cause Analysis

## The rule

A symptom is what the user sees. A trigger is what happened just before it. A cause is the mechanism that makes the trigger produce the symptom. A fix that only removes the symptom will return.

## Procedure

1. **State the failure in one sentence** — expected, actual, and the exact input.
2. **Capture the artifact** — command, exit code, stack line, HTTP status, log window. No artifact means no investigation.
3. **Walk backwards along the data** — input → state → transformation → output → failure path. Mark where the value was last known correct.
4. **Shrink the reproduction** — remove everything that is not needed to reproduce. The smallest failing case names the condition.
5. **List candidate mechanisms** — at least two. One candidate is a guess, not a diagnosis.
6. **Kill candidates with evidence** — a probe per candidate. A candidate that cannot fail is not a candidate.
7. **Name the cause and the blast radius** — which callers, files, data and environments share it.
8. **Fix the mechanism, then re-run the original reproduction** — not a new happy-path test.

## Evidence table

| Step | Artifact |
| --- | --- |
| Failure | command + exit code + output window |
| Repro | smallest input that still fails |
| Cause | `path:line` or probe result that distinguishes it from the alternatives |
| Fix | original repro now passes + regression test |

## Stop conditions

- Three attempts at the same failure with no new artifact: stop and report what is blocked. Do not hand the failure to another agent.
- A cause that cannot be observed from outside is a hypothesis. Label it `UNVERIFIED` and say what probe would confirm it.
- A passing suite is not proof of the cause. It only proves the suite did not cover the failing path.

## Anti-patterns

- Editing the test until it agrees.
- Calling a retry a fix.
- Blaming the environment before reading the actual error.
- "It works now" without the original reproduction.
