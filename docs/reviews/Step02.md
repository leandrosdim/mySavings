# Step02 — independent Hermes review

Status: APPROVED for pure calculation scope. Step03 NOT started.

## Execution and scope
Executed registered Step02 through OpenCode `ollama-cloud/glm-5.2`, then a scoped correction prompt on the same model. First correction attempt exited after a truncated introduction without tool work; retried successfully. No model substitution.
Created lib/finance/money.ts, settlements.ts, forecast.ts, four test files, vitest.config.mts and docs/finance-api.md. Vitest 5.0.1 is a dev dependency; production dependencies unchanged. No application route/UI, auth, DB connection, migrations or payment persistence added. User's real Neon URL stays private and unused by finance code/tests. Next build automatically loads .env; no module consumes database credentials.

## Independent review findings and resolution
Initial implementation suite: 82 passed. Hermes added 10 independent cases; 8 failed and 2 passed, so initial implementation was NOT approved.
Corrected through GLM 5.2:
- Reversed original payments are excluded from paid rather than subtracted again.
- Strict positive historical settlement amounts, boolean reversal flags, nonnegative plans and overpaid-history rejection.
- Negative targets, received income and paid expense values rejected.
- Identical duplicate account/obligation representations collapse; conflicting representations reject instead of selecting a maximum or double counting.
- Explicit linkedReserveId with matching representation prevents ordinary/reserved double counting; missing/ambiguous links reject.
- Reserve input now explicitly planned gross protection plus paidCents; remaining protection is calculated once. Removed misleading outstanding-minus-paid contract.
- Unentered account amount:null means incomplete setup, not an assumed zero.
Hermes narrow final fixes: validate supplied target even with incomplete accounts; make npm run test:watch explicitly use --watch because config defaults watch:false. Added regression and independent BigInt forecast oracle.

## Verified final results
Independently rerun after financial correction:
- npm run lint: PASS.
- npm run typecheck: PASS.
- npm test: 4 files, 129 tests PASS (money 32, settlements 34, forecast 49, Hermes 14).
- npm run build: PASS, existing static / and /_not-found routes only.
- npm audit: 0 vulnerabilities.
- git diff --check: PASS.
- npm run test:watch: 129 tests PASS, reached 'Waiting for file changes'; deliberately stopped with 5-second timeout, exit 124 expected.
Hermes tests include 1000 deterministic scenarios compared to a BigInt oracle and 512 near-safe-integer cent round trips. These are assertions inside test cases, not inflated test-case counts.
Confirmed no changes under app/, no DB driver in runtime dependencies, no DB/env/network imports in finance modules, and all 18 canonical/execution prompt pairs match.

## Coverage and boundaries
Gas 80 -> pay 40 -> pay 40 preserves original plan and leaves 40 then 0. Overpayment/invalid inputs rejected. Formula tests cover B+I-E-R-S and B-E-R-S, negative shortfall, pending-income caveat, reserve protection, transfers and payment/receipt balance-mode effects through pure input scenarios.
Actual account mutations, SQL atomicity/idempotency/concurrency, session isolation, immutability of stored history and real payment UI remain future-step integration tests. Pure helper tests do not prove those features. No browser rerun was necessary for this step: no browser-facing files or behavior were changed; Step01 browser review remains separate.
Remaining implementation contract: zero-plan with no active settlements currently reports unpaid, remaining zero; callers must not interpret this as positive debt. Money formatting returns canonical ungrouped EUR decimal string, not final localized UI. Invalid external HTTP/DB shapes still require boundary schema validation in later steps.
ESLint 9 deprecation/compatibility risk from Step01 remains; audit passing is not a guarantee of security.

## Next gate
Step03: Neon connection and migration infrastructure. User says private .env holds a real Neon PostgreSQL URL. Before connecting/migrating, confirm intended mySavings database/branch and safe development/test scope. No secrets printed, no DB mutations, no commits/pushes/deployment performed in Step02.
