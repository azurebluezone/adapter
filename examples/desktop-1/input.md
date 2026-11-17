# Execution brief — Desktop/1 reality audit

Working directory: `/home/sahon/Desktop/1`

You are **ZombieCoder (Chief Arbiter)**, the main agent. Run a bounded,
sequential nine-persona execution and produce one honest HTML report.

## Pre-work (required by the plugin)

1. Run `project_onboarding` once so this working directory has its footprint.
2. Open exactly one goal contract:
   - goal: `Produce the nine-persona execution report at /home/sahon/Desktop/1/report.html`
   - input: `Run the Desktop/1 nine-persona execution and report who did what, who got what, who did not get, and how reality works.`
   - expected: `REPORT_READY`
   - check: `test -s /home/sahon/Desktop/1/report.html && grep -q REPORT_READY /home/sahon/Desktop/1/report.html && echo REPORT_READY`
   - pass: `report.html exists and contains REPORT_READY after all nine agents ran.`
   - match: `contains`

## Sequence — one specialist at a time, at different times

Call the `subagent` tool once per specialist, wait for the result, then call the
next one. Give each specialist a bounded task and require concrete evidence.
Do not batch them: a failure must be attributable to one named agent.

1. **manu** — architecture: define the report structure and the reality-check questions.
2. **nila** — UI: heading hierarchy, colour, accessible layout.
3. **tuhin** — MCP/model: list the real MCP tools available and whether the tool path works.
4. **jarin** — debug: find one real broken thing in the work and fix it; quote the error.
5. **brishti** — security: check for secrets, external scripts and unsafe links.
6. **rashed** — performance: page weight and render budget.
7. **halim** — docs: plain-language wording for "how reality works".
8. **majnu** — QA: accept or reject against the criteria and list every gap.

## Deliverables

- `/home/sahon/Desktop/1/report.html` — one self-contained HTML file, no external
  assets. It must contain `<!-- REPORT_READY -->` and these exact headings:
  - `Who did what`
  - `Who got what`
  - `Who did not get`
  - `How reality works`
  Name every agent by id and persona. Use the real evidence each specialist
  returned; where evidence is missing write `UNVERIFIED` in the page.
- `/home/sahon/Desktop/1/run.json` — array of
  `{ agent, persona, task, status, evidence, got, missed }`.
- Close the contract only after both files exist and the check passes.

## Reality rule

The page must explain the difference between a claim and a verified result:
what each agent actually produced, what the evidence was, what was refused or
not obtained, and why the plugin's gates (persona, phase, contract, evidence)
make the run reproducible.
