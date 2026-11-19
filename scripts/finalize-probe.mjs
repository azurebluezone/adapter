// Delivery probe for gc-mwmsxy4i.
//
// The audio and the architecture doc live outside the repository, so a green
// `npm run check` cannot prove them. This probe reads the real artifacts: the
// updated document, the MP3 metadata from ffprobe, the live subagent verdict,
// the pushed branch on origin, and finally the full repository check.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const DOC = "/home/sahon/Documents/Default Project/ZombieCoder Autonomous Agent.md";
const MUSIC = "/home/sahon/Music/mp3/ZombieCoder Autonomous Agent";
const STEM = "ZombieCoder-Autonomous-Agent-Delivery-bn";
const MP3 = path.join(MUSIC, `${STEM}.mp3`);
const TRANSCRIPT = path.join(MUSIC, `${STEM}.txt`);
const VERDICT = path.join(MUSIC, `${STEM}.agent-verification.txt`);
const BRANCH = "feat/five-step-enhancement";
const FFMPROBE = fs.existsSync("/home/sahon/.local/bin/ffprobe")
  ? "/home/sahon/.local/bin/ffprobe"
  : "ffprobe";

let failures = 0;

function step(label, fn) {
  try {
    fn();
    console.log(label);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${label}: ${error?.message ?? error}`);
  }
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, timeout = 115000) {
  return spawnSync(command, args, { cwd: ROOT, encoding: "utf8", timeout });
}

step("DOC_OK five-step status section is present", () => {
  const doc = fs.readFileSync(DOC, "utf8");
  for (const token of ["FIVE_STEP_DELIVERY_OK", "2026-11-19", "ZC_FIVE_STEPS_OK", BRANCH]) {
    must(doc.includes(token), `document is missing ${token}`);
  }
});

step("AUDIO_OK new MP3 has real duration and a transcript", () => {
  const stat = fs.statSync(MP3);
  must(stat.size > 200_000, `MP3 is only ${stat.size} bytes`);
  const transcript = fs.readFileSync(TRANSCRIPT, "utf8");
  must(transcript.length > 1500, `transcript is only ${transcript.length} characters`);
  const probe = run(FFMPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration,size,bit_rate",
    "-of",
    "json",
    MP3,
  ], 20_000);
  must(probe.status === 0, `ffprobe exited ${probe.status}: ${probe.stderr.trim()}`);
  const format = JSON.parse(probe.stdout).format ?? {};
  must(String(format.format_name ?? "").includes("mp3"), `format is ${format.format_name}`);
  must(Number(format.duration) > 60, `duration is ${format.duration}s`);
  console.log(`  file=${path.basename(MP3)} bytes=${stat.size} duration=${format.duration}s bitrate=${format.bit_rate}`);
});

step("AGENT_VERDICT_OK a live subagent checked the delivery", () => {
  const verdict = fs.readFileSync(VERDICT, "utf8");
  must(verdict.includes("agent: majnu"), "verdict does not name agent: majnu");
  must(verdict.includes("VERDICT: PASS"), "verdict is not PASS");
});

step("PUSH_OK local HEAD equals the pushed branch", () => {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  must(branch === BRANCH, `local branch is ${branch}`);
  const local = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const remote = run("git", ["ls-remote", "--heads", "origin", BRANCH], 30_000);
  must(remote.status === 0, `git ls-remote exited ${remote.status}`);
  const line = remote.stdout.trim().split("\n").find(Boolean) ?? "";
  const [sha, ref] = line.split(/\s+/);
  must(ref === `refs/heads/${BRANCH}`, `remote branch missing: ${line || "(empty)"}`);
  must(sha === local, `remote ${sha} != local ${local}`);
  const dirty = run("git", ["status", "--porcelain", "--untracked-files=no"]).stdout.trim();
  must(dirty === "", `tracked files are not clean:\n${dirty}`);
  console.log(`  branch=${BRANCH} sha=${local}`);
});

step("CHECK_OK full repository check exits 0", () => {
  const check = run("npm", ["run", "check"]);
  const tail = `${check.stdout ?? ""}\n${check.stderr ?? ""}`.trim().split("\n").slice(-6);
  for (const line of tail) console.log(`  ${line}`);
  must(check.status === 0, `npm run check exited ${check.status}`);
  must(/ℹ fail 0/.test(check.stdout ?? ""), "test summary did not report fail 0");
});

if (failures > 0) {
  console.error(`ZC_FINALIZE_FAILED failures=${failures}`);
  process.exit(1);
}
console.log("ZC_FINALIZE_OK");
