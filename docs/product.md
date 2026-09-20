# mySavings product specification

## Confirmed requirements
- Personal monthly planning, not accounting/ERP or automatic bank sync.
- Mobile-first installable PWA; Next.js, Vercel, Neon PostgreSQL.
- User and wife have separate logins and fully private finances, no shared views.
- Current bank balances refreshed manually whenever checking finances, not just month opening.
- Partial expense payments: EUR 80 gas budget paid EUR 40 then EUR 40. Preserve planned/paid/remaining and full settlement history.
- Replace Excel's zeroing of paid costs with explicit partial/full settlement.
- Protected savings target is central: desired untouched month-end total, NOT monthly contribution or another account.
- Reserved funds are outstanding commitments such as future taxes, ADDITIONAL to protected savings; reduce spendable money and carry forward until paid/released.
- Recurring fixed/variable expenses, expected income, continuous accounts, commitments and monthly history.
- New-month flow replaces Excel duplication, reviews recurring values and preserves history without duplicate balances/commitments.

## UX direction
Overview: savings target, target shortfall, cash-backed/projected spending, stale-balance timestamps and expected-income caveats. Phone-friendly Accounts, Expenses/Income and Commitments. Partial-payment action prefills editable remaining amount. Show planned/settled/remaining. Guided month rollover. No wide desktop spreadsheet squeezed onto mobile.

## Initial assumptions to review before relevant step
EUR only. Greek UI/el-GR, Europe/Athens month boundaries; English identifiers. No public registration: invite/allowlist or secure server provisioning for two users. Select maintained stable auth at Step04; no custom crypto/unreviewed beta. Online-only writes. No bank integration, sharing, OCR or automatic Excel import in v1. Private CSV/export is planned; original workbook stays outside git. No project-specific Vercel/Neon resources or credentials provisioned yet.

## Process
All 18 steps are prewritten and registered as ready-to-run prompts in steps/StepNN.md and identical prompts/StepNN-opencode-glm52.md execution copies. Before each approved step, Hermes rechecks its instructions against actual code, prerequisites and the previous independent review, then amends both copies if needed. OpenCode GLM 5.2 cloud implements only that step; Hermes independently verifies and reports, then waits for user approval. Step01 foundation is complete; Step02–Step18 are prepared, not implemented. Auth selection, credentials, closed-month correction policy and production access remain explicit execution gates, not invented decisions. No automatic execution of the roadmap.
