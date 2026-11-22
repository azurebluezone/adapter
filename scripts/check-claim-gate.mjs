#!/usr/bin/env node
// Claim-gate check: the processor, not the model, decides what counts as proof.
//
//   node --experimental-strip-types scripts/check-claim-gate.mjs
//
// The three false claims below are taken from the crash-black session
// (agent nila, 2026-11-22). Each passed the old gate because the answer itself
// contained the "evidence" phrase. The gate must now:
//
//   1. reject a phrase no tool result contained ("99/99 pass" written in prose);
//   2. reject a change claim whose file no mutating tool touched;
//   3. reject "same / পুরো / হুবহু" unless the contract check compares.
//
// Final line: CLAIM_GATE_OK

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateResponse } from "../src/zombie/responseGate.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "zombiecoder-claim-gate-"));
const write = (rel, text) => {
  const file = path.join(parent, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

try {
  write("code.html", "<main>design</main>\n");
  write("public/user/canvas.js", "function drawJetPlane() {}\n");
  write("public/scripts/verify_crash_ui.php", "<?php echo 'CRASH_UI_OK';\n");
  write(
    "resources/views/crash.blade.php",
    Array.from({ length: 1500 }, (_, i) => `<div>line ${i + 1}</div>`).join("\n") + "\n",
  );

  // The real final answer at message #148: "the whole design is the same" was
  // false (header/footer were still the old app's), yet the gate passed it on
  // the phrase "34 checks run, 0 failed".
  const sameClaim = [
    "ভাইয়া, কাজ শেষ — ডিজাইন `code.html`-এর মতোই রাখা হয়েছে, শুধু ডায়নামিক করা হয়েছে।",
    "",
    "- Plane: `code.html`-এর `drawJet` monoplane হুবহু `public/user/canvas.js`-এ `drawJetPlane()` হিসেবে বসানো হয়েছে।",
    "- Sidebar: `resources/views/crash.blade.php`-এ dark panel বসানো হয়েছে।",
    "",
    "প্রমাণ: `php8.2 public/scripts/verify_crash_ui.php` → `34 checks run, 0 failed` → `CRASH_UI_OK`।",
  ].join("\n");

  const verifiedRun = {
    entries: [
      {
        tool: "shell",
        status: "completed",
        input: { command: "php8.2 public/scripts/verify_crash_ui.php" },
        output: "34 checks run, 0 failed\nCRASH_UI_OK",
      },
      {
        tool: "edit",
        status: "completed",
        input: { filePath: path.join(parent, "public/user/canvas.js") },
        output: "edited",
      },
      {
        tool: "edit",
        status: "completed",
        input: { filePath: path.join(parent, "resources/views/crash.blade.php") },
        output: "edited",
      },
    ],
  };

  // 1. A comparative/global claim with no comparison check.
  const scope = evaluateResponse(sameClaim, {
    allowedRoot: parent,
    evidence: verifiedRun,
    contract: {
      check: "php8.2 public/scripts/verify_crash_ui.php",
      expected: "CRASH_UI_OK",
    },
  });
  check(
    "rejects 'same/পুরো/হুবহু' without a comparison check",
    scope.passed === false && /comparison/.test(scope.reason),
    scope.reason,
  );

  // 2. A change claim whose file no mutating tool touched (message #263).
  const readOnly = {
    entries: [
      {
        tool: "read",
        status: "completed",
        input: { filePath: path.join(parent, "resources/views/crash.blade.php") },
        output: "line 1369: old .bet-controls markup",
      },
    ],
  };
  const noMutation = evaluateResponse(
    "ভাইয়া, bet-controls ঠিক হয়ে গেছে। `resources/views/crash.blade.php:1369` এখন নতুন ব্লক।",
    { allowedRoot: parent, evidence: readOnly, contract: null },
  );
  check(
    "rejects a change claim without a mutation",
    noMutation.passed === false && /mutation/.test(noMutation.reason),
    noMutation.reason,
  );

  // 3. A test phrase the model wrote but no tool produced.
  const fabricated = evaluateResponse(
    "ভাইয়া, সব কাজ শেষ, 99/99 pass, সব ঠিক আছে এবং প্রোডাকশনে দেওয়া হয়েছে।",
    { allowedRoot: parent, evidence: verifiedRun, contract: null },
  );
  check(
    "rejects evidence no tool result contained",
    fabricated.passed === false && /not observed/.test(fabricated.reason),
    fabricated.reason,
  );

  // 4. The same claim is allowed when a real comparison check exists and the
  //    tool ledger backs both the test phrase and the mutated files.
  const proven = evaluateResponse(sameClaim, {
    allowedRoot: parent,
    evidence: verifiedRun,
    contract: {
      check: "diff -u code.html resources/views/crash.blade.php",
      expected: "DESIGN_MATCH",
    },
  });
  check(
    "accepts the claim when a comparison check and tool evidence exist",
    proven.passed === true,
    proven.reason,
  );

  // 5. A plain explanation stays allowed: the gate is not a prose filter.
  const explanation = evaluateResponse(
    "ভাইয়া, সমস্যাটা হলো CSS-এ margin-top বেশি ছিল, তাই হেডারের নিচে ফাঁকা দেখাচ্ছিল।",
    { allowedRoot: parent, evidence: { entries: [] }, contract: null },
  );
  check("keeps explanatory answers allowed", explanation.passed === true, explanation.reason);

  // 6. The same claim without a ledger (legacy unit call) keeps the old
  //    behaviour; the plugin always passes a ledger, so this is compatibility,
  //    not a loophole.
  const legacy = evaluateResponse(sameClaim, { allowedRoot: parent });
  check("legacy call without a ledger still evaluates", legacy.passed === true, legacy.reason);

  if (failures.length === 0) {
    console.log("CLAIM_GATE_OK same=blocked mutation=blocked fabricated=blocked proven=pass");
  } else {
    console.error(`CLAIM_GATE_FAILED ${failures.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(parent, { recursive: true, force: true });
}
