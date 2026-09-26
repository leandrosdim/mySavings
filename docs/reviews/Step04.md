# Step04 — independent Hermes review

## Current decision after approved remediation
**Step04 independently VERIFIED for private authentication and identity.** The initial findings below are preserved as historical evidence; they are superseded by this gate. Step05 remains unexecuted.

### Remediation independently verified
- Admission happens before credential lookup/hash work; real/dummy Argon2 is inside a transaction-scoped global try-lock. Per-account and global budgets, bounded expired-record cleanup, busy callbacks and action-level zero-hash checks are covered.
- Issuance and password reset lock the same user row and revalidate credentials. Production-helper tests overlap both lock orderings, pause after real FOR UPDATE, and inspect blocking against the held backend PID.
- Privileged provisioning/reset is internal/operator-only, not an exposed Server Action. Session identity is server-derived; API guards distinguish JSON 401/503 from page redirects.
- Strict configured logout origins, deployment-safe redirects, honest revocation failures, cookie-init/save cleanup and explicit cookie expiry are tested. Real POST tests inject a failing UPDATE after successful session lookup; action failure is not a success redirect.
- Discovered and corrected a flawed test harness: session-level SET search_path is not safe on Neon's transaction pooler. Auth test pools now use the same approved DB's direct endpoint, verified TLS and startup-only disposable schema search_path, checked on concurrent clients before injection. All fixture writes require explicit transactions, including single statements.

### Independent execution evidence
Hermes reran, after all implementation changes:
- lint, typecheck, production build, git diff --check: PASS.
- `DB_TEST_ALLOW_WRITES=1 npm test`: 309 offline tests PASS; inherited write permission does not select live tests.
- `DB_TEST_ALLOW_WRITES=1 npm run test:db`: 465 tests across 16 files PASS, including 123 auth tests. This full count includes offline tests; counts are not additive.
- npm audit: 0 vulnerabilities.
Logs: `qa-output/step04-independent-{lint,typecheck,offline,db,build,audit}.log`.

### Real browser and HTTP verification
Used a reviewer-owned production build behind local HTTPS on port 3115, verified Secure cookies, and connected only to an isolated disposable schema containing two synthetic users. No real-user provisioning or public migration was needed.
- Wrong-password generic error, valid A login and server-rendered identity.
- Actual Sign out form, protected redirect after logout, replay of revoked cookie rejected.
- Same-device A -> logout -> B shows B and not A; Back after logout does not reveal the prior authenticated identity.
- 320px no horizontal overflow; mobile and desktop screenshots visually inspected.
- Secure/HttpOnly/SameSite=Lax cookie; no browser JavaScript errors.
- Real HTTP POST rejected five forbidden/malformed/missing Origin cases without clearing cookies. Trusted origin returned 303 to the configured HTTPS /login, no-store and expired cookie.
- Caught a real Next response-merging issue: Max-Age=0 alone disappeared from the HTTP response. Added epoch Expires and re-tested the rebuilt server; the real response now carries explicit expired-cookie semantics.
Evidence: `qa-output/step04-browser-results.json`, `step04-mobile-dashboard.png`, `step04-desktop-dashboard.png`.

### Cleanup and boundaries
Own browser schema removed. Three abandoned schemas from failed earlier Step04 test runs were inspected for the exact auth-table allowlist and synthetic test users before scoped transactional removal. Final aggregate remaining `step04_*` schemas: **0**. Reviewer ports 3114/3115 are free; browser closed. User-owned port 3000 was not stopped.
No commits, pushes, deployment, public migrations or Step05 implementation.

