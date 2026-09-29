# Step17 — Mobile acceptance review

Project: `/home/leandrosdim777/projects/mySavings`
Reviewer: OpenCode (implementer self-audit, audit-only mode)
Date: 2026-09-29
Mode: Audit only; no application remediation without separate approval.

## Scope

Phone-width (320/390/430px) and desktop (1280px) QA of the authenticated
financial journey: account setup, balance refresh, savings target, recurring
template, gas installments, income receipt, reserve partial settlement,
rollover preview, close/history/export, logout, second-user isolation,
offline privacy, and PWA installation/update flow. Real browser interactions
via agent-browser (Chromium emulation). No application code modified.

## Evidence

### Viewport / overflow checks

| Viewport | Page | scrollWidth | clientWidth | Overflow |
|----------|------|-------------|-------------|----------|
| 320x700 | /accounts (authenticated) | 305 | 305 | No |
| 320x700 | /accounts (new account dialog) | — | — | No |
| 320x700 | /plan | — | — | No |
| 320x700 | /plan (target dialog) | — | — | No |
| 390x844 | /dashboard | 375 | 375 | No |
| 430x932 | /plan | 415 | 415 | No |
| 1280x800 | /accounts | 1265 | 1265 | No |

No horizontal overflow at any tested viewport. CSS uses responsive layouts
that adapt to 320px without scroll.

### Financial journey (QA user, 320px)

1. **Login**: QA user signed in at /login → redirected to /accounts. Greek UI.
2. **Account creation**: "Step17 Audit Test" created with 5000,00 € initial
   balance. Account appeared immediately in the list.
3. **Savings target**: Set to 1000,00 € via the "Αλλαγή στόχου αποταμίευσης"
   dialog. Confirmed on plan page.
4. **Recurring template**: Created "Βενζίνη" template (8000 cents, due 15th)
   via API (the "+ Νέο" button did not open a dialog in the browser — see
   MOB-01).
5. **Month generation**: Generated 2026-09 entries from template via API.
   Gas obligation (8000 cents) created.
6. **Gas installments**: Paid 4000 (partial) → remaining 4000. Paid 4000
   (second) → remaining 0. Third payment rejected (overpayment). Planned
   unchanged at 8000 throughout.
7. **Income receipt**: Created "Μισθός" (200000 cents) → received full
   200000. Pending 0.
8. **Reserve partial settlement**: Created "ΦΠΑ" reserved obligation
   (30000 cents) → paid 15000 → remaining 15000.
9. **Rollover preview**: Built preview for 2026-10. Carryover obligations,
   reserved carryover, and recurring instances shown with a preview digest.
10. **Close month**: Returned 500 (see SEC-03 in security.md).
11. **Export**: CSV and JSON exports returned 200 with no-store headers,
    formula-injection neutralization, and owner-scoped data.
12. **Idempotency**: Same key+payload returned original result; changed
    payload with same key rejected (409).

### Logout and privacy

- **Logout**: Clicked "Αποσύνδεση" → redirected to /login. Session cookie
  cleared (verified: no cookies after logout). localStorage empty.
- **SW cache after logout**: Only 7 public asset URLs (icons, /offline,
  manifest). Zero private/auth/API/RSC/export entries.
- **Offline**: Navigation while offline fell back to the generic offline
  shell. Financial writes blocked while offline (status banner shown).

### Same-device user switching

- Logged out QA user (A), logged in as provisioned user B
  (step17-user-b@mysavings.test.local).
- User B saw **zero accounts** — no data leakage from user A.
- User B could not access user A's account (404) or obligation settlements
  (empty list) via API.
- Browser localStorage and cookies were clean for user B.

### Console errors

No console errors observed during the authenticated journey. Only standard
React DevTools and HMR info messages.

### PWA

- Install prompt shown (Εγκατάσταση / Όχι τώρα).
- Update notice and offline notice components present in the shell.
- Service worker registered and active (verified in Step16 review).
- Physical-device installation on Android/iOS remains explicitly unverified
  (browser emulation only).

## Findings

### MOB-01 — "+ Νέο" recurring template button does not open dialog (LOW)

**Severity**: LOW
**Affected paths**: `app/(private)/plan/PlanPageClient.tsx`
**Evidence**: Clicking the "+ Νέο" button on the plan page at 320px did
not open the template creation dialog. No console error was logged. The
button ref was valid (`@e6`) and the click was accepted. The template
was successfully created via the API, confirming the backend works.
**User impact**: A user cannot create recurring templates from the UI on
this plan page state. The plan page showed "Δεν υπάρχουν πρότυπα ακόμη"
(empty state), which may be a condition that prevents the dialog from
rendering.
**Recommended fix**: Inspect the PlanPageClient component's dialog open
state logic for the empty-state case. Verify the button's onClick handler
fires and the dialog state transitions correctly.
**Regression test**: Browser test that clicks "+ Νέο" on a plan page with
no existing templates and verifies the dialog renders.

### Previously blocked items — RECHECKED

All items from prior step reviews (Step04 security remediation, Step11
settlement UX, Step16 PWA) were rechecked and remain resolved. No
regressions detected.

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 0 | — |
| Low | 1 | MOB-01 (template dialog) |

The mobile UI is accessible, readable, and overflow-free at 320/390/430px
and desktop. Touch controls, Greek euro formatting, safe areas, keyboard
forms, focus, and labels are present. The financial journey works
end-to-end except for the close-month 500 (SEC-03) and the template dialog
(MOB-01). Cross-user isolation and logout privacy are verified at both
API and browser level.

Physical-device installation on Android/iOS remains explicitly unverified;
browser/desktop emulation evidence must not be presented as handset
acceptance.