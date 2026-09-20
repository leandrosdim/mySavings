# Step04 — Private authentication and identity

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Registered prompt; NOT IMPLEMENTED. Requires explicit approval and satisfied prerequisites before execution.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step04.md` is canonical; `prompts/Step04-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step03 approved; choose maintained stable auth library/provider after checking current docs/advisories; confirm sign-in method before execution.
Hermes must verify the previous independent gate and current scope before launch. Future implementation is not assumed complete merely because its prompt exists. Unresolved auth choice, credentials, UI language, closing policy or production permissions are blockers only at their named steps, not a reason to invent decisions now.

## Mandatory operating constraints
- Only this approved step, in /home/leandrosdim777/projects/mySavings, using ollama-cloud/glm-5.2. No model substitution. No future-step implementation.
- Read AGENTS.md, docs/product.md, docs/financial-rules.md, steps/README.md, package.json and the preceding independent review. Inspect git status/diff first; preserve unrelated user work and existing private env. Do not reset or clean the repository.
- Prewritten paths are intended locations, not proof they already exist. Reconcile with actual code, existing migrations and selected auth. Reuse implemented helpers. If prerequisites/decisions are absent, STOP with a specific blocker rather than guessing, mocking successful integration or advancing.
- Raw parameterized PostgreSQL via pg, no ORM/query builder; explicit BEGIN/COMMIT/ROLLBACK on one checked-out client for writes; owner derived from server session, all related IDs owner-scoped. Financial cents exact and bounded.
- Preserve original plans; partial settlements do not zero them. Balance updates distinguish UPDATE_ACCOUNT/ALREADY_REFLECTED. Reserves are unpaid protected commitments additional to savings and counted once; continuous balances and carryover IDs must not duplicate.
- Never print .env, credentials, tokenized URLs, real workbook contents or personal financial data. Synthetic fixtures only, scoped cleanup. Do not access another project's credentials. Existing .env does not prove permission to access production.
- No commits, pushes, paid resources, production migration, deployment or real-user provisioning unless separately authorized in the current request. No global configuration edits. No fabricated tool results or passing test claims.
- Online-only financial writes; never persist private authenticated responses or payment queues in PWA caches. Accessible mobile-first UI, readable euros and >=44px controls when UI is in scope.

## Bounded objective
Implement two private user identities and secure sessions, login/logout, protected route guard and private provisioning/invite approach. No public registration. Raw SQL identity schema, secure cookies, CSRF/origin controls, session expiry/revocation and distributed rate limiting where relevant. No custom cryptography or invented identity provider. No shared/admin financial access.

## Implementation sequence
1. PRE-EXECUTION DECISION: confirm user-approved sign-in method and private enrollment approach. Review currently maintained stable auth solutions and official Next App Router documentation, including raw-SQL compatibility, recovery and session revocation. Save the selected decision in docs/auth.md before implementation. If this decision is missing, return a short blocked report; do not invent provider credentials or custom crypto.
2. Reuse the Step03 transaction/migration infrastructure. Create identity/session/invite schema only as required by the approved library. Honor actual ID types and use the next unused migration identifier. No public registration or cross-user financial admin role.
3. Implement login/logout and private server-side session resolution. Use maintained library cryptography/password hashing if passwords are selected. HttpOnly cookies, Secure in production, appropriate SameSite, expiry and revoke-on-logout. Do not return hashes, tokens or provider secrets in session JSON.
4. Guard private pages and EVERY API/server action independently. Next.js 16 uses proxy.ts where interception is necessary; do not create both proxy.ts and middleware.ts. APIs return appropriate 401/403 JSON, not successful HTML login pages. Session ownership never comes from submitted user_id.
5. Apply safe redirect allowlisting, CSRF/origin checks and durable/serverless-compatible abuse controls. Do not use only process-local maps for distributed login rate limiting. Prevent account enumeration while preserving usable private errors.
6. Provide an operator-only provisioning/recovery procedure using secrets through secure input, not command arguments or committed files. Actual user provisioning requires explicit authorization; QA uses two disposable synthetic identities only.
7. Test bad/good login, expired/revoked session, logout, direct unauthorized API and action requests, forged owner fields, redirect attacks and same-device A-to-B switch. Browser-test login/error/logout. Document selected library/version and any provider/database blockers.

## Expected deliverables
db/migrations/001_identity.sql; lib/auth/*; app/login/*; app/api/auth/*; scripts/provision-user.*; docs/auth.md
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Test login failure/success/logout/revocation, unauthenticated direct requests, no user enumeration. Temporary users A/B only, no committed passwords. Browser-login/logout and verify cookies; document provisioning/recovery.
Execute the specific scenarios above in addition to the common gate. Tests must exercise real production helper/route paths, not duplicate the business logic in a separate test-only implementation. Mocked tests supplement but do not replace required DB/browser integration.

## Verification commands and evidence
Run from the project root:
```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit
git diff --check
git status --short --untracked-files=all
git diff --stat
```
If this step needs new targeted test commands, add/document them and run them; do not replace a missing suite with a successful no-op.

For DB scope: use only approved disposable dev/test data, run the real migration gate where applicable (`npm run db:migrate` after Step03 introduces it), prove second run idempotence, constraints, rollback, concurrency and A/B isolation for changed paths. Do not mutate production to test failures. Report only redacted counts/booleans.
For UI scope: run actual app, verify health before browser; test 320/390/430px and desktop, relevant real interactions, persistence, console and horizontal overflow. Capture synthetic-only screenshots under ignored qa-output/. Build/HTTP alone is not browser approval. Physical-device checks must be labeled separately from emulation.
Clean only test-owned fixtures, close owned QA browser sessions and stop owned servers; verify cleanup. Do not kill unrelated processes.

## Report, independent review and STOP
Write `docs/reviews/Step04-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step04.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step04-opencode-glm52.md)"
```