### Explicit limitations / next-step prerequisites
- This verifies authentication/identity, NOT yet the financial schema's owner-scoped reads/writes. Step05 must prove financial data isolation separately.
- Global 100 failed attempts/10min, per-account 5/5min, and concurrency-one hashing deliberately trade availability for abuse resistance in this private app; valid users can temporarily be throttled. No claim of preventing every denial of service.
- If DB revocation fails at logout, the response is an honest failure and the local cookie is removed; a previously copied unrevoked cookie can replay when DB recovers until expiry/revocation. Do not claim successful server revocation during outage.
- Deployment needs strong SESSION_SECRET and canonical HTTPS TRUSTED_ORIGIN. English login/placeholder dashboard is retained; final product UI language/design is not approved by this auth gate.

## Historical initial review — superseded

## Decision and scope
**Initial code review and basic browser QA complete; NOT APPROVED. Security remediation and adversarial regression coverage are required.** User confirmed the separately completed Step04 implementation is their authorized work. Preserved it; no auth implementation was changed and Step05 was not started.
Read-only subagent review was cross-checked against source by Hermes for the main findings below. No claim that the subagent's static analysis constitutes runtime exploitation.

## Verified working paths
On the user's existing local dev server at localhost:3000 (left running because it is not reviewer-owned):
- Real-browser wrong-password login returned generic 'Invalid email or password.'
- Synthetic user A logged in and dashboard showed A's identity.
- UI Sign out returned to login; revisiting /dashboard redirected to /login.
- Synthetic user B subsequently logged in using the same browser, dashboard showed B and not A.
- B signed out; independent unauthenticated HTTP dashboard request returned 307 /login.
- Browser console: no JavaScript errors in tested flow.
- Desktop screenshot visually inspected: usable simple placeholder dashboard/sign-out; login/dashboard are English, unlike the project's Greek UI direction. Full 320/390/430 responsive gate and production HTTPS cookie check remain unperformed.
Two uniquely marked synthetic users and their own login-attempt rows were removed transactionally; session rows cascade from user deletion. Final ownFixtureUsersRemaining=0. Initial cleanup cast incorrectly assumed UUID users; actual users PK is BIGINT, corrected to bigint[] and cleanup rerun successfully. No unrelated users were touched. Fixture script under ignored qa-output; temporary plaintext credential was used only for these now-deleted QA accounts, not a real-user secret.

Prior shared-baseline live suite passed 191 tests, including tests/auth/password.test.ts (14), session.test.ts (9), login.test.ts (18). These tests use mocked Next cookies/navigation, so they do not prove all actual route/CSRF/browser behavior. Default npm test is 208 offline tests and excludes auth suites; its counts must not be conflated with test:db.

## Blocking/high-priority findings

### S4-01 — High: reset/login race can create a session using an old password after reset
lib/auth/actions.ts:28–43 reads/verifies a password before separately creating the session. scripts/provision-user.mjs:128–135 resets the hash and revokes existing sessions, but lib/auth/session.ts:79–90 does not revalidate a credential version/hash when issuing a session. A login paused after old-hash read can resume after reset and create a new unrevoked session.
Source-established interleaving; not yet reproduced by a coordinated live concurrency test. Serialize issuance with credential changes and revalidate credentials/version transactionally; add a deterministic barrier-based regression.

### S4-02 — High: login throttle admission is not atomic
lib/auth/actions.ts:24–43 and lib/auth/rate-limit.ts:11–32 separately count failures, verify, then record. Concurrent requests can all pass the five-failure check before any records exist. DB persistence is distributed but admission is race-prone. Only per-email controls also allow rotating-email abuse and targeted account denial.
Source-established; no load flood performed. Add atomic reservation/admission, bounded hash concurrency and an explicit complementary trusted-source/global policy plus attempt retention.

### S4-03 — Medium: logout route lacks explicit origin/CSRF enforcement
app/api/auth/logout/route.ts:4–7 mutates on POST without origin/token validation. Dashboard uses this route; it is not the logout Server Action. Native Route Handlers do not automatically inherit Server Action origin enforcement. SameSite=Lax mitigates normal cross-site POSTs but not same-site cross-origin scenarios such as hostile sibling subdomains. docs/auth.md's blanket Server Action explanation is misleading.
Source-confirmed; same-site cross-origin exploit not replayed in this review. Define trusted-origin and missing/null-origin handling and test unauthorized POSTs cause no mutation. Login is a Server Action: do not inaccurately claim the same missing framework origin protection for login.

