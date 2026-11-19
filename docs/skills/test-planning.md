---
id: test-planning
name: Test Planning
description: Turn an acceptance claim into a small set of real-path checks with explicit pass criteria, fixtures and failure paths. Use before implementation and again at release.
---

# Test Planning

## The rule

A test is a question with a pass criterion. "It works" is not a question, and "tests pass" is not an outcome.

## Procedure

1. **Write the acceptance sentence** — the exact observable the user will see: a status, a body, a file, a byte count, a duration.
2. **Name the real input** — user file, endpoint, service, command. If the real input is missing, the result is `NOT_TESTED`, not a demo.
3. **Choose the smallest path that touches the real dependency**
   - pure unit test: the transformation only
   - integration test: the module plus its real dependency
   - end-to-end: the user path with the real config
4. **Cover the states, not just success** — create/edit/delete/view/list, empty, error, permission denied, timeout, retry.
5. **Define the failure checks explicitly** — malformed input, boundary size, duplicate call, partial write, stale state.
6. **Write the check command before the code** — the command that must exit 0 and print the observable. A command that changes between "before" and "after" is not a gate.
7. **Run it before the change** — a check that already passes proves nothing. Record the baseline.
8. **Run it after the change and keep the raw output** — exit code, final pass/fail line, artifact hash.
9. **Re-run the neighbours** — the surrounding suite, not only the new test. A fix that breaks a neighbour is not a fix.

## Matrix

| Layer | Proves | Does not prove |
| --- | --- | --- |
| Unit | the transformation is correct | the dependency is reachable |
| Integration | the module and dependency agree | the user journey works |
| End-to-end | the user journey works | nothing about scale or abuse |
| Live probe | the service answers now | future availability |

## Constraints

- A fixture or mock is a boundary, not a deliverable. Label it and say what real input is still missing.
- A flaky test is a finding. Quarantine it with an owner and a reason; never retry it silently until green.
- Every release check has: command, expected output, match mode, and the artifact path. If the agent can edit the check after seeing the result, it is not a gate.

## Report format

```text
claim:
real input:
command:
exit code:
observed:
verdict: PASS | FAIL | NOT_TESTED
artifact:
```
