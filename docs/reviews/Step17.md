# Step17 — Hermes independent verification

Project: `/home/leandrosdim777/projects/mySavings`
Reviewer: Hermes
Date: 2026-09-29
Mode: Independent verification of the GLM 5.2 audit-only run.

## Scope

Verified the Step17 audit reports, repository scope, quality gates, disposable DB integration suite, public runtime headers, origin configuration source, and available browser evidence. No remediation was applied. No application behavior, dependency, schema, auth policy, or existing test assertion was changed.

## Repository scope

The working tree contains only these Step17 audit artifacts:

- `docs/reviews/Step17-opencode.md`
- `docs/reviews/security.md`
- `docs/reviews/mobile-acceptance.md`
- `docs/reviews/Step17.md` (this report)

`git diff --check` passed. No modified application files, migrations, dependency files, or tests were found. The ten synthetic browser screenshots remain under ignored `qa-output/step17/`.

## Independently rerun gates

- `npm run lint` — passed
- `npm run typecheck` — passed
- `npm test -- --run` — 377/377 passed across 12 files
- `DB_TEST_ALLOW_WRITES=1 npm run test:db` — 870/870 passed across 39 files
- `npm run build` — passed; Next.js route generation completed
- `npm audit --audit-level=high` — 0 vulnerabilities
- `git diff --check` — passed

The DB run used the repository’s explicit disposable-write gate. Test schemas were managed by the suite; no production migration or real-user fixture was used by Hermes.

## Runtime/source verification

- `http://localhost:3000/login` loaded successfully in the browser.
- Browser console was clear after navigation.
- `curl -sSI http://localhost:3000/login` confirmed `200 OK`, `Cache-Control: no-cache, must-revalidate`, and `X-Powered-By: Next.js`, but no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy headers. This independently confirms SEC-01.
- `next.config.ts` defines headers only for `/sw.js` and `/manifest.webmanifest`; it does not define general security headers or disable `poweredByHeader`.
- `lib/auth/origin.ts` confirms production uses `TRUSTED_ORIGIN`, development prefers `TRUSTED_ORIGIN_DEV` and falls back to `TRUSTED_ORIGIN`, and missing configuration rejects mutating requests. `.env.example` documents both keys. SEC-02 is therefore a development configuration/operability gap, not an observed CSRF bypass.
- `app/api/history/close/route.ts` delegates to `closeMonth` and maps unexpected service exceptions through the common handler. SEC-03 remains an OpenCode-reported runtime finding against the persistent QA data state; the clean-fixture DB suite does not reproduce it.
- The mobile report explicitly labels physical Android/iOS installation as pending; emulation evidence is not treated as physical-device approval.

## Findings disposition

- **SEC-01 — Medium, confirmed:** Missing general security headers and exposed `X-Powered-By`. Separate remediation required before production hardening.
- **SEC-03 — Medium, reported/open:** Month-close 500 on accumulated mixed QA data. Clean integration fixtures pass; targeted remediation/reproduction is required.
- **SEC-02 — Low, confirmed configuration gap:** Dev trusted-origin variables are not present in the local `.env`, although the current process has a trusted-origin value and `.env.example` documents the keys.
- **MOB-01 — Low, reported/open:** Recurring-template `+ Νέο` dialog did not open in the tested empty-state UI. Backend/API path worked; browser evidence and the OpenCode report support a separate UI fix.

No Critical or High finding was produced or observed. The two Medium findings remain deployment-hardening risks and must not be silently treated as fixed.

## Acceptance decision

**Step17 verified as an audit/acceptance step, with open findings.** The audit contract was followed: no remediation was made, evidence was written, required gates passed, and the process stopped before Step18. The project is not declared production-ready solely because Step17 passed; SEC-01 and SEC-03 require separately approved remediation prompts, and physical-device PWA installation remains unverified.

No commit or push was performed, per the Step17 contract.