### S4-04 — Medium: logout can report success without clearing a stale/live cookie
lib/auth/dal.ts:32–37 only revokes/destroys the cookie if resolveSession returns a valid session. lib/auth/session.ts:103–119 returns null for expired/revoked/missing sessions AND catches DB failures as null. Hence stale cookies remain; during a transient lookup outage, apparent logout may leave a live cookie and session usable once DB returns.
Source-confirmed; outage injection not performed. Always clear local cookie, distinguish unavailable DB from invalid session, handle revocation failure explicitly.

### S4-05 — Medium: timing-based account enumeration remains
lib/auth/actions.ts:28–38 returns before Argon2 for unknown email, but verifies a hash for known email. Generic strings alone do not equalize timing. Use a fixed valid dummy Argon2 verification on unknown accounts and test equivalent paths/timing distributions. Remote exploitability was not measured.

### S4-06 — Medium: privileged helpers exported from a Server Action module without authorization
lib/auth/actions.ts:1,53–79 exports provisionUserAction and revokeAllUserSessions without operator/current-user checks. The reviewed prior production action manifest exposed only loginAction; no assertion is made that these exports are currently reachable HTTP endpoints. Their safety should not depend on unused/tree-shaken status. Remove operator-only utilities from the action module; keep CLI/server-internal operations separate and authorized.

### S4-07 — Medium: writes bypass mandatory explicit transactions
lib/auth/rate-limit.ts:28–32 inserts through query/pool.query; lib/auth/session.ts:134–141 updates all sessions through query. Both bypass the project's mandatory explicit BEGIN/COMMIT/ROLLBACK same-client rule. Refactor within the atomic abuse/session design rather than wrapping independently and leaving races intact.

### S4-08 — Medium: deployment logout redirect defaults to localhost
app/api/auth/logout/route.ts:6 falls back to http://localhost:3000. Without configured base URL, deployed logout redirects to the visitor's machine. Require a validated canonical origin or a trustworthy same-origin redirect, not arbitrary forwarded headers.

## Architecture and coverage questions
- iron-session plus Argon2 are maintained crypto/session primitives, but account/login/recovery/abuse orchestration is bespoke. This is not hand-written cryptography. Reconcile the approved auth decision with Step04's maintained-auth-solution requirement before redesigning; the self-report's approval claim alone does not authorize Hermes to replace the chosen architecture.
- DAL guard redirects for pages; there is no distinct reusable JSON 401/403 API guard yet. No protected financial API exists, so this is a future integration/readiness gap, not an observed financial data bypass.
- Identity-level A/B browser switching does not prove owner-scoped financial reads/writes; those routes/tables are not implemented.
- Missing adversarial runtime evidence: concurrent login/reset, rate-limit bursts, stale/tampered/replayed cookies, DB-outage logout, direct unauthorized Server Action access, same-site cross-origin CSRF, production Secure-cookie behavior, back/forward cache/multi-tab switch and full mobile widths.
- Additional lower-priority observations from static review: limiter index on lower(email) mismatches email equality query; session lookup FOR UPDATE locks joined user rows unnecessarily; session insertion precedes cookie-config/save success; provisioning Ctrl-C behavior deserves cancellation testing.
- No dependency-advisory web research was added in this initial review; previous npm audit reported zero advisories, not a security guarantee.

## Recommended next bounded pass
First fix Step03 transaction-escape guard and add failing real regression. Then a separate GLM 5.2 Step04 remediation pass for issuance/reset atomicity, throttle admission, logout/origin semantics and unauthorized helper boundaries. Re-run real browser login/logout/A-to-B plus targeted adversarial tests before approval. No implementation changes or push in this review.
