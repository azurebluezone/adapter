# ZombieCoder — Arbiter Ruling: Persona Drift + Circuit-Breaker Bypass

RULING — src/zombie/responseGate.ts:460 — persona surface gate যোগ করা হয়েছে; ভাইয়া ছাড়া substantive answer এখন drift হিসেবে আটকায়।
RULING — src/zombie/circuitBreaker.ts:64 — breaker window 5 মিনিট; পুরনো failure limit-এ গোনা হয় না।
RULING — src/plugin.ts:98 — shell mutation closure: shell/bash/command + redirect/sed -i/tee এখন goal-contract গেটের ভেতরে।
decision — priority: security > correctness > stability > speed; dissent রেকর্ড করা হয়েছে।
evidence origin: real_run (npm test/tsc); label: END_TO_END_TESTED for gate+breaker blocks.
